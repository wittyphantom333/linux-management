/**
 * Patch Management Service
 *
 * Business logic for the Patch Management system:
 *   - Policy resolution: determine which packages to update on which hosts
 *   - Job creation: materialise a patch job from a policy
 *   - Snapshot diffing: compare pre/post package states
 *   - Window scheduling: compute next-run times from cron expressions
 */

const { getPrismaClient } = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { evaluatePatchJobAlerts } = require("./hostReportAlertEvaluator");

const prisma = getPrismaClient();

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all hosts targeted by a policy (via its groups).
 * Returns an array of host objects with their current packages.
 */
async function resolveHostsForPolicy(policyId) {
	const policyGroups = await prisma.patch_policy_groups.findMany({
		where: { policy_id: policyId },
		select: { host_group_id: true },
	});

	if (policyGroups.length === 0) return [];

	const groupIds = policyGroups.map((pg) => pg.host_group_id);

	const memberships = await prisma.host_group_memberships.findMany({
		where: { host_group_id: { in: groupIds } },
		select: { host_id: true },
	});

	const uniqueHostIds = [...new Set(memberships.map((m) => m.host_id))];
	if (uniqueHostIds.length === 0) return [];

	return prisma.hosts.findMany({
		where: {
			id: { in: uniqueHostIds },
			status: "active",
		},
		include: {
			host_packages: {
				include: { packages: true },
			},
		},
	});
}

/**
 * Filter packages for a given host according to the policy rules.
 * Returns only the host_packages that should be updated.
 */
function filterPackagesForPolicy(hostPackages, policy, filters) {
	let candidates = hostPackages.filter((hp) => hp.needs_update && hp.packages);

	// Policy type filter
	if (policy.policy_type === "security_only") {
		candidates = candidates.filter((hp) => hp.is_security_update);
	}

	// Apply include/exclude filters
	const includeFilters = filters.filter((f) => f.filter_type === "include");
	const excludeFilters = filters.filter((f) => f.filter_type === "exclude");

	// If there are include filters, only keep packages matching at least one
	if (includeFilters.length > 0) {
		candidates = candidates.filter((hp) =>
			includeFilters.some((f) => matchesFilter(hp.packages.name, f)),
		);
	}

	// Remove packages matching any exclude filter
	if (excludeFilters.length > 0) {
		candidates = candidates.filter(
			(hp) => !excludeFilters.some((f) => matchesFilter(hp.packages.name, f)),
		);
	}

	return candidates;
}

/**
 * Test whether a package name matches a filter pattern.
 */
function matchesFilter(packageName, filter) {
	switch (filter.match_type) {
		case "exact":
			return packageName === filter.pattern;
		case "glob": {
			const regex = new RegExp(
				`^${filter.pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
				"i",
			);
			return regex.test(packageName);
		}
		case "regex":
			try {
				return new RegExp(filter.pattern, "i").test(packageName);
			} catch {
				return false;
			}
		default:
			return false;
	}
}

// ---------------------------------------------------------------------------
// Job creation
// ---------------------------------------------------------------------------

/**
 * Create a new patch job for a policy.
 * Resolves target hosts, filters packages, and materialises the job rows.
 */
async function createPatchJob(
	policyId,
	{ triggeredBy = "manual", triggeredByUser = null, windowId = null } = {},
) {
	const policy = await prisma.patch_policies.findUnique({
		where: { id: policyId },
		include: {
			patch_policy_filters: true,
		},
	});

	if (!policy) throw new Error("Policy not found");
	if (!policy.enabled) throw new Error("Policy is disabled");

	const hosts = await resolveHostsForPolicy(policyId);
	if (hosts.length === 0)
		throw new Error(
			`No active hosts targeted by policy "${policy.name}". Check that the policy has host groups assigned and the hosts are active.`,
		);

	const jobId = uuidv4();
	let totalHostsWithPackages = 0;

	// Build job host + package rows
	const jobHostsData = [];
	for (const host of hosts) {
		const targetPackages = filterPackagesForPolicy(
			host.host_packages,
			policy,
			policy.patch_policy_filters,
		);

		if (targetPackages.length === 0) continue; // Skip hosts with nothing to update
		totalHostsWithPackages++;

		const jobHostId = uuidv4();

		// Pre-snapshot: capture current package state
		const preSnapshot = host.host_packages
			.filter((hp) => hp.packages)
			.map((hp) => ({
				package_name: hp.packages.name,
				current_version: hp.current_version,
				available_version: hp.available_version,
				needs_update: hp.needs_update,
				is_security_update: hp.is_security_update,
			}));

		jobHostsData.push({
			id: jobHostId,
			job_id: jobId,
			host_id: host.id,
			status: "pending",
			pre_snapshot: preSnapshot,
			packages: targetPackages.map((hp) => ({
				id: uuidv4(),
				job_host_id: jobHostId,
				package_name: hp.packages.name,
				previous_version: hp.current_version,
				target_version: hp.available_version,
				status: "pending",
			})),
		});
	}

	if (totalHostsWithPackages === 0) {
		const totalHosts = hosts.length;
		const totalUpdatable = hosts.reduce(
			(sum, h) => sum + h.host_packages.filter((hp) => hp.needs_update).length,
			0,
		);
		throw new Error(
			`No hosts have packages matching policy "${policy.name}" filters that need updating. ` +
				`(${totalHosts} host(s) targeted, ${totalUpdatable} package(s) need updates but none match the policy type/filters)`,
		);
	}

	// Create everything in a transaction
	const job = await prisma.$transaction(async (tx) => {
		const createdJob = await tx.patch_jobs.create({
			data: {
				id: jobId,
				policy_id: policyId,
				window_id: windowId,
				status: "pending",
				triggered_by: triggeredBy,
				triggered_by_user: triggeredByUser,
				total_hosts: totalHostsWithPackages,
				created_at: new Date(),
			},
		});

		for (const hostData of jobHostsData) {
			await tx.patch_job_hosts.create({
				data: {
					id: hostData.id,
					job_id: jobId,
					host_id: hostData.host_id,
					status: "pending",
					pre_snapshot: hostData.pre_snapshot,
				},
			});

			if (hostData.packages.length > 0) {
				await tx.patch_job_packages.createMany({
					data: hostData.packages,
				});
			}
		}

		return createdJob;
	});

	logger.info(
		`[PatchMgmt] Job ${jobId} created for policy "${policy.name}": ${totalHostsWithPackages} hosts, triggered by ${triggeredBy}`,
	);

	return {
		job,
		hostsCount: totalHostsWithPackages,
		hostIds: jobHostsData.map((h) => h.host_id),
	};
}

/**
 * Return all enabled patch policies that apply to a host, with matching package counts.
 */
async function getPoliciesForHost(hostId) {
	const host = await prisma.hosts.findUnique({
		where: { id: hostId },
		include: { host_packages: { include: { packages: true } } },
	});
	if (!host) throw new Error("Host not found");

	const memberships = await prisma.host_group_memberships.findMany({
		where: { host_id: hostId },
		select: { host_group_id: true },
	});
	const groupIds = memberships.map((m) => m.host_group_id);
	if (groupIds.length === 0) return [];

	const policyGroups = await prisma.patch_policy_groups.findMany({
		where: { host_group_id: { in: groupIds } },
		select: { policy_id: true },
	});
	const uniquePolicyIds = [...new Set(policyGroups.map((pg) => pg.policy_id))];
	if (uniquePolicyIds.length === 0) return [];

	const policies = await prisma.patch_policies.findMany({
		where: { id: { in: uniquePolicyIds }, enabled: true },
		include: { patch_policy_filters: true },
	});

	return policies.map((policy) => {
		const matched = filterPackagesForPolicy(
			host.host_packages,
			policy,
			policy.patch_policy_filters,
		);
		return {
			id: policy.id,
			name: policy.name,
			description: policy.description || null,
			packages_count: matched.length,
		};
	});
}

/**
 * Create patch jobs scoped to a single host for the given policy IDs.
 * Creates one job per policy. Returns an array of created job summaries.
 */
async function createPatchJobsForHost(
	hostId,
	policyIds,
	{ triggeredBy = "manual", triggeredByUser = null } = {},
) {
	const host = await prisma.hosts.findUnique({
		where: { id: hostId },
		include: { host_packages: { include: { packages: true } } },
	});
	if (!host) throw new Error("Host not found");
	if (host.status !== "active") throw new Error("Host is not active");

	// Validate all requested policies actually target this host
	const memberships = await prisma.host_group_memberships.findMany({
		where: { host_id: hostId },
		select: { host_group_id: true },
	});
	const groupIds = memberships.map((m) => m.host_group_id);

	const policyGroups = await prisma.patch_policy_groups.findMany({
		where: { host_group_id: { in: groupIds } },
		select: { policy_id: true },
	});
	const allowedPolicyIds = new Set(policyGroups.map((pg) => pg.policy_id));

	const policies = await prisma.patch_policies.findMany({
		where: { id: { in: policyIds }, enabled: true },
		include: { patch_policy_filters: true },
	});

	const preSnapshot = host.host_packages
		.filter((hp) => hp.packages)
		.map((hp) => ({
			package_name: hp.packages.name,
			current_version: hp.current_version,
			available_version: hp.available_version,
			needs_update: hp.needs_update,
			is_security_update: hp.is_security_update,
		}));

	const results = [];

	for (const policy of policies) {
		if (!allowedPolicyIds.has(policy.id)) continue;

		const matched = filterPackagesForPolicy(
			host.host_packages,
			policy,
			policy.patch_policy_filters,
		);
		if (matched.length === 0) continue;

		const jobId = uuidv4();
		const jobHostId = uuidv4();

		const packageRows = matched.map((hp) => ({
			id: uuidv4(),
			job_host_id: jobHostId,
			package_name: hp.packages.name,
			previous_version: hp.current_version,
			target_version: hp.available_version,
			status: "pending",
		}));

		const job = await prisma.$transaction(async (tx) => {
			const createdJob = await tx.patch_jobs.create({
				data: {
					id: jobId,
					policy_id: policy.id,
					status: "pending",
					triggered_by: triggeredBy,
					triggered_by_user: triggeredByUser,
					total_hosts: 1,
					created_at: new Date(),
				},
			});

			await tx.patch_job_hosts.create({
				data: {
					id: jobHostId,
					job_id: jobId,
					host_id: hostId,
					status: "pending",
					pre_snapshot: preSnapshot,
				},
			});

			if (packageRows.length > 0) {
				await tx.patch_job_packages.createMany({ data: packageRows });
			}

			return createdJob;
		});

		logger.info(
			`[PatchMgmt] Single-host job ${jobId} created for host ${hostId} using policy "${policy.name}": ${matched.length} packages`,
		);

		results.push({
			job,
			policy: { id: policy.id, name: policy.name },
			packagesCount: matched.length,
		});
	}

	if (results.length === 0) {
		throw new Error(
			"No updatable packages match the selected policies for this host",
		);
	}

	return results;
}

// ---------------------------------------------------------------------------
// Snapshot diff
// ---------------------------------------------------------------------------

/**
 * Compute a diff between pre and post snapshots.
 */
function computeSnapshotDiff(preSnapshot, postSnapshot) {
	if (!preSnapshot || !postSnapshot) return null;

	const preMap = new Map();
	for (const pkg of preSnapshot) {
		preMap.set(pkg.package_name, pkg);
	}

	const postMap = new Map();
	for (const pkg of postSnapshot) {
		postMap.set(pkg.package_name, pkg);
	}

	const updated = [];
	const added = [];
	const removed = [];
	const unchanged = [];

	for (const [name, post] of postMap) {
		const pre = preMap.get(name);
		if (!pre) {
			added.push({ package_name: name, new_version: post.current_version });
		} else if (pre.current_version !== post.current_version) {
			updated.push({
				package_name: name,
				old_version: pre.current_version,
				new_version: post.current_version,
				was_security: pre.is_security_update,
			});
		} else {
			unchanged.push({ package_name: name, version: post.current_version });
		}
	}

	for (const [name] of preMap) {
		if (!postMap.has(name)) {
			removed.push({
				package_name: name,
				old_version: preMap.get(name).current_version,
			});
		}
	}

	return {
		updated,
		added,
		removed,
		unchanged_count: unchanged.length,
		summary: {
			packages_updated: updated.length,
			packages_added: added.length,
			packages_removed: removed.length,
			packages_unchanged: unchanged.length,
		},
	};
}

// ---------------------------------------------------------------------------
// Window scheduling helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next run time from a cron expression.
 * Uses a simple parser for 5-field cron (minute hour dom month dow).
 */
function computeNextRun(cronExpr, timezone = "UTC", after = new Date()) {
	// Simple approach: iterate minute-by-minute up to 7 days out
	// For production, a proper cron parser library would be used
	if (!cronExpr) return null;

	const parts = cronExpr.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

	const matchField = (expr, value, _max) => {
		if (expr === "*") return true;
		// Handle */N
		if (expr.startsWith("*/")) {
			const step = parseInt(expr.slice(2), 10);
			return value % step === 0;
		}
		// Handle ranges (e.g. 1-5)
		if (expr.includes("-") && !expr.includes(",")) {
			const [lo, hi] = expr.split("-").map(Number);
			return value >= lo && value <= hi;
		}
		// Handle comma-separated values (may include ranges)
		const values = expr.split(",").flatMap((v) => {
			if (v.includes("-")) {
				const [lo, hi] = v.split("-").map(Number);
				const range = [];
				for (let n = lo; n <= hi; n++) range.push(n);
				return range;
			}
			return [parseInt(v, 10)];
		});
		return values.includes(value);
	};

	// Helper: convert a UTC Date to components in the target timezone
	const toTzParts = (date) => {
		try {
			const fmt = new Intl.DateTimeFormat("en-US", {
				timeZone: timezone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				weekday: "short",
				hour12: false,
			});
			const p = {};
			for (const { type, value } of fmt.formatToParts(date)) {
				p[type] = value;
			}
			const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
			return {
				min: parseInt(p.minute, 10),
				hour: parseInt(p.hour, 10) % 24,
				dom: parseInt(p.day, 10),
				mon: parseInt(p.month, 10),
				dow: dowMap[p.weekday] ?? 0,
			};
		} catch {
			// Invalid timezone — fall back to UTC
			return {
				min: date.getUTCMinutes(),
				hour: date.getUTCHours(),
				dom: date.getUTCDate(),
				mon: date.getUTCMonth() + 1,
				dow: date.getUTCDay(),
			};
		}
	};

	// Iterate up to 35 days (50400 minutes) to cover monthly schedules
	const candidate = new Date(after.getTime());
	candidate.setSeconds(0, 0);
	candidate.setMinutes(candidate.getMinutes() + 1);

	for (let i = 0; i < 50400; i++) {
		const { min, hour, dom, mon, dow } = toTzParts(candidate);

		if (
			matchField(minExpr, min) &&
			matchField(hourExpr, hour) &&
			matchField(domExpr, dom) &&
			matchField(monExpr, mon) &&
			matchField(dowExpr, dow)
		) {
			return candidate;
		}

		candidate.setMinutes(candidate.getMinutes() + 1);
	}

	return null; // No match within 35 days
}

/**
 * Refresh next_run_at for enabled recurring windows whose schedule is
 * missing or stale.  Windows that already have a valid future next_run_at
 * are left untouched so we never accidentally leap-frog an imminent
 * occurrence that the due-window query hasn't processed yet.
 */
async function refreshWindowSchedules() {
	const now = new Date();
	const windows = await prisma.patch_windows.findMany({
		where: { enabled: true, schedule_type: "recurring" },
	});

	for (const w of windows) {
		// Skip windows that already have a valid future next_run_at — recomputing
		// here could race with the due-window check and push the schedule forward,
		// causing the current occurrence to be silently skipped.
		if (w.next_run_at && w.next_run_at > now) continue;

		const nextRun = computeNextRun(w.schedule_cron, w.schedule_timezone);
		if (nextRun) {
			await prisma.patch_windows.update({
				where: { id: w.id },
				data: { next_run_at: nextRun, updated_at: new Date() },
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Agent: compute pending job for a host
// ---------------------------------------------------------------------------

/**
 * Get the next pending patch job assignment for a specific host.
 * Returns the job details with package list, or null if no work pending.
 */
async function getPendingJobForHost(hostId) {
	const jobHost = await prisma.patch_job_hosts.findFirst({
		where: {
			host_id: hostId,
			status: "pending",
			job: {
				status: { in: ["pending", "running"] },
			},
		},
		include: {
			job: {
				include: {
					policy: true,
				},
			},
			patch_job_packages: true,
		},
		orderBy: { job: { created_at: "asc" } },
	});

	if (!jobHost) return null;

	return {
		job_id: jobHost.job_id,
		job_host_id: jobHost.id,
		policy_name: jobHost.job.policy.name,
		policy_type: jobHost.job.policy.policy_type,
		reboot_policy: jobHost.job.policy.reboot_policy,
		pre_snapshot: jobHost.job.policy.pre_snapshot,
		post_snapshot: jobHost.job.policy.post_snapshot,
		packages: jobHost.patch_job_packages.map((p) => ({
			id: p.id,
			package_name: p.package_name,
			current_version: p.previous_version,
			target_version: p.target_version,
		})),
	};
}

/**
 * Process an agent's patch result report.
 */
async function processAgentPatchReport(hostId, report) {
	const {
		job_host_id,
		status,
		results,
		packages,
		post_snapshot,
		reboot_required,
		reboot_completed,
		reboot_done,
		error_message,
	} = report;

	// Agent sends "results", server originally used "packages" — accept both
	const pkgResults = results || packages || [];

	const jobHost = await prisma.patch_job_hosts.findUnique({
		where: { id: job_host_id },
		include: { job: true },
	});

	if (!jobHost) throw new Error("Job host record not found");
	if (jobHost.host_id !== hostId) throw new Error("Host ID mismatch");

	// Update per-package results
	if (pkgResults.length > 0) {
		for (const pkg of pkgResults) {
			// Agent may send package_name without id; try to match by name if no id
			const pkgId = pkg.id || null;
			if (pkgId) {
				await prisma.patch_job_packages.update({
					where: { id: pkgId },
					data: {
						installed_version: pkg.installed_version || null,
						status: pkg.status,
						error_message: pkg.error_message || null,
					},
				});
			} else if (pkg.package_name) {
				await prisma.patch_job_packages.updateMany({
					where: {
						job_host_id,
						package_name: pkg.package_name,
					},
					data: {
						installed_version: pkg.installed_version || null,
						status: pkg.status,
						error_message: pkg.error_message || null,
					},
				});
			}
		}
	}

	// Count results
	const allPkgs = await prisma.patch_job_packages.findMany({
		where: { job_host_id },
	});
	const updatedCount = allPkgs.filter((p) => p.status === "updated").length;
	const failedCount = allPkgs.filter((p) => p.status === "failed").length;

	// Update job host record
	await prisma.patch_job_hosts.update({
		where: { id: job_host_id },
		data: {
			status,
			completed_at: ["completed", "failed"].includes(status)
				? new Date()
				: undefined,
			packages_updated: updatedCount,
			packages_failed: failedCount,
			post_snapshot: post_snapshot || undefined,
			reboot_required: reboot_required || false,
			reboot_completed: reboot_completed || reboot_done || false,
			error_message: error_message || null,
		},
	});

	// Update job-level counters
	const allJobHosts = await prisma.patch_job_hosts.findMany({
		where: { job_id: jobHost.job_id },
	});

	const completedHosts = allJobHosts.filter(
		(jh) => jh.status === "completed",
	).length;
	const failedHosts = allJobHosts.filter((jh) => jh.status === "failed").length;
	const skippedHosts = allJobHosts.filter(
		(jh) => jh.status === "skipped",
	).length;
	const pendingHosts = allJobHosts.filter((jh) =>
		["pending", "downloading", "installing", "rebooting"].includes(jh.status),
	).length;

	const jobUpdate = {
		completed_hosts: completedHosts,
		failed_hosts: failedHosts,
		skipped_hosts: skippedHosts,
	};

	// Check if job is finished
	if (pendingHosts === 0) {
		// Don't overwrite "cancelled" status if the job was already cancelled by user
		if (jobHost.job.status !== "cancelled") {
			if (failedHosts > 0 && completedHosts > 0) {
				jobUpdate.status = "completed_with_errors";
			} else if (failedHosts > 0 && completedHosts === 0) {
				jobUpdate.status = "failed";
			} else {
				jobUpdate.status = "completed";
			}
			jobUpdate.completed_at = new Date();
		}
	} else if (jobHost.job.status === "pending") {
		// First host started reporting — mark job as running
		jobUpdate.status = "running";
		if (!jobHost.job.started_at) {
			jobUpdate.started_at = new Date();
		}
	}

	// Check stop-on-failure threshold
	const policy = await prisma.patch_policies.findUnique({
		where: { id: jobHost.job.policy_id },
	});
	if (policy && policy.stop_on_failure_percent > 0 && allJobHosts.length > 0) {
		const failPct = (failedHosts / allJobHosts.length) * 100;
		if (failPct >= policy.stop_on_failure_percent && pendingHosts > 0) {
			jobUpdate.status = "failed";
			jobUpdate.completed_at = new Date();

			// Skip remaining pending hosts
			await prisma.patch_job_hosts.updateMany({
				where: {
					job_id: jobHost.job_id,
					status: "pending",
				},
				data: {
					status: "skipped",
					error_message: `Skipped: failure threshold ${policy.stop_on_failure_percent}% reached`,
				},
			});

			logger.warn(
				`[PatchMgmt] Job ${jobHost.job_id} stopped: ${failPct.toFixed(0)}% failure rate exceeds threshold ${policy.stop_on_failure_percent}%`,
			);
		}
	}

	await prisma.patch_jobs.update({
		where: { id: jobHost.job_id },
		data: jobUpdate,
	});

	// Fire-and-forget: evaluate patch job alerts when job reaches terminal state
	if (
		jobUpdate.status === "failed" ||
		jobUpdate.status === "completed_with_errors"
	) {
		const updatedJob = await prisma.patch_jobs.findUnique({
			where: { id: jobHost.job_id },
		});
		if (updatedJob) {
			evaluatePatchJobAlerts(updatedJob, jobUpdate.status).catch((err) =>
				logger.error("[AlertEvaluator] patch job alert error:", err),
			);
		}
	}

	logger.info(
		`[PatchMgmt] Host report for job ${jobHost.job_id}: ${status} (${updatedCount} updated, ${failedCount} failed)`,
	);

	return { success: true };
}

module.exports = {
	resolveHostsForPolicy,
	filterPackagesForPolicy,
	matchesFilter,
	createPatchJob,
	getPoliciesForHost,
	createPatchJobsForHost,
	computeSnapshotDiff,
	computeNextRun,
	refreshWindowSchedules,
	getPendingJobForHost,
	processAgentPatchReport,
};
