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
const {
	requireViewPatchManagement,
	requireManagePatchManagement,
} = require("../middleware/permissions");

const prisma = getPrismaClient();
const router = express.Router();

// ============================================================================
// POLICIES
// ============================================================================

// GET /api/v1/patch-management/policies - List all policies
router.get(
	"/policies",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Policies'] */
		/* #swagger.summary = 'List all patch policies' */
		/* #swagger.description = 'Retrieve all patch policies with linked groups, filters, window/job counts, and computed host_count. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['enabled'] = { in: 'query', type: 'string', description: 'Filter by enabled status (true/false)', required: false } */
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
	},
);

// GET /api/v1/patch-management/policies/:id - Get a single policy
router.get(
	"/policies/:id",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Policies'] */
		/* #swagger.summary = 'Get a patch policy by ID' */
		/* #swagger.description = 'Retrieve a single policy with groups, filters, windows, recent jobs, and per-host updatable package counts. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
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
					security_updates: targetPkgs.filter((p) => p.is_security_update)
						.length,
				};
			});

			return res.json({ success: true, policy, hosts: hostSummaries });
		} catch (error) {
			logger.error(`[PatchMgmt] Failed to get policy: ${error.message}`);
			return res.status(500).json({ error: "Failed to get policy" });
		}
	},
);

// POST /api/v1/patch-management/policies - Create a policy
router.post(
	"/policies",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Policies'] */
		/* #swagger.summary = 'Create a patch policy' */
		/* #swagger.description = 'Create a new patch policy with optional group and filter links. Returns 409 on duplicate name. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Security Patches Only',
			description: 'Apply security patches to production',
			policy_type: 'security_only',
			auto_approve: false,
			approval_timeout_hours: 72,
			reboot_policy: 'if_needed',
			pre_snapshot: true,
			post_snapshot: true,
			max_concurrent_hosts: 5,
			stop_on_failure_percent: 30,
			group_ids: ['uuid-of-group'],
			filters: [{ filter_type: 'exclude', match_type: 'glob', pattern: 'kernel*' }]
		}
	} */
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

			if (!name)
				return res.status(400).json({ error: "Policy name is required" });
			if (!["all", "security_only", "selected"].includes(policy_type)) {
				return res.status(400).json({
					error: "Invalid policy_type. Must be: all, security_only, selected",
				});
			}
			if (!["never", "if_needed", "always"].includes(reboot_policy)) {
				return res.status(400).json({
					error: "Invalid reboot_policy. Must be: never, if_needed, always",
				});
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

			logger.info(
				`[PatchMgmt] Policy "${name}" created by ${req.user?.username}`,
			);
			return res.status(201).json({ success: true, policy });
		} catch (error) {
			if (error.code === "P2002") {
				return res
					.status(409)
					.json({ error: "A policy with this name already exists" });
			}
			logger.error(`[PatchMgmt] Failed to create policy: ${error.message}`);
			return res.status(500).json({ error: "Failed to create policy" });
		}
	},
);

// PUT /api/v1/patch-management/policies/:id - Update a policy
router.put(
	"/policies/:id",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Policies'] */
		/* #swagger.summary = 'Update a patch policy' */
		/* #swagger.description = 'Update policy fields. If group_ids or filters provided, replaces all links atomically. Returns 409 on duplicate name. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Updated Policy Name',
			enabled: true,
			policy_type: 'all',
			reboot_policy: 'never',
			group_ids: ['uuid-of-group'],
			filters: []
		}
	} */
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

			const existing = await prisma.patch_policies.findUnique({
				where: { id },
			});
			if (!existing) return res.status(404).json({ error: "Policy not found" });

			await prisma.$transaction(async (tx) => {
				await tx.patch_policies.update({
					where: { id },
					data: {
						...(name !== undefined && { name }),
						...(description !== undefined && { description }),
						...(policy_type !== undefined && { policy_type }),
						...(auto_approve !== undefined && { auto_approve }),
						...(approval_timeout_hours !== undefined && {
							approval_timeout_hours,
						}),
						...(reboot_policy !== undefined && { reboot_policy }),
						...(pre_snapshot !== undefined && { pre_snapshot }),
						...(post_snapshot !== undefined && { post_snapshot }),
						...(max_concurrent_hosts !== undefined && { max_concurrent_hosts }),
						...(stop_on_failure_percent !== undefined && {
							stop_on_failure_percent,
						}),
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
					await tx.patch_policy_filters.deleteMany({
						where: { policy_id: id },
					});
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
						include: {
							host_groups: { select: { id: true, name: true, color: true } },
						},
					},
					patch_policy_filters: true,
				},
			});

			logger.info(
				`[PatchMgmt] Policy "${updated.name}" updated by ${req.user?.username}`,
			);
			return res.json({ success: true, policy: updated });
		} catch (error) {
			if (error.code === "P2002") {
				return res
					.status(409)
					.json({ error: "A policy with this name already exists" });
			}
			logger.error(`[PatchMgmt] Failed to update policy: ${error.message}`);
			return res.status(500).json({ error: "Failed to update policy" });
		}
	},
);

// DELETE /api/v1/patch-management/policies/:id - Delete a policy
router.delete(
	"/policies/:id",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Policies'] */
		/* #swagger.summary = 'Delete a patch policy' */
		/* #swagger.description = 'Delete a patch policy by ID. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const { id } = req.params;
			const existing = await prisma.patch_policies.findUnique({
				where: { id },
			});
			if (!existing) return res.status(404).json({ error: "Policy not found" });

			await prisma.patch_policies.delete({ where: { id } });
			logger.info(
				`[PatchMgmt] Policy "${existing.name}" deleted by ${req.user?.username}`,
			);
			return res.json({ success: true, message: "Policy deleted" });
		} catch (error) {
			logger.error(`[PatchMgmt] Failed to delete policy: ${error.message}`);
			return res.status(500).json({ error: "Failed to delete policy" });
		}
	},
);

// ============================================================================
// WINDOWS (Maintenance Windows)
// ============================================================================

// GET /api/v1/patch-management/windows - List all maintenance windows
router.get(
	"/windows",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Windows'] */
		/* #swagger.summary = 'List maintenance windows' */
		/* #swagger.description = 'List all maintenance windows with policy name and job count. Ordered by next_run_at. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['policy_id'] = { in: 'query', type: 'string', description: 'Filter by policy ID', required: false } */
		/* #swagger.parameters['enabled'] = { in: 'query', type: 'string', description: 'Filter by enabled status (true/false)', required: false } */
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
			return res
				.status(500)
				.json({ error: "Failed to list maintenance windows" });
		}
	},
);

// GET /api/v1/patch-management/windows/:id - Get a single window
router.get(
	"/windows/:id",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Windows'] */
		/* #swagger.summary = 'Get a maintenance window by ID' */
		/* #swagger.description = 'Retrieve a single window with policy name and last 20 jobs. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
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
			return res
				.status(500)
				.json({ error: "Failed to get maintenance window" });
		}
	},
);

// POST /api/v1/patch-management/windows - Create a maintenance window
router.post(
	"/windows",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Windows'] */
		/* #swagger.summary = 'Create a maintenance window' */
		/* #swagger.description = 'Create a maintenance window for a policy. Computes next_run_at from cron expression. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Saturday Night Window',
			description: 'Weekly patch window',
			policy_id: 'uuid-of-policy',
			schedule_type: 'recurring',
			schedule_cron: '0 2 * * 6',
			schedule_timezone: 'America/New_York',
			duration_minutes: 120
		}
	} */
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

			if (!name)
				return res.status(400).json({ error: "Window name is required" });
			if (!policy_id)
				return res.status(400).json({ error: "Policy ID is required" });

			const policy = await prisma.patch_policies.findUnique({
				where: { id: policy_id },
			});
			if (!policy) return res.status(404).json({ error: "Policy not found" });

			if (schedule_type === "recurring" && !schedule_cron) {
				return res
					.status(400)
					.json({ error: "Cron expression is required for recurring windows" });
			}

			const nextRun = schedule_cron
				? computeNextRun(schedule_cron, schedule_timezone)
				: null;

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

			logger.info(
				`[PatchMgmt] Window "${name}" created for policy "${policy.name}"`,
			);
			return res.status(201).json({ success: true, window });
		} catch (error) {
			logger.error(`[PatchMgmt] Failed to create window: ${error.message}`);
			return res
				.status(500)
				.json({ error: "Failed to create maintenance window" });
		}
	},
);

// PUT /api/v1/patch-management/windows/:id - Update a window
router.put(
	"/windows/:id",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Windows'] */
		/* #swagger.summary = 'Update a maintenance window' */
		/* #swagger.description = 'Update window fields. Recomputes next_run_at from cron. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Updated Window',
			schedule_cron: '0 3 * * 0',
			duration_minutes: 180,
			enabled: true
		}
	} */
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

			const updatedCron =
				schedule_cron !== undefined ? schedule_cron : existing.schedule_cron;
			const updatedTz =
				schedule_timezone !== undefined
					? schedule_timezone
					: existing.schedule_timezone;
			const nextRun = updatedCron
				? computeNextRun(updatedCron, updatedTz)
				: null;

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
			return res
				.status(500)
				.json({ error: "Failed to update maintenance window" });
		}
	},
);

// DELETE /api/v1/patch-management/windows/:id - Delete a window
router.delete(
	"/windows/:id",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Windows'] */
		/* #swagger.summary = 'Delete a maintenance window' */
		/* #swagger.description = 'Delete a maintenance window by ID. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const { id } = req.params;
			const existing = await prisma.patch_windows.findUnique({ where: { id } });
			if (!existing) return res.status(404).json({ error: "Window not found" });

			await prisma.patch_windows.delete({ where: { id } });
			logger.info(`[PatchMgmt] Window "${existing.name}" deleted`);
			return res.json({ success: true, message: "Window deleted" });
		} catch (error) {
			logger.error(`[PatchMgmt] Failed to delete window: ${error.message}`);
			return res
				.status(500)
				.json({ error: "Failed to delete maintenance window" });
		}
	},
);

// ============================================================================
// JOBS
// ============================================================================

// GET /api/v1/patch-management/jobs - List jobs (with filtering)
router.get(
	"/jobs",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Jobs'] */
		/* #swagger.summary = 'List patch jobs' */
		/* #swagger.description = 'List patch jobs with filtering and pagination. Includes policy/window names and host count. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['policy_id'] = { in: 'query', type: 'string', description: 'Filter by policy ID', required: false } */
		/* #swagger.parameters['status'] = { in: 'query', type: 'string', description: 'Filter by status (pending/running/completed/failed/cancelled)', required: false } */
		/* #swagger.parameters['limit'] = { in: 'query', type: 'integer', description: 'Max results (default 50)', required: false } */
		/* #swagger.parameters['offset'] = { in: 'query', type: 'integer', description: 'Pagination offset', required: false } */
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
	},
);

// GET /api/v1/patch-management/jobs/:id - Get a single job with hosts
router.get(
	"/jobs/:id",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Jobs'] */
		/* #swagger.summary = 'Get a patch job by ID' */
		/* #swagger.description = 'Retrieve a single job with policy details, window, and all patch_job_hosts with per-package results. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const job = await prisma.patch_jobs.findUnique({
				where: { id: req.params.id },
				include: {
					policy: {
						select: {
							id: true,
							name: true,
							policy_type: true,
							reboot_policy: true,
						},
					},
					window: { select: { id: true, name: true } },
					patch_job_hosts: {
						include: {
							host: {
								select: {
									id: true,
									friendly_name: true,
									hostname: true,
									os_type: true,
									os_version: true,
								},
							},
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
	},
);

// GET /api/v1/patch-management/jobs/:jobId/hosts/:jobHostId/diff - Get snapshot diff for a host
router.get(
	"/jobs/:jobId/hosts/:jobHostId/diff",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Jobs'] */
		/* #swagger.summary = 'Get before/after snapshot diff' */
		/* #swagger.description = 'Get before/after snapshot diff for a specific host in a patch job. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const { jobHostId } = req.params;

			const jobHost = await prisma.patch_job_hosts.findUnique({
				where: { id: jobHostId },
				include: {
					host: { select: { id: true, friendly_name: true, hostname: true } },
				},
			});

			if (!jobHost)
				return res.status(404).json({ error: "Job host record not found" });

			const diff = computeSnapshotDiff(
				jobHost.pre_snapshot,
				jobHost.post_snapshot,
			);

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
	},
);

// POST /api/v1/patch-management/jobs/trigger - Trigger a new patch job
router.post(
	"/jobs/trigger",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Jobs'] */
		/* #swagger.summary = 'Trigger a patch job manually' */
		/* #swagger.description = 'Manually trigger a new patch job for a policy. Creates the job and enqueues hosts. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: { policy_id: 'uuid-of-policy' }
	} */
		try {
			const { policy_id } = req.body;
			if (!policy_id)
				return res.status(400).json({ error: "Policy ID is required" });

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
	},
);

// POST /api/v1/patch-management/jobs/:id/cancel - Cancel a running/pending job
router.post(
	"/jobs/:id/cancel",
	authenticateToken,
	requireManagePatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Jobs'] */
		/* #swagger.summary = 'Cancel a patch job' */
		/* #swagger.description = 'Cancel a pending or running job. Marks job as cancelled and skips all pending hosts. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const { id } = req.params;
			const job = await prisma.patch_jobs.findUnique({ where: { id } });
			if (!job) return res.status(404).json({ error: "Job not found" });
			if (!["pending", "running"].includes(job.status)) {
				return res
					.status(400)
					.json({ error: "Only pending or running jobs can be cancelled" });
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
	},
);

// ============================================================================
// DASHBOARD / STATISTICS
// ============================================================================

// GET /api/v1/patch-management/stats - Overview statistics
router.get(
	"/stats",
	authenticateToken,
	requireViewPatchManagement,
	async (_req, res) => {
		/* #swagger.tags = ['Patch Management - Dashboard'] */
		/* #swagger.summary = 'Get patch management statistics' */
		/* #swagger.description = 'Rich analytics: policy/window/job counts, job trend (30d), host patch status breakdown, packages updated over time, per-policy success rates, reboot stats, top failing hosts, and more. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const prisma = getPrismaClient();
			const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
			const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

			const [
				totalPolicies,
				activePolicies,
				totalWindows,
				activeWindows,
				recentJobs,
				pendingJobs,
				runningJobs,
				totalHosts,
				patchEnabledHosts,
				hostsNeedingReboot,
			] = await Promise.all([
				prisma.patch_policies.count(),
				prisma.patch_policies.count({ where: { enabled: true } }),
				prisma.patch_windows.count(),
				prisma.patch_windows.count({ where: { enabled: true } }),
				prisma.patch_jobs.findMany({
					orderBy: { created_at: "desc" },
					take: 10,
					include: {
						policy: { select: { name: true } },
						_count: { select: { patch_job_hosts: true } },
					},
				}),
				prisma.patch_jobs.count({ where: { status: "pending" } }),
				prisma.patch_jobs.count({ where: { status: "running" } }),
				prisma.hosts.count({ where: { status: "active" } }),
				prisma.hosts.count({
					where: { status: "active", patchmanagement_enabled: true },
				}),
				prisma.hosts.count({ where: { status: "active", needs_reboot: true } }),
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

			// ── Job status breakdown (last 30 days) ──────────────────────
			const recentJobCounts = await prisma.patch_jobs.groupBy({
				by: ["status"],
				where: { created_at: { gte: thirtyDaysAgo } },
				_count: true,
			});
			const jobStats = {};
			for (const row of recentJobCounts) {
				jobStats[row.status] = row._count;
			}

			// ── Job trend (daily for last 30 days) ──────────────────────
			const allJobsLast30 = await prisma.patch_jobs.findMany({
				where: { created_at: { gte: thirtyDaysAgo } },
				select: { created_at: true, status: true },
				orderBy: { created_at: "asc" },
			});
			const jobTrend = buildDailyTrend(allJobsLast30, 30);

			// ── Packages updated over time (daily for last 30 days) ──────
			const jobHostsLast30 = await prisma.patch_job_hosts.findMany({
				where: {
					completed_at: { gte: thirtyDaysAgo },
					status: { in: ["completed", "failed"] },
				},
				select: {
					completed_at: true,
					packages_updated: true,
					packages_failed: true,
				},
			});
			const packageTrend = buildPackageTrend(jobHostsLast30, 30);

			// ── Per-policy success rates ──────────────────────────────────
			const policyJobs = await prisma.patch_jobs.findMany({
				where: { created_at: { gte: ninetyDaysAgo } },
				select: {
					policy_id: true,
					status: true,
					policy: { select: { name: true } },
				},
			});
			const policyBreakdown = buildPolicyBreakdown(policyJobs);

			// ── Host patch status breakdown ──────────────────────────────
			// Get the latest job_host status for each patch-enabled host
			const hostStatuses = await prisma.$queryRaw`
			SELECT
				COALESCE(latest.status, 'never_patched') AS patch_status,
				COUNT(*)::int AS count
			FROM hosts h
			LEFT JOIN LATERAL (
				SELECT pjh.status
				FROM patch_job_hosts pjh
				JOIN patch_jobs pj ON pj.id = pjh.job_id
				WHERE pjh.host_id = h.id
				ORDER BY pj.created_at DESC
				LIMIT 1
			) latest ON true
			WHERE h.status = 'active' AND h.patchmanagement_enabled = true
			GROUP BY patch_status
			ORDER BY count DESC
		`;
			const hostPatchStatus = {};
			for (const row of hostStatuses) {
				hostPatchStatus[row.patch_status] = Number(row.count);
			}

			// ── Top failing hosts (last 30 days) ─────────────────────────
			const topFailingHosts = await prisma.patch_job_hosts.groupBy({
				by: ["host_id"],
				where: {
					status: "failed",
					job: { created_at: { gte: thirtyDaysAgo } },
				},
				_count: true,
				orderBy: { _count: { host_id: "desc" } },
				take: 5,
			});
			// Enrich with host names
			let failingHostsEnriched = [];
			if (topFailingHosts.length > 0) {
				const hostIds = topFailingHosts.map((h) => h.host_id);
				const hosts = await prisma.hosts.findMany({
					where: { id: { in: hostIds } },
					select: { id: true, friendly_name: true, hostname: true },
				});
				const hostMap = {};
				for (const h of hosts) hostMap[h.id] = h;
				failingHostsEnriched = topFailingHosts.map((h) => ({
					host_id: h.host_id,
					failures: h._count,
					name:
						hostMap[h.host_id]?.friendly_name ||
						hostMap[h.host_id]?.hostname ||
						h.host_id,
				}));
			}

			// ── Reboot stats (from recent completed jobs) ────────────────
			const rebootStats = await prisma.patch_job_hosts.aggregate({
				where: {
					status: "completed",
					job: { created_at: { gte: thirtyDaysAgo } },
				},
				_sum: { packages_updated: true, packages_failed: true },
				_count: true,
			});
			const rebootRequired = await prisma.patch_job_hosts.count({
				where: {
					reboot_required: true,
					job: { created_at: { gte: thirtyDaysAgo } },
				},
			});
			const rebootCompleted = await prisma.patch_job_hosts.count({
				where: {
					reboot_required: true,
					reboot_completed: true,
					job: { created_at: { gte: thirtyDaysAgo } },
				},
			});

			// ── Triggered by breakdown (manual vs schedule) ──────────────
			const triggerBreakdown = await prisma.patch_jobs.groupBy({
				by: ["triggered_by"],
				where: { created_at: { gte: thirtyDaysAgo } },
				_count: true,
			});
			const triggerStats = {};
			for (const row of triggerBreakdown) {
				triggerStats[row.triggered_by] = row._count;
			}

			// ── Mean time to complete (last 30 days) ─────────────────────
			const completedJobs = await prisma.patch_jobs.findMany({
				where: {
					status: { in: ["completed", "completed_with_errors"] },
					started_at: { not: null },
					completed_at: { not: null },
					created_at: { gte: thirtyDaysAgo },
				},
				select: { started_at: true, completed_at: true },
			});
			let avgDurationMinutes = null;
			if (completedJobs.length > 0) {
				const totalMs = completedJobs.reduce((sum, j) => {
					return sum + (new Date(j.completed_at) - new Date(j.started_at));
				}, 0);
				avgDurationMinutes = Math.round(totalMs / completedJobs.length / 60000);
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
					// ── New analytics fields ─────────────────────────
					hosts: {
						total: totalHosts,
						patch_enabled: patchEnabledHosts,
						needs_reboot: hostsNeedingReboot,
						patch_status: hostPatchStatus,
					},
					job_trend: jobTrend,
					package_trend: packageTrend,
					policy_breakdown: policyBreakdown,
					top_failing_hosts: failingHostsEnriched,
					reboot: {
						required_30d: rebootRequired,
						completed_30d: rebootCompleted,
						hosts_needing_now: hostsNeedingReboot,
					},
					packages_30d: {
						updated: rebootStats._sum?.packages_updated || 0,
						failed: rebootStats._sum?.packages_failed || 0,
						host_patches: rebootStats._count || 0,
					},
					trigger_breakdown: triggerStats,
					avg_duration_minutes: avgDurationMinutes,
				},
			});
		} catch (error) {
			logger.error(`[PatchMgmt] Failed to get stats: ${error.message}`);
			return res
				.status(500)
				.json({ error: "Failed to get patch management stats" });
		}
	},
);

/**
 * Build a daily job trend for the last N days.
 * Returns array of { date, completed, failed, partial, total }
 */
function buildDailyTrend(jobs, days) {
	const trend = [];
	const now = new Date();
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		trend.push({
			date: key,
			completed: 0,
			failed: 0,
			partial: 0,
			cancelled: 0,
			total: 0,
		});
	}
	const dateMap = {};
	for (const t of trend) dateMap[t.date] = t;

	for (const job of jobs) {
		const key = new Date(job.created_at).toISOString().slice(0, 10);
		if (dateMap[key]) {
			dateMap[key].total++;
			if (job.status === "completed") dateMap[key].completed++;
			else if (job.status === "failed") dateMap[key].failed++;
			else if (job.status === "completed_with_errors") dateMap[key].partial++;
			else if (job.status === "cancelled") dateMap[key].cancelled++;
		}
	}
	return trend;
}

/**
 * Build daily package update trend.
 * Returns array of { date, updated, failed }
 */
function buildPackageTrend(jobHosts, days) {
	const trend = [];
	const now = new Date();
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		trend.push({ date: key, updated: 0, failed: 0 });
	}
	const dateMap = {};
	for (const t of trend) dateMap[t.date] = t;

	for (const jh of jobHosts) {
		if (!jh.completed_at) continue;
		const key = new Date(jh.completed_at).toISOString().slice(0, 10);
		if (dateMap[key]) {
			dateMap[key].updated += jh.packages_updated || 0;
			dateMap[key].failed += jh.packages_failed || 0;
		}
	}
	return trend;
}

/**
 * Build per-policy success/failure breakdown.
 * Returns array of { policy_id, name, completed, failed, partial, total }
 */
function buildPolicyBreakdown(policyJobs) {
	const map = {};
	for (const job of policyJobs) {
		if (!map[job.policy_id]) {
			map[job.policy_id] = {
				policy_id: job.policy_id,
				name: job.policy?.name || job.policy_id,
				completed: 0,
				failed: 0,
				partial: 0,
				total: 0,
			};
		}
		const entry = map[job.policy_id];
		entry.total++;
		if (job.status === "completed") entry.completed++;
		else if (job.status === "failed") entry.failed++;
		else if (job.status === "completed_with_errors") entry.partial++;
	}
	return Object.values(map).sort((a, b) => b.total - a.total);
}

// GET /api/v1/patch-management/hosts/:hostId/results - Patch results for a specific host
router.get(
	"/hosts/:hostId/results",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Hosts'] */
		/* #swagger.summary = 'Get patch results for a host' */
		/* #swagger.description = 'Retrieve all patch job results for a specific host, with job info, per-package details, and pagination. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['hostId'] = { in: 'path', type: 'string', description: 'Host UUID', required: true } */
		/* #swagger.parameters['limit'] = { in: 'query', type: 'integer', description: 'Max results (default 25)', required: false } */
		/* #swagger.parameters['offset'] = { in: 'query', type: 'integer', description: 'Pagination offset', required: false } */
		/* #swagger.parameters['status'] = { in: 'query', type: 'string', description: 'Filter by host-job status', required: false } */
		try {
			const { hostId } = req.params;
			const { limit = "25", offset = "0", status } = req.query;

			const where = { host_id: hostId };
			if (status) where.status = status;

			const [results, total] = await Promise.all([
				prisma.patch_job_hosts.findMany({
					where,
					include: {
						job: {
							select: {
								id: true,
								status: true,
								triggered_by: true,
								triggered_by_user: true,
								created_at: true,
								started_at: true,
								completed_at: true,
								total_hosts: true,
								completed_hosts: true,
								failed_hosts: true,
								policy: { select: { id: true, name: true } },
								window: { select: { id: true, name: true } },
							},
						},
						patch_job_packages: {
							orderBy: { package_name: "asc" },
						},
					},
					orderBy: { job: { created_at: "desc" } },
					take: parseInt(limit, 10),
					skip: parseInt(offset, 10),
				}),
				prisma.patch_job_hosts.count({ where }),
			]);

			// Summary stats for this host
			const allHostJobs = await prisma.patch_job_hosts.findMany({
				where: { host_id: hostId },
				select: { status: true, packages_updated: true, packages_failed: true },
			});

			const summary = {
				total_jobs: allHostJobs.length,
				completed: allHostJobs.filter((j) => j.status === "completed").length,
				failed: allHostJobs.filter((j) => j.status === "failed").length,
				skipped: allHostJobs.filter((j) => j.status === "skipped").length,
				total_packages_updated: allHostJobs.reduce(
					(sum, j) => sum + (j.packages_updated || 0),
					0,
				),
				total_packages_failed: allHostJobs.reduce(
					(sum, j) => sum + (j.packages_failed || 0),
					0,
				),
			};

			return res.json({ success: true, results, total, summary });
		} catch (error) {
			logger.error(
				`[PatchMgmt] Failed to get host patch results: ${error.message}`,
			);
			return res
				.status(500)
				.json({ error: "Failed to get host patch results" });
		}
	},
);

// GET /api/v1/patch-management/history - Full job history with pagination
router.get(
	"/history",
	authenticateToken,
	requireViewPatchManagement,
	async (req, res) => {
		/* #swagger.tags = ['Patch Management - Dashboard'] */
		/* #swagger.summary = 'Get full job history' */
		/* #swagger.description = 'Full job history with pagination and per-host details (status, packages updated/failed). Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['limit'] = { in: 'query', type: 'integer', description: 'Max results (default 25)', required: false } */
		/* #swagger.parameters['offset'] = { in: 'query', type: 'integer', description: 'Pagination offset', required: false } */
		/* #swagger.parameters['policy_id'] = { in: 'query', type: 'string', description: 'Filter by policy ID', required: false } */
		/* #swagger.parameters['status'] = { in: 'query', type: 'string', description: 'Filter by status', required: false } */
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
	},
);

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
	/* #swagger.tags = ['Patch Management - Agent'] */
	/* #swagger.summary = 'Agent: check for pending patch job' */
	/* #swagger.description = 'Agent checks if it has a pending patch job to execute. Returns has_job:true with job details or has_job:false. Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	try {
		const host = await authenticateAgent(req, res);
		if (!host) return;

		const pending = await getPendingJobForHost(host.id);
		if (!pending) {
			return res.json({ has_job: false });
		}

		return res.json({ has_job: true, job: pending });
	} catch (error) {
		logger.error(`[PatchMgmt] Agent pending check failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to check for pending work" });
	}
});

// POST /api/v1/patch-management/agent/report - Agent reports patch results
router.post("/agent/report", async (req, res) => {
	/* #swagger.tags = ['Patch Management - Agent'] */
	/* #swagger.summary = 'Agent: report patch results' */
	/* #swagger.description = 'Agent submits patch execution results. Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
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
	/* #swagger.tags = ['Patch Management - Agent'] */
	/* #swagger.summary = 'Agent: update job host status (POST)' */
	/* #swagger.description = 'Agent updates its job-host status. Body: job_host_id, status. If first host starts, marks parent job as running. Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: { job_host_id: 'uuid-of-job-host', status: 'downloading' }
	} */
	return handleAgentStatus(req, res);
});

// PUT /api/v1/patch-management/agent/status - Agent updates its host-job status (alias)
router.put("/agent/status", async (req, res) => {
	/* #swagger.tags = ['Patch Management - Agent'] */
	/* #swagger.summary = 'Agent: update job host status (PUT)' */
	/* #swagger.description = 'Agent updates its job-host status (alias for POST). Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: { job_host_id: 'uuid-of-job-host', status: 'downloading' }
	} */
	return handleAgentStatus(req, res);
});

async function handleAgentStatus(req, res) {
	try {
		const host = await authenticateAgent(req, res);
		if (!host) return;

		const { job_host_id, status } = req.body;
		if (!job_host_id || !status) {
			return res
				.status(400)
				.json({ error: "job_host_id and status are required" });
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
}

module.exports = router;
