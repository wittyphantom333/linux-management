const { prisma } = require("./shared/prisma");
const logger = require("../../utils/logger");

/**
 * Compliance Data Retention Automation
 * Automatically deletes old compliance scan data to prevent unbounded disk growth.
 * - compliance_results older than COMPLIANCE_RESULTS_RETENTION_DAYS (default 14)
 * - compliance_scans older than COMPLIANCE_SCANS_RETENTION_DAYS (default 30)
 */
class ComplianceDataRetention {
	constructor(queueManager) {
		this.queueManager = queueManager;
		this.queueName = "compliance-data-retention";
		this.resultsRetentionDays =
			parseInt(process.env.COMPLIANCE_RESULTS_RETENTION_DAYS, 10) || 14;
		this.scansRetentionDays =
			parseInt(process.env.COMPLIANCE_SCANS_RETENTION_DAYS, 10) || 30;
	}

	/**
	 * Process compliance data retention job
	 */
	async process(_job) {
		const startTime = Date.now();
		logger.info(
			`🧹 Starting compliance data retention (results: ${this.resultsRetentionDays}d, scans: ${this.scansRetentionDays}d)...`,
		);

		try {
			const resultsCutoff = new Date(
				Date.now() - this.resultsRetentionDays * 24 * 60 * 60 * 1000,
			);
			const scansCutoff = new Date(
				Date.now() - this.scansRetentionDays * 24 * 60 * 60 * 1000,
			);

			// Delete old compliance_results first (largest table)
			// Use scan started_at as the reference date via a subquery
			const oldScanIds = await prisma.compliance_scans.findMany({
				where: { started_at: { lt: resultsCutoff } },
				select: { id: true },
			});

			let resultsDeleted = 0;
			if (oldScanIds.length > 0) {
				// Batch delete in chunks to avoid excessive WAL generation
				const BATCH_SIZE = 500;
				for (let i = 0; i < oldScanIds.length; i += BATCH_SIZE) {
					const batch = oldScanIds.slice(i, i + BATCH_SIZE).map((s) => s.id);
					const result = await prisma.compliance_results.deleteMany({
						where: { scan_id: { in: batch } },
					});
					resultsDeleted += result.count;
				}
			}

			// Delete old compliance_scans (also removes raw_output bloat)
			const scansResult = await prisma.compliance_scans.deleteMany({
				where: { started_at: { lt: scansCutoff } },
			});

			// Also null out raw_output on scans older than results retention
			// (keeps the scan summary but removes the redundant blob)
			const rawOutputResult = await prisma.compliance_scans.updateMany({
				where: {
					started_at: { lt: resultsCutoff },
					raw_output: { not: null },
				},
				data: { raw_output: null },
			});

			const executionTime = Date.now() - startTime;
			logger.info(
				`✅ Compliance data retention completed in ${executionTime}ms - ` +
					`Results deleted: ${resultsDeleted}, Scans deleted: ${scansResult.count}, ` +
					`raw_output cleared: ${rawOutputResult.count}`,
			);

			return {
				success: true,
				resultsDeleted,
				scansDeleted: scansResult.count,
				rawOutputCleared: rawOutputResult.count,
				executionTime,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			logger.error(
				`❌ Compliance data retention failed after ${executionTime}ms:`,
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Schedule recurring compliance data retention (daily at 3:00 AM)
	 */
	async schedule() {
		const job = await this.queueManager.queues[this.queueName].add(
			"compliance-data-retention",
			{},
			{
				repeat: { pattern: "0 3 * * *" }, // Daily at 3 AM
				jobId: "compliance-data-retention-recurring",
			},
		);
		logger.info(
			`✅ Compliance data retention scheduled (daily, results: ${this.resultsRetentionDays}d, scans: ${this.scansRetentionDays}d)`,
		);
		return job;
	}

	/**
	 * Trigger manual compliance data retention
	 */
	async triggerManual() {
		const job = await this.queueManager.queues[this.queueName].add(
			"compliance-data-retention-manual",
			{},
			{ priority: 1 },
		);
		logger.info("✅ Manual compliance data retention triggered");
		return job;
	}
}

module.exports = ComplianceDataRetention;
