const { prisma } = require("./automation/shared/prisma");
const logger = require("../utils/logger");
const alertService = require("./alertService");
const alertConfigService = require("./alertConfigService");

/**
 * Host Report Alert Evaluator
 *
 * Evaluates alert conditions after a host submits its periodic report.
 * Runs asynchronously (fire-and-forget) so it doesn't slow down the
 * host-update response.
 *
 * Alert types evaluated:
 *   - disk_space_warning   : any disk partition exceeds usage threshold
 *   - high_load_average    : 15-min load average exceeds per-core threshold
 *   - reboot_required      : host reports needs_reboot = true
 *   - security_updates     : host has pending security updates
 */

// ---------------------------------------------------------------------------
// Default thresholds (overridable via alert_config.metadata JSON)
// ---------------------------------------------------------------------------
const DEFAULTS = {
	disk_space_warning: { threshold_percent: 85 },
	high_load_average: { per_core_threshold: 2.0 },
	reboot_required: {},
	security_updates: { min_count: 1 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the agent's human-readable disk size string into a numeric percentage.
 * Format: "50.00GB (25.00GB used, 25.00GB free, 50.0% used)"
 */
function parseDiskUsagePercent(sizeStr) {
	if (!sizeStr) return null;
	const match = sizeStr.match(/([\d.]+)%\s*used/);
	return match ? Number.parseFloat(match[1]) : null;
}

/**
 * Find or create an alert for a specific host + alert type.
 * De-duplicates by checking for an existing active alert with matching
 * host_id in metadata.
 */
async function findExistingHostAlert(alertType, hostId) {
	const existing = await prisma.alerts.findFirst({
		where: {
			type: alertType,
			is_active: true,
			metadata: {
				path: ["host_id"],
				equals: hostId,
			},
		},
	});
	return existing;
}

/**
 * Auto-resolve all active alerts of the given type for a specific host.
 */
async function autoResolveHostAlerts(alertType, hostId, reason) {
	const active = await prisma.alerts.findMany({
		where: {
			type: alertType,
			is_active: true,
			metadata: {
				path: ["host_id"],
				equals: hostId,
			},
		},
	});

	for (const alert of active) {
		await alertService.performAlertAction(null, alert.id, "resolved", {
			resolved_reason: reason,
			system_action: true,
		});
	}
	return active.length;
}

/**
 * Create an alert if one doesn't already exist, honouring enable flags
 * and auto-assignment rules.
 */
async function maybeCreateAlert(alertType, severity, title, message, metadata) {
	const existing = await findExistingHostAlert(alertType, metadata.host_id);
	if (existing) {
		// Touch updated_at so admins know the condition persists
		await prisma.alerts.update({
			where: { id: existing.id },
			data: { updated_at: new Date() },
		});
		return null; // already open
	}

	const alert = await alertService.createAlert(
		alertType,
		severity,
		title,
		message,
		metadata,
	);

	if (!alert) return null;

	// Auto-assign if configured
	const config = await alertConfigService.getAlertConfigByType(alertType);
	if (config?.auto_assign_enabled && config?.auto_assign_user_id) {
		await alertService.assignAlertToUser(
			alert.id,
			config.auto_assign_user_id,
			null,
		);
	}

	return alert;
}

// ---------------------------------------------------------------------------
// Individual evaluators
// ---------------------------------------------------------------------------

async function evaluateDiskSpace(host, hostName, config) {
	const disks = host.disk_details;
	if (!Array.isArray(disks) || disks.length === 0) return;

	const meta = { ...DEFAULTS.disk_space_warning, ...(config?.metadata || {}) };
	const threshold = meta.threshold_percent;
	const severity = config?.default_severity || "warning";

	const overThreshold = [];
	for (const disk of disks) {
		const pct = parseDiskUsagePercent(disk.size);
		if (pct !== null && pct >= threshold) {
			overThreshold.push({
				mountpoint: disk.mountpoint,
				name: disk.name,
				percent: pct,
				size: disk.size,
			});
		}
	}

	if (overThreshold.length > 0) {
		const worst = overThreshold.reduce((a, b) =>
			a.percent > b.percent ? a : b,
		);
		const diskList = overThreshold
			.map((d) => `${d.mountpoint} (${d.percent.toFixed(1)}%)`)
			.join(", ");

		await maybeCreateAlert(
			"disk_space_warning",
			severity,
			`Low disk space on ${hostName}`,
			`${overThreshold.length} partition(s) above ${threshold}% usage on "${hostName}": ${diskList}. Worst: ${worst.mountpoint} at ${worst.percent.toFixed(1)}%.`,
			{
				host_id: host.id,
				host_name: hostName,
				threshold_percent: threshold,
				partitions: overThreshold,
			},
		);
	} else {
		// All disks under threshold — auto-resolve if previously alerted
		const resolved = await autoResolveHostAlerts(
			"disk_space_warning",
			host.id,
			"All partitions are below threshold",
		);
		if (resolved > 0) {
			logger.info(
				`✅ Auto-resolved ${resolved} disk_space_warning alert(s) for ${hostName}`,
			);
		}
	}
}

async function evaluateLoadAverage(host, hostName, config) {
	const load = host.load_average;
	if (!Array.isArray(load) || load.length < 3) return;

	const meta = {
		...DEFAULTS.high_load_average,
		...(config?.metadata || {}),
	};
	const cores = host.cpu_cores || 1;
	const perCoreThreshold = meta.per_core_threshold;
	const absoluteThreshold = cores * perCoreThreshold;
	const severity = config?.default_severity || "warning";

	// We use the 15-minute load average (index 2) for stability
	const load15 = load[2];

	if (load15 > absoluteThreshold) {
		await maybeCreateAlert(
			"high_load_average",
			severity,
			`High load average on ${hostName}`,
			`15-minute load average on "${hostName}" is ${load15.toFixed(2)} (threshold: ${absoluteThreshold.toFixed(1)} for ${cores} cores). Load: ${load.map((l) => l.toFixed(2)).join(", ")}`,
			{
				host_id: host.id,
				host_name: hostName,
				load_average: load,
				cpu_cores: cores,
				threshold: absoluteThreshold,
				per_core_threshold: perCoreThreshold,
			},
		);
	} else {
		const resolved = await autoResolveHostAlerts(
			"high_load_average",
			host.id,
			"Load average returned to normal",
		);
		if (resolved > 0) {
			logger.info(
				`✅ Auto-resolved ${resolved} high_load_average alert(s) for ${hostName}`,
			);
		}
	}
}

async function evaluateRebootRequired(host, hostName, config) {
	const severity = config?.default_severity || "informational";

	if (host.needs_reboot) {
		await maybeCreateAlert(
			"reboot_required",
			severity,
			`Reboot required on ${hostName}`,
			`Host "${hostName}" requires a reboot.${host.reboot_reason ? ` Reason: ${host.reboot_reason}` : ""}`,
			{
				host_id: host.id,
				host_name: hostName,
				reboot_reason: host.reboot_reason || null,
			},
		);
	} else {
		const resolved = await autoResolveHostAlerts(
			"reboot_required",
			host.id,
			"Host has been rebooted",
		);
		if (resolved > 0) {
			logger.info(
				`✅ Auto-resolved ${resolved} reboot_required alert(s) for ${hostName}`,
			);
		}
	}
}

async function evaluateSecurityUpdates(host, hostName, config) {
	const meta = { ...DEFAULTS.security_updates, ...(config?.metadata || {}) };
	const minCount = meta.min_count;
	const severity = config?.default_severity || "warning";

	// Count security updates that need updating
	const securityUpdateCount = await prisma.host_packages.count({
		where: {
			host_id: host.id,
			needs_update: true,
			is_security_update: true,
		},
	});

	if (securityUpdateCount >= minCount) {
		await maybeCreateAlert(
			"security_updates",
			severity,
			`${securityUpdateCount} security update${securityUpdateCount !== 1 ? "s" : ""} on ${hostName}`,
			`Host "${hostName}" has ${securityUpdateCount} pending security update${securityUpdateCount !== 1 ? "s" : ""} available.`,
			{
				host_id: host.id,
				host_name: hostName,
				security_update_count: securityUpdateCount,
			},
		);
	} else {
		const resolved = await autoResolveHostAlerts(
			"security_updates",
			host.id,
			"All security updates have been applied",
		);
		if (resolved > 0) {
			logger.info(
				`✅ Auto-resolved ${resolved} security_updates alert(s) for ${hostName}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Main entry point — called after a host report is successfully processed
// ---------------------------------------------------------------------------

/**
 * Evaluate all host-report-based alert conditions.
 *
 * @param {object} host  - The host row (includes id, friendly_name, hostname, etc.)
 *                         Should be the *updated* data (post-transaction).
 * @param {object} reportData - Additional data from the report:
 *   { diskDetails, loadAverage, needsReboot, rebootReason, cpuCores }
 */
async function evaluateHostReportAlerts(host, reportData) {
	try {
		// Gate: master switch
		const alertsEnabled = await alertService.isAlertsEnabled();
		if (!alertsEnabled) return;

		const hostName =
			host.friendly_name || host.hostname || host.api_id || host.id;

		// Merge report data onto host object for evaluators that need the latest
		// values (we just saved them in the DB, but the host object may be stale).
		const mergedHost = {
			...host,
			disk_details: reportData.diskDetails ?? host.disk_details,
			load_average: reportData.loadAverage ?? host.load_average,
			cpu_cores: reportData.cpuCores ?? host.cpu_cores,
			needs_reboot:
				reportData.needsReboot !== undefined
					? reportData.needsReboot
					: host.needs_reboot,
			reboot_reason: reportData.rebootReason ?? host.reboot_reason,
		};

		// Fetch all relevant configs in one query
		const configs = await prisma.alert_config.findMany({
			where: {
				alert_type: {
					in: [
						"disk_space_warning",
						"high_load_average",
						"reboot_required",
						"security_updates",
					],
				},
			},
		});
		const configMap = new Map(configs.map((c) => [c.alert_type, c]));

		// Run evaluators in parallel
		await Promise.allSettled([
			configMap.get("disk_space_warning")?.is_enabled !== false
				? evaluateDiskSpace(
						mergedHost,
						hostName,
						configMap.get("disk_space_warning"),
					)
				: Promise.resolve(),
			configMap.get("high_load_average")?.is_enabled !== false
				? evaluateLoadAverage(
						mergedHost,
						hostName,
						configMap.get("high_load_average"),
					)
				: Promise.resolve(),
			configMap.get("reboot_required")?.is_enabled !== false
				? evaluateRebootRequired(
						mergedHost,
						hostName,
						configMap.get("reboot_required"),
					)
				: Promise.resolve(),
			configMap.get("security_updates")?.is_enabled !== false
				? evaluateSecurityUpdates(
						mergedHost,
						hostName,
						configMap.get("security_updates"),
					)
				: Promise.resolve(),
		]);
	} catch (error) {
		// Never let alert evaluation break the host report flow
		logger.error(
			`[AlertEvaluator] Error evaluating alerts for host ${host?.id}:`,
			error,
		);
	}
}

/**
 * Evaluate patch-job-level alerts.
 * Called when a patch job transitions to a terminal state.
 *
 * @param {object} job - The patch_jobs row
 * @param {string} newStatus - completed | completed_with_errors | failed
 */
async function evaluatePatchJobAlerts(job, newStatus) {
	try {
		const alertsEnabled = await alertService.isAlertsEnabled();
		if (!alertsEnabled) return;

		const config =
			await alertConfigService.getAlertConfigByType("patch_job_failed");
		if (!config || !config.is_enabled) return;

		if (newStatus === "failed" || newStatus === "completed_with_errors") {
			const severity = config.default_severity || "error";

			// Get policy name for context
			const policy = await prisma.patch_policies.findUnique({
				where: { id: job.policy_id },
				select: { name: true },
			});
			const policyName = policy?.name || "Unknown Policy";

			const title =
				newStatus === "failed"
					? `Patch job failed: ${policyName}`
					: `Patch job completed with errors: ${policyName}`;

			const message =
				newStatus === "failed"
					? `Patch job for policy "${policyName}" failed. ${job.failed_hosts || 0} host(s) failed out of ${job.total_hosts || 0}.`
					: `Patch job for policy "${policyName}" completed with errors. ${job.completed_hosts || 0} succeeded, ${job.failed_hosts || 0} failed, ${job.skipped_hosts || 0} skipped out of ${job.total_hosts || 0} host(s).`;

			// Check for existing alert for this specific job
			const existing = await prisma.alerts.findFirst({
				where: {
					type: "patch_job_failed",
					is_active: true,
					metadata: {
						path: ["job_id"],
						equals: job.id,
					},
				},
			});

			if (!existing) {
				const alert = await alertService.createAlert(
					"patch_job_failed",
					severity,
					title,
					message,
					{
						job_id: job.id,
						policy_id: job.policy_id,
						policy_name: policyName,
						status: newStatus,
						total_hosts: job.total_hosts,
						completed_hosts: job.completed_hosts,
						failed_hosts: job.failed_hosts,
						skipped_hosts: job.skipped_hosts,
					},
				);

				if (alert && config.auto_assign_enabled && config.auto_assign_user_id) {
					await alertService.assignAlertToUser(
						alert.id,
						config.auto_assign_user_id,
						null,
					);
				}
			}
		}
	} catch (error) {
		logger.error(
			`[AlertEvaluator] Error evaluating patch job alert for job ${job?.id}:`,
			error,
		);
	}
}

module.exports = {
	evaluateHostReportAlerts,
	evaluatePatchJobAlerts,
	parseDiskUsagePercent,
};
