const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const logger = require("../utils/logger");

/**
 * Server self-update service.
 *
 * Deploys the latest code from the configured git branch to this host and
 * restarts the service. Runs entirely from within the server process (no
 * external agent), which makes it possible to expose a single "Apply Update"
 * button in the UI.
 *
 * Configuration (all optional, with production defaults):
 *   UPDATE_REPO_DIR   path to the deployed git checkout (default: /opt/updates.zedhosting.gg)
 *   UPDATE_BRANCH     branch to deploy (default: development)
 *   UPDATE_SERVICE    systemd unit to restart (default: updates.zedhosting.gg.service)
 *   UPDATE_SUDO       set to "false" to skip the sudo prefix (default: sudo is used)
 *
 * Jobs are stored in-memory and are keyed by a job id. The UI polls
 * getJobStatus() until the job settles.
 */

const REPO_DIR = process.env.UPDATE_REPO_DIR || "/opt/updates.zedhosting.gg";
const BRANCH = process.env.UPDATE_BRANCH || "development";
const SERVICE = process.env.UPDATE_SERVICE || "updates.zedhosting.gg.service";
const USE_SUDO = process.env.UPDATE_SUDO !== "false";
const SUDO = USE_SUDO ? "sudo " : "";

// jobId -> { status, startedAt, finishedAt, steps, currentStep, log, error }
const jobs = new Map();

function log() {
	return logger;
}

/**
 * Run a single shell command via `bash -c` (non-login) and return { code, output }.
 * Resolves on completion; never throws (errors are surfaced via output).
 *
 * NOTE: we intentionally avoid `-l` (login shell) because it tries to read
 * the service user's .bash_profile, which is not readable here and breaks the
 * command. The service environment PATH already covers /usr/bin (node, npm,
 * git, sudo all live there).
 */
function run(cmd, { timeout = 900_000 } = {}) {
	return new Promise((resolve) => {
		log().info(`[apply-update] $ ${cmd}`);
		execFile(
			"bash",
			["-c", cmd],
			{
				timeout,
				maxBuffer: 10 * 1024 * 1024,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${process.env.PATH || ""}:/usr/bin:/usr/local/bin:/bin`,
				},
			},
			(error, stdout, stderr) => {
				const output = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`;
				const code = error ? (error.code ?? 1) : 0;
				if (output) {
					log().info(`[apply-update] output:\n${output.trim()}`);
				}
				resolve({ code, output: output.trim() });
			},
		);
	});
}

/**
 * Kick off a self-update job in the background. Returns the job id
 * immediately (the deploy takes longer than an HTTP request is allowed to
 * block on, so the UI must poll getJobStatus).
 */
function applyUpdate() {
	const jobId = crypto.randomUUID();
	const job = {
		status: "running", // running | success | failed
		startedAt: new Date().toISOString(),
		finishedAt: null,
		steps: [
			"Fetch & update code",
			"Install dependencies",
			"Build frontend",
			"Restart service",
		],
		currentStep: null,
		log: "",
		error: null,
		commitBefore: null,
		commitAfter: null,
	};
	jobs.set(jobId, job);

	const append = (line) => {
		job.log = `${job.log}\n${line}`.trimStart();
	};

	const finish = (ok, error) => {
		job.status = ok ? "success" : "failed";
		job.finishedAt = new Date().toISOString();
		job.error = error || null;
		log().info(`[apply-update] job ${jobId} finished: ${job.status}`);
	};

	(async () => {
		try {
			// Pre-flight: the repo dir must exist.
			if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
				finish(false, `Update repo not found at ${REPO_DIR}`);
				return;
			}

			// Record the commit we are updating from.
			const before = await run(
				`git -C ${REPO_DIR} rev-parse --short HEAD 2>/dev/null`,
			);
			job.commitBefore = before.output.trim() || null;

			// 1. Fetch and update code to the target branch.
			job.currentStep = "Fetch & update code";
			append(`→ Fetch & update code (branch: ${BRANCH})`);
			let step = await run(
				`set -e; cd ${REPO_DIR}; ` +
					`git fetch origin ${BRANCH}; ` +
					`git checkout ${BRANCH}; ` +
					`git reset --hard origin/${BRANCH}`,
			);
			append(step.output || "(git update ok)");
			if (step.code !== 0) {
				finish(false, `Code update failed:\n${step.output}`);
				return;
			}
			const after = await run(
				`git -C ${REPO_DIR} rev-parse --short HEAD 2>/dev/null`,
			);
			job.commitAfter = after.output.trim() || null;

			// 2. Install dependencies.
			job.currentStep = "Install dependencies";
			append("→ Installing dependencies…");
			step = await run(`set -e; cd ${REPO_DIR}; npm install`);
			if (step.code !== 0) {
				finish(false, `Dependency install failed:\n${step.output}`);
				return;
			}

			// 3. Build the frontend.
			job.currentStep = "Build frontend";
			append("→ Building frontend…");
			step = await run(`set -e; cd ${REPO_DIR}; npm run build`);
			if (step.code !== 0) {
				finish(false, `Build failed:\n${step.output}`);
				return;
			}

			// 4. Restart the service.
			job.currentStep = "Restart service";
			append(`→ Restarting ${SERVICE}…`);
			step = await run(`${SUDO}systemctl restart ${SERVICE}`);
			if (step.code !== 0) {
				finish(
					false,
					`Service restart failed:\n${step.output} ` +
						"(If this is a permissions problem, allow " +
						`${SERVICE} restart for the service user via a scoped sudoers rule.)`,
				);
				return;
			}

			// Confirm it came back up.
			const active = await run(
				`${SUDO}systemctl is-active ${SERVICE} 2>/dev/null`,
			);
			const activeState = active.output.trim();
			append(`Service state: ${activeState || "unknown"}`);
			finish(true, null);
		} catch (err) {
			log().error(`[apply-update] job ${jobId} unexpected error:`, err);
			finish(false, `Unexpected error: ${err.message}`);
		}
	})();

	return jobId;
}

/**
 * Determine whether a server update is available by comparing the deployed
 * commit against the remote deploy branch. This is the source of truth for
 * "update available" on the server-version page (independent of agent
 * releases). Resolves to a status object; never throws.
 */
async function checkForUpdate() {
	const result = {
		branch: BRANCH,
		localCommit: null,
		remoteCommit: null,
		updateAvailable: false,
		detail: null,
	};
	try {
		const local = await run(
			`git -C ${REPO_DIR} rev-parse --short HEAD 2>/dev/null`,
		);
		result.localCommit = local.output.trim() || null;

		// Fetch only the remote branch tip (lightweight, no working-tree change).
		await run(`git -C ${REPO_DIR} fetch --quiet origin ${BRANCH} 2>/dev/null`, {
			timeout: 30_000,
		});
		const remote = await run(
			`git -C ${REPO_DIR} rev-parse --short origin/${BRANCH} 2>/dev/null`,
		);
		result.remoteCommit = remote.output.trim() || null;

		if (result.localCommit && result.remoteCommit) {
			result.updateAvailable =
				result.localCommit.toLowerCase() !== result.remoteCommit.toLowerCase();
			result.detail = result.updateAvailable
				? `Deployed ${result.localCommit}, branch ${BRANCH} is at ${result.remoteCommit}`
				: `Up to date on ${BRANCH} (${result.localCommit})`;
		} else {
			result.detail = "Could not determine deployed or remote commit";
		}
	} catch (err) {
		result.detail = `Update check failed: ${err.message}`;
	}
	return result;
}

/**
 * Return a snapshot of a job's current state (for polling).
 */
function getJobStatus(jobId) {
	const job = jobs.get(jobId);
	if (!job) return null;
	// Return a copy so callers can't mutate shared state.
	return { ...job, steps: [...job.steps] };
}

module.exports = {
	applyUpdate,
	getJobStatus,
	checkForUpdate,
	// Exposed for diagnostics/README; not required by routes.
	config: { REPO_DIR, BRANCH, SERVICE, USE_SUDO },
};
