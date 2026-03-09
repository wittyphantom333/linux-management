/**
 * Patch Management Routes
 *
 * Provides CRUD endpoints for the Patch Management system:
 *   - Policies (what to patch and how)
 *   - Windows (scheduled maintenance windows)
 *   - Jobs (patch execution instances with per-host / per-package tracking)
 *   - Agent endpoints (fetch pending work, report results)
 *   - Snapshot diffs (before/after comparison)
 *
 * Agent-facing endpoints use X-API-ID / X-API-KEY authentication.
 * UI-facing endpoints use JWT token authentication.
 */

const express = require("express");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");
const { getPrismaClient } = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const { verifyApiKey } = require("../utils/apiKeyUtils");
const {
	createPatchJob,
	computeSnapshotDiff,
	computeNextRun,
	getPendingJobForHost,
	processAgentPatchReport,
	resolveHostsForPolicy,
	filterPackagesForPolicy,
} = require("../services/patchManagementService");

const prisma = getPrismaClient();
const router = express.Router();

// ============================================================================
// POLICIES
// ============================================================================

// GET /api/v1/patch-management/policies - List all policies
router.get("/policies", authenticateToken, async (req, res) => {
	try {
		const { enabled } = req.query;
		const where = {};
		if (enabled !== undefined) where.enabled = enabled === "true";

		const policies = await prisma.patch_policies.findMany({
			where,
			include: {
				patch_policy_groups: {
					include: {
						host_groups: { select: { id: true, name: true, color: true } },
					},
				},
				patch_policy_filters: true,
				_count: {
					select: {
						patch_windows: true,
						patch_jobs: true,
					},
				},
			},
			orderBy: { created_at: "desc" },
		});

		// Enrich with host counts
		const enriched = await Promise.all(
			policies.map(async (p) => {
				const groupIds = p.patch_policy_groups.map((pg) => pg.host_group_id);
				let hostCount = 0;
				if (groupIds.length > 0) {
					const memberships = await prisma.host_group_memberships.findMany({
						where: { host_group_id: { in: groupIds } },
						select: { host_id: true },
					});
					hostCount = new Set(memberships.map((m) => m.host_id)).size;
				}
				return { ...p, host_count: hostCount };
			}),
		);

		return res.json({ success: true, policies: enriched });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to list policies: ${error.message}`);
		return res.status(500).json({ error: "Failed to list policies" });
	}
});

// GET /api/v1/patch-management/policies/:id - Get a single policy
router.get("/policies/:id", authenticateToken, async (req, res) => {
	try {
		const policy = await prisma.patch_policies.findUnique({
			where: { id: req.params.id },
			include: {
				patch_policy_groups: {
					include: {
						host_groups: { select: { id: true, name: true, color: true } },
					},
				},
				patch_policy_filters: true,
				patch_windows: { orderBy: { created_at: "desc" } },
				patch_jobs: {
					orderBy: { created_at: "desc" },
					take: 10,
					include: {
						_count: { select: { patch_job_hosts: true } },
					},
				},
			},
		});

		if (!policy) return res.status(404).json({ error: "Policy not found" });

		// Resolve targeted hosts with their updatable packages
		const hosts = await resolveHostsForPolicy(policy.id);
		const hostSummaries = hosts.map((h) => {
			const targetPkgs = filterPackagesForPolicy(
				h.host_packages,
				policy,
				policy.patch_policy_filters,
			);
			return {
				id: h.id,
				friendly_name: h.friendly_name,
				hostname: h.hostname,
				os_type: h.os_type,
				os_version: h.os_version,
				total_packages: h.host_packages.length,
				updatable_packages: targetPkgs.length,
				security_updates: targetPkgs.filter((p) => p.is_security_update).length,
			};
		});

		return res.json({ success: true, policy, hosts: hostSummaries });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to get policy: ${error.message}`);
		return res.status(500).json({ error: "Failed to get policy" });
	}
});

// POST /api/v1/patch-management/policies - Create a policy
router.post("/policies", authenticateToken, async (req, res) => {
	try {
		const {
			name,
			description,
			policy_type = "all",
			auto_approve = false,
			approval_timeout_hours = 72,
			reboot_policy = "if_needed",
			pre_snapshot = true,
			post_snapshot = true,
			max_concurrent_hosts = 5,
			stop_on_failure_percent = 30,
			blackout_start,
			blackout_end,
			group_ids = [],
			filters = [],
		} = req.body;

		if (!name) return res.status(400).json({ error: "Policy name is required" });
		if (!["all", "security_only", "selected"].includes(policy_type)) {
			return res.status(400).json({ error: "Invalid policy_type. Must be: all, security_only, selected" });
		}
		if (!["never", "if_needed", "always"].includes(reboot_policy)) {
			return res.status(400).json({ error: "Invalid reboot_policy. Must be: never, if_needed, always" });
		}

		const policyId = uuidv4();

		const policy = await prisma.$transaction(async (tx) => {
			const created = await tx.patch_policies.create({
				data: {
					id: policyId,
					name,
					description,
					policy_type,
					auto_approve,
					approval_timeout_hours,
					reboot_policy,
					pre_snapshot,
					post_snapshot,
					max_concurrent_hosts,
					stop_on_failure_percent,
					blackout_start,
					blackout_end,
					enabled: true,
					created_by: req.user?.id,
					updated_at: new Date(),
				},
			});

			// Link groups
			if (group_ids.length > 0) {
				await tx.patch_policy_groups.createMany({
					data: group_ids.map((gid) => ({
						id: uuidv4(),
						policy_id: policyId,
						host_group_id: gid,
					})),
				});
			}

			// Create filters
			if (filters.length > 0) {
				await tx.patch_policy_filters.createMany({
					data: filters.map((f) => ({
						id: uuidv4(),
						policy_id: policyId,
						filter_type: f.filter_type || "exclude",
						match_type: f.match_type || "glob",
						pattern: f.pattern,
					})),
				});
			}

			return created;
		});

		logger.info(`[PatchMgmt] Policy "${name}" created by ${req.user?.username}`);
		return res.status(201).json({ success: true, policy });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ error: "A policy with this name already exists" });
		}
		logger.error(`[PatchMgmt] Failed to create policy: ${error.message}`);
		return res.status(500).json({ error: "Failed to create policy" });
	}
});

// PUT /api/v1/patch-management/policies/:id - Update a policy
router.put("/policies/:id", authenticateToken, async (req, res) => {
	try {
		const { id } = req.params;
		const {
			name,
			description,
			policy_type,
			auto_approve,
			approval_timeout_hours,
			reboot_policy,
			pre_snapshot,
			post_snapshot,
			max_concurrent_hosts,
			stop_on_failure_percent,
			blackout_start,
			blackout_end,
			enabled,
			group_ids,
			filters,
		} = req.body;

		const existing = await prisma.patch_policies.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ error: "Policy not found" });

		await prisma.$transaction(async (tx) => {
			await tx.patch_policies.update({
				where: { id },
				data: {
					...(name !== undefined && { name }),
					...(description !== undefined && { description }),
					...(policy_type !== undefined && { policy_type }),
					...(auto_approve !== undefined && { auto_approve }),
					...(approval_timeout_hours !== undefined && { approval_timeout_hours }),
					...(reboot_policy !== undefined && { reboot_policy }),
					...(pre_snapshot !== undefined && { pre_snapshot }),
					...(post_snapshot !== undefined && { post_snapshot }),
					...(max_concurrent_hosts !== undefined && { max_concurrent_hosts }),
					...(stop_on_failure_percent !== undefined && { stop_on_failure_percent }),
					...(blackout_start !== undefined && { blackout_start }),
					...(blackout_end !== undefined && { blackout_end }),
					...(enabled !== undefined && { enabled }),
					updated_at: new Date(),
				},
			});

			if (group_ids !== undefined) {
				await tx.patch_policy_groups.deleteMany({ where: { policy_id: id } });
				if (group_ids.length > 0) {
					await tx.patch_policy_groups.createMany({
						data: group_ids.map((gid) => ({
							id: uuidv4(),
							policy_id: id,
							host_group_id: gid,
						})),
					});
				}
			}

			if (filters !== undefined) {
				await tx.patch_policy_filters.deleteMany({ where: { policy_id: id } });
				if (filters.length > 0) {
					await tx.patch_policy_filters.createMany({
						data: filters.map((f) => ({
							id: uuidv4(),
							policy_id: id,
							filter_type: f.filter_type || "exclude",
							match_type: f.match_type || "glob",
							pattern: f.pattern,
						})),
					});
				}
			}
		});

		const updated = await prisma.patch_policies.findUnique({
			where: { id },
			include: {
				patch_policy_groups: {
					include: { host_groups: { select: { id: true, name: true, color: true } } },
				},
				patch_policy_filters: true,
			},
		});

		logger.info(`[PatchMgmt] Policy "${updated.name}" updated by ${req.user?.username}`);
		return res.json({ success: true, policy: updated });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ error: "A policy with this name already exists" });
		}
		logger.error(`[PatchMgmt] Failed to update policy: ${error.message}`);
		return res.status(500).json({ error: "Failed to update policy" });
	}
});

// DELETE /api/v1/patch-management/policies/:id - Delete a policy
router.delete("/policies/:id", authenticateToken, async (req, res) => {
	try {
		const { id } = req.params;
		const existing = await prisma.patch_policies.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ error: "Policy not found" });

		await prisma.patch_policies.delete({ where: { id } });
		logger.info(`[PatchMgmt] Policy "${existing.name}" deleted by ${req.user?.username}`);
		return res.json({ success: true, message: "Policy deleted" });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to delete policy: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete policy" });
	}
});

// ============================================================================
// WINDOWS (Maintenance Windows)
// ============================================================================

// GET /api/v1/patch-management/windows - List all maintenance windows
router.get("/windows", authenticateToken, async (req, res) => {
	try {
		const { policy_id, enabled } = req.query;
		const where = {};
		if (policy_id) where.policy_id = policy_id;
		if (enabled !== undefined) where.enabled = enabled === "true";

		const windows = await prisma.patch_windows.findMany({
			where,
			include: {
				policy: { select: { id: true, name: true } },
				_count: { select: { patch_jobs: true } },
			},
			orderBy: { next_run_at: "asc" },
		});

		return res.json({ success: true, windows });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to list windows: ${error.message}`);
		return res.status(500).json({ error: "Failed to list maintenance windows" });
	}
});

// GET /api/v1/patch-management/windows/:id - Get a single window
router.get("/windows/:id", authenticateToken, async (req, res) => {
	try {
		const window = await prisma.patch_windows.findUnique({
			where: { id: req.params.id },
			include: {
				policy: { select: { id: true, name: true } },
				patch_jobs: {
					orderBy: { created_at: "desc" },
					take: 20,
				},
			},
		});

		if (!window) return res.status(404).json({ error: "Window not found" });
		return res.json({ success: true, window });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to get window: ${error.message}`);
		return res.status(500).json({ error: "Failed to get maintenance window" });
	}
});

// POST /api/v1/patch-management/windows - Create a maintenance window
router.post("/windows", authenticateToken, async (req, res) => {
	try {
		const {
			name,
			description,
			policy_id,
			schedule_type = "recurring",
			schedule_cron,
			schedule_timezone = "UTC",
			duration_minutes = 120,
		} = req.body;

		if (!name) return res.status(400).json({ error: "Window name is required" });
		if (!policy_id) return res.status(400).json({ error: "Policy ID is required" });

		const policy = await prisma.patch_policies.findUnique({ where: { id: policy_id } });
		if (!policy) return res.status(404).json({ error: "Policy not found" });

		if (schedule_type === "recurring" && !schedule_cron) {
			return res.status(400).json({ error: "Cron expression is required for recurring windows" });
		}

		const nextRun = schedule_cron ? computeNextRun(schedule_cron, schedule_timezone) : null;

		const window = await prisma.patch_windows.create({
			data: {
				id: uuidv4(),
				name,
				description,
				policy_id,
				schedule_type,
				schedule_cron,
				schedule_timezone,
				duration_minutes,
				next_run_at: nextRun,
				enabled: true,
				created_by: req.user?.id,
				updated_at: new Date(),
			},
		});

		logger.info(`[PatchMgmt] Window "${name}" created for policy "${policy.name}"`);
		return res.status(201).json({ success: true, window });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to create window: ${error.message}`);
		return res.status(500).json({ error: "Failed to create maintenance window" });
	}
});

// PUT /api/v1/patch-management/windows/:id - Update a window
router.put("/windows/:id", authenticateToken, async (req, res) => {
	try {
		const { id } = req.params;
		const {
			name,
			description,
			schedule_type,
			schedule_cron,
			schedule_timezone,
			duration_minutes,
			enabled,
		} = req.body;

		const existing = await prisma.patch_windows.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ error: "Window not found" });

		const updatedCron = schedule_cron !== undefined ? schedule_cron : existing.schedule_cron;
		const updatedTz = schedule_timezone !== undefined ? schedule_timezone : existing.schedule_timezone;
		const nextRun = updatedCron ? computeNextRun(updatedCron, updatedTz) : null;

		const window = await prisma.patch_windows.update({
			where: { id },
			data: {
				...(name !== undefined && { name }),
				...(description !== undefined && { description }),
				...(schedule_type !== undefined && { schedule_type }),
				...(schedule_cron !== undefined && { schedule_cron }),
				...(schedule_timezone !== undefined && { schedule_timezone }),
				...(duration_minutes !== undefined && { duration_minutes }),
				...(enabled !== undefined && { enabled }),
				next_run_at: nextRun,
				updated_at: new Date(),
			},
		});

		return res.json({ success: true, window });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to update window: ${error.message}`);
		return res.status(500).json({ error: "Failed to update maintenance window" });
	}
});

// DELETE /api/v1/patch-management/windows/:id - Delete a window
router.delete("/windows/:id", authenticateToken, async (req, res) => {
	try {
		const { id } = req.params;
		const existing = await prisma.patch_windows.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ error: "Window not found" });

		await prisma.patch_windows.delete({ where: { id } });
		logger.info(`[PatchMgmt] Window "${existing.name}" deleted`);
		return res.json({ success: true, message: "Window deleted" });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to delete window: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete maintenance window" });
	}
});

// ============================================================================
// JOBS
// ============================================================================

// GET /api/v1/patch-management/jobs - List jobs (with filtering)
router.get("/jobs", authenticateToken, async (req, res) => {
	try {
		const { policy_id, status, limit = "50", offset = "0" } = req.query;
		const where = {};
		if (policy_id) where.policy_id = policy_id;
		if (status) where.status = status;

		const [jobs, total] = await Promise.all([
			prisma.patch_jobs.findMany({
				where,
				include: {
					policy: { select: { id: true, name: true } },
					window: { select: { id: true, name: true } },
					_count: { select: { patch_job_hosts: true } },
				},
				orderBy: { created_at: "desc" },
				take: parseInt(limit, 10),
				skip: parseInt(offset, 10),
			}),
			prisma.patch_jobs.count({ where }),
		]);

		return res.json({ success: true, jobs, total });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to list jobs: ${error.message}`);
		return res.status(500).json({ error: "Failed to list jobs" });
	}
});

// GET /api/v1/patch-management/jobs/:id - Get a single job with hosts
router.get("/jobs/:id", authenticateToken, async (req, res) => {
	try {
		const job = await prisma.patch_jobs.findUnique({
			where: { id: req.params.id },
			include: {
				policy: { select: { id: true, name: true, policy_type: true, reboot_policy: true } },
				window: { select: { id: true, name: true } },
				patch_job_hosts: {
					include: {
						host: { select: { id: true, friendly_name: true, hostname: true, os_type: true, os_version: true } },
						patch_job_packages: true,
					},
					orderBy: { started_at: "asc" },
				},
			},
		});

		if (!job) return res.status(404).json({ error: "Job not found" });
		return res.json({ success: true, job });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to get job: ${error.message}`);
		return res.status(500).json({ error: "Failed to get job" });
	}
});

// GET /api/v1/patch-management/jobs/:jobId/hosts/:jobHostId/diff - Get snapshot diff for a host
router.get("/jobs/:jobId/hosts/:jobHostId/diff", authenticateToken, async (req, res) => {
	try {
		const { jobHostId } = req.params;

		const jobHost = await prisma.patch_job_hosts.findUnique({
			where: { id: jobHostId },
			include: {
				host: { select: { id: true, friendly_name: true, hostname: true } },
			},
		});

		if (!jobHost) return res.status(404).json({ error: "Job host record not found" });

		const diff = computeSnapshotDiff(jobHost.pre_snapshot, jobHost.post_snapshot);

		return res.json({
			success: true,
			host: jobHost.host,
			pre_snapshot: jobHost.pre_snapshot,
			post_snapshot: jobHost.post_snapshot,
			diff,
		});
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to compute diff: ${error.message}`);
		return res.status(500).json({ error: "Failed to compute snapshot diff" });
	}
});

// POST /api/v1/patch-management/jobs/trigger - Trigger a new patch job
router.post("/jobs/trigger", authenticateToken, async (req, res) => {
	try {
		const { policy_id } = req.body;
		if (!policy_id) return res.status(400).json({ error: "Policy ID is required" });

		const result = await createPatchJob(policy_id, {
			triggeredBy: "manual",
			triggeredByUser: req.user?.id,
		});

		return res.status(201).json({
			success: true,
			job: result.job,
			hosts_count: result.hostsCount,
		});
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to trigger job: ${error.message}`);
		return res.status(400).json({ error: error.message });
	}
});

// POST /api/v1/patch-management/jobs/:id/cancel - Cancel a running/pending job
router.post("/jobs/:id/cancel", authenticateToken, async (req, res) => {
	try {
		const { id } = req.params;
		const job = await prisma.patch_jobs.findUnique({ where: { id } });
		if (!job) return res.status(404).json({ error: "Job not found" });
		if (!["pending", "running"].includes(job.status)) {
			return res.status(400).json({ error: "Only pending or running jobs can be cancelled" });
		}

		await prisma.$transaction(async (tx) => {
			await tx.patch_jobs.update({
				where: { id },
				data: {
					status: "cancelled",
					completed_at: new Date(),
				},
			});

			// Skip all pending hosts
			await tx.patch_job_hosts.updateMany({
				where: { job_id: id, status: "pending" },
				data: {
					status: "skipped",
					error_message: "Job cancelled by user",
				},
			});
		});

		logger.info(`[PatchMgmt] Job ${id} cancelled by ${req.user?.username}`);
		return res.json({ success: true, message: "Job cancelled" });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to cancel job: ${error.message}`);
		return res.status(500).json({ error: "Failed to cancel job" });
	}
});

// ============================================================================
// DASHBOARD / STATISTICS
// ============================================================================

// GET /api/v1/patch-management/stats - Overview statistics
router.get("/stats", authenticateToken, async (req, res) => {
	try {
		const [
			totalPolicies,
			activePolicies,
			totalWindows,
			activeWindows,
			recentJobs,
			pendingJobs,
			runningJobs,
		] = await Promise.all([
			prisma.patch_policies.count(),
			prisma.patch_policies.count({ where: { enabled: true } }),
			prisma.patch_windows.count(),
			prisma.patch_windows.count({ where: { enabled: true } }),
			prisma.patch_jobs.findMany({
				orderBy: { created_at: "desc" },
				take: 5,
				include: {
					policy: { select: { name: true } },
					_count: { select: { patch_job_hosts: true } },
				},
			}),
			prisma.patch_jobs.count({ where: { status: "pending" } }),
			prisma.patch_jobs.count({ where: { status: "running" } }),
		]);

		// Upcoming windows
		const upcomingWindows = await prisma.patch_windows.findMany({
			where: {
				enabled: true,
				next_run_at: { gte: new Date() },
			},
			include: {
				policy: { select: { name: true } },
			},
			orderBy: { next_run_at: "asc" },
			take: 5,
		});

		// Job success rate (last 30 days)
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const recentJobCounts = await prisma.patch_jobs.groupBy({
			by: ["status"],
			where: { created_at: { gte: thirtyDaysAgo } },
			_count: true,
		});

		const jobStats = {};
		for (const row of recentJobCounts) {
			jobStats[row.status] = row._count;
		}

		return res.json({
			success: true,
			stats: {
				policies: { total: totalPolicies, active: activePolicies },
				windows: { total: totalWindows, active: activeWindows },
				jobs: {
					pending: pendingJobs,
					running: runningJobs,
					recent: recentJobs,
					last_30_days: jobStats,
				},
				upcoming_windows: upcomingWindows,
			},
		});
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to get stats: ${error.message}`);
		return res.status(500).json({ error: "Failed to get patch management stats" });
	}
});

// GET /api/v1/patch-management/history - Full job history with pagination
router.get("/history", authenticateToken, async (req, res) => {
	try {
		const { limit = "25", offset = "0", policy_id, status } = req.query;
		const where = {};
		if (policy_id) where.policy_id = policy_id;
		if (status) where.status = status;

		const [jobs, total] = await Promise.all([
			prisma.patch_jobs.findMany({
				where,
				include: {
					policy: { select: { id: true, name: true } },
					window: { select: { id: true, name: true } },
					patch_job_hosts: {
						select: {
							id: true,
							host_id: true,
							status: true,
							packages_updated: true,
							packages_failed: true,
							host: { select: { friendly_name: true, hostname: true } },
						},
					},
				},
				orderBy: { created_at: "desc" },
				take: parseInt(limit, 10),
				skip: parseInt(offset, 10),
			}),
			prisma.patch_jobs.count({ where }),
		]);

		return res.json({ success: true, jobs, total });
	} catch (error) {
		logger.error(`[PatchMgmt] Failed to get history: ${error.message}`);
		return res.status(500).json({ error: "Failed to get patch history" });
	}
});

// ============================================================================
// AGENT-FACING ENDPOINTS
// ============================================================================

/**
 * Authenticate agent by API key headers.
 */
async function authenticateAgent(req, res) {
	const apiId = req.headers["x-api-id"];
	const apiKey = req.headers["x-api-key"];

	if (!apiId || !apiKey) {
		res.status(401).json({ error: "Missing API credentials" });
		return null;
	}

	const host = await prisma.hosts.findUnique({
		where: { api_id: apiId },
		select: { id: true, api_key: true, friendly_name: true, hostname: true },
	});

	if (!host) {
		res.status(401).json({ error: "Invalid API credentials" });
		return null;
	}

	const valid = await verifyApiKey(apiKey, host.api_key);
	if (!valid) {
		res.status(401).json({ error: "Invalid API credentials" });
		return null;
	}

	return host;
}

// GET /api/v1/patch-management/agent/pending - Agent fetches its pending patch job
router.get("/agent/pending", async (req, res) => {
	try {
		const host = await authenticateAgent(req, res);
		if (!host) return;

		const pending = await getPendingJobForHost(host.id);
		if (!pending) {
			return res.json({ success: true, has_work: false });
		}

		return res.json({ success: true, has_work: true, assignment: pending });
	} catch (error) {
		logger.error(`[PatchMgmt] Agent pending check failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to check for pending work" });
	}
});

// POST /api/v1/patch-management/agent/report - Agent reports patch results
router.post("/agent/report", async (req, res) => {
	try {
		const host = await authenticateAgent(req, res);
		if (!host) return;

		const result = await processAgentPatchReport(host.id, req.body);
		return res.json(result);
	} catch (error) {
		logger.error(`[PatchMgmt] Agent report failed: ${error.message}`);
		return res.status(400).json({ error: error.message });
	}
});

// POST /api/v1/patch-management/agent/status - Agent updates its host-job status
router.post("/agent/status", async (req, res) => {
	try {
		const host = await authenticateAgent(req, res);
		if (!host) return;

		const { job_host_id, status } = req.body;
		if (!job_host_id || !status) {
			return res.status(400).json({ error: "job_host_id and status are required" });
		}

		const jobHost = await prisma.patch_job_hosts.findUnique({
			where: { id: job_host_id },
		});

		if (!jobHost || jobHost.host_id !== host.id) {
			return res.status(404).json({ error: "Job host record not found" });
		}

		const updateData = { status };
		if (status === "downloading" || status === "installing") {
			if (!jobHost.started_at) updateData.started_at = new Date();
		}

		await prisma.patch_job_hosts.update({
			where: { id: job_host_id },
			data: updateData,
		});

		// If this is the first host to start, mark the job as running
		const job = await prisma.patch_jobs.findUnique({
			where: { id: jobHost.job_id },
		});
		if (job && job.status === "pending") {
			await prisma.patch_jobs.update({
				where: { id: job.id },
				data: { status: "running", started_at: new Date() },
			});
		}

		return res.json({ success: true });
	} catch (error) {
		logger.error(`[PatchMgmt] Agent status update failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to update status" });
	}
});

module.exports = router;
