const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const logger = require("../utils/logger");

/**
 * Server self-update service.
 *
 * Deploys the latest code from the configured git branch to this host and
 * reloads the service. Runs entirely from within the server process (no
 * external agent), which makes it possible to expose a single "Apply Update"
 * button in the UI.
 *
 * Configuration (all optional, with production defaults):
 *   UPDATE_REPO_DIR   path to the deployed git checkout (default: /opt/updates.zedhosting.gg)
 *   UPDATE_BRANCH     branch to deploy (default: development)
 *
 * IMPORTANT (systemd sandbox): the service unit runs with ProtectHome=true,
 * ProtectSystem=strict, NoNewPrivileges=true, PrivateTmp=true and
 * ReadWritePaths=/opt/updates.zedhosting.gg. Consequences for child processes:
 *  - The real HOME (/home/<user>) is completely inaccessible from inside the
 *    service — bash, git and npm all fail with EACCES on it regardless of
 *    file ownership. Children therefore get HOME pointed inside the repo
 *    (writable per ReadWritePaths).
 *  - NODE_ENV=production must be dropped for children, else npm skips
 *    devDependencies and `prepare` (lefthook) breaks the install.
 *  - sudo cannot work (NoNewPrivileges). "Restart" is done by exiting the
 *    process; systemd Restart=always brings the service back on new code.
 *
 * Job state is persisted to STATE_FILE inside the repo so the UI can keep
 * polling across the restart that the apply flow itself triggers.
 */

const REPO_DIR = process.env.UPDATE_REPO_DIR || "/opt/updates.zedhosting.gg";
const BRANCH = process.env.UPDATE_BRANCH || "development";
const UPDATE_HOME = path.join(REPO_DIR, ".update-home");
const STATE_FILE = path.join(REPO_DIR, ".apply-update-state.json");

// jobId -> { status, startedAt, finishedAt, steps, currentStep, log, error }
const jobs = new Map();

// Re-seed the job map from disk so UI polling survives the self-restart.
try {
	if (fs.existsSync(STATE_FILE)) {
		const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
		if (saved?.jobId) {
			// A job still marked "running" means the process died mid-update
			// (we always persist terminal states before exiting on purpose).
			if (saved.status === "running") {
				saved.status = "failed";
				saved.error =
					"Update process was interrupted (server restarted mid-update).";
				saved.finishedAt = new Date().toISOString();
			}
			jobs.set(saved.jobId, saved);
		}
	}
} catch (_e) {
	// Corrupt/absent state file — start clean.
}

function persistJob(jobId) {
	try {
		const job = jobs.get(jobId);
		if (job) {
			fs.writeFileSync(STATE_FILE, JSON.stringify({ jobId, ...job }));
		}
	} catch (_e) {
		// Best-effort persistence; polling still works if we stay alive.
	}
}

function log() {
	return logger;
}

/**
 * Run a single shell command via `bash -c` (non-login) and return { code, output }.
 * Resolves on completion; never throws (errors are surfaced via output).
 *
 * The child env overrides HOME (see UPDATE_HOME) because the service runs
 * under systemd sandboxing (ProtectHome=true) which makes the real home
 * unreadable — bash/git/npm would all fail with EACCES otherwise. NODE_ENV is
 * dropped so npm installs devDependencies (vite/lefthook are needed to build).
 */
function run(cmd, { timeout = 900_000 } = {}) {
	return new Promise((resolve) => {
		log().info(`[apply-update] $ ${cmd}`);
		try {
			fs.mkdirSync(UPDATE_HOME, { recursive: true });
		} catch (_e) {}
		const { NODE_ENV: _drop, ...childEnv } = process.env;
		execFile(
			"bash",
			["-c", cmd],
			{
				timeout,
				maxBuffer: 10 * 1024 * 1024,
				encoding: "utf8",
				env: {
					...childEnv,
					HOME: UPDATE_HOME,
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
	persistJob(jobId);

	const append = (line) => {
		job.log = `${job.log}\n${line}`.trimStart();
		persistJob(jobId);
	};

	const finish = (ok, error) => {
		job.status = ok ? "success" : "failed";
		job.finishedAt = new Date().toISOString();
		job.error = error || null;
		persistJob(jobId);
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

			// 2. Install dependencies (NODE_ENV dropped in run() so devDeps
			// like vite/lefthook install too).
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

			// 4. Restart the service. sudo is impossible inside the sandbox
			// (NoNewPrivileges=true), so we exit instead; systemd's
			// Restart=always brings the service back on the new code.
			job.currentStep = "Restart service";
			append(
				"→ Restarting service (self-exit; systemd Restart=always brings it back)…",
			);
			finish(true, null);

			// Give in-flight HTTP responses a moment, then hand off to systemd.
			setTimeout(() => process.exit(0), 1500);
		} catch (err) {
			log().error(`[apply-update] job ${jobId} unexpected error:`, err);
			finish(false, `Unexpected error: ${err.message}`);
		}
	})();

	return jobId;
}

/**
 * Read the portal version (package.json) from the deployed checkout.
 * The portal version line is `portal/vX.Y.Z`; this is the human-readable
 * version the server-version page should display (commits are only detail).
 */
function readPortalVersion() {
	try {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(REPO_DIR, "backend", "package.json"), "utf8"),
		);
		return pkg?.version || null;
	} catch (_e) {
		return null;
	}
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
		portalVersion: readPortalVersion(),
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
			const pv = result.portalVersion
				? `portal/v${result.portalVersion}`
				: "unknown";
			result.detail = result.updateAvailable
				? `Deployed ${pv} (${result.localCommit}), branch ${BRANCH} is at ${result.remoteCommit}`
				: `Up to date on ${BRANCH} — ${pv} (${result.localCommit})`;
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
	// Exposed for diagnostics; not required by routes.
	config: { REPO_DIR, BRANCH, UPDATE_HOME },
};
