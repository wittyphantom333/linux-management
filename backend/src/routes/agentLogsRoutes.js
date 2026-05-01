/**
 * Agent Logs Routes
 *
 * Provides endpoints for:
 *   - Agent → Server: Batch log submission (X-API-ID / X-API-KEY auth)
 *   - UI → Server: Log retrieval with filtering (JWT auth)
 *   - Maintenance: Log cleanup / retention
 */

const express = require("express");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");
const { getPrismaClient } = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const { verifyApiKey } = require("../utils/apiKeyUtils");

const prisma = getPrismaClient();
const router = express.Router();

// Maximum entries per batch submission
const MAX_BATCH_SIZE = 500;
// Default retention: 7 days
const DEFAULT_RETENTION_DAYS = 7;

// ============================================================================
// AGENT-FACING ENDPOINT  (X-API-ID / X-API-KEY auth)
// ============================================================================

// POST /api/v1/agent-logs/ingest - Agent submits a batch of log entries
router.post("/ingest", async (req, res) => {
	/* #swagger.tags = ['Agent Logs'] */
	/* #swagger.summary = 'Agent: submit log entries' */
	/* #swagger.description = 'Agent submits a batch of recent log entries for storage and UI viewing. Authenticated via X-API-ID/X-API-KEY headers. Max 500 entries per batch.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			entries: [{
				timestamp: '2024-01-01T00:00:00Z',
				level: 'info',
				source: 'configmanagement',
				message: 'Starting policy evaluation...',
				metadata: { directive: 'my-directive', technique: 'file_content' }
			}]
		}
	} */
	try {
		const apiId = req.headers["x-api-id"];
		const apiKey = req.headers["x-api-key"];

		if (!apiId || !apiKey) {
			return res.status(401).json({ error: "API credentials required" });
		}

		const host = await prisma.hosts.findFirst({ where: { api_id: apiId } });
		if (!host) {
			return res.status(401).json({ error: "Invalid API credentials" });
		}

		const isValidKey = await verifyApiKey(apiKey, host.api_key);
		if (!isValidKey) {
			return res.status(401).json({ error: "Invalid API credentials" });
		}

		const { entries } = req.body;
		if (!Array.isArray(entries) || entries.length === 0) {
			return res.status(400).json({ error: "No log entries provided" });
		}

		// Truncate to max batch size
		const batch = entries.slice(0, MAX_BATCH_SIZE);

		// Prepare records
		const records = batch.map((entry) => ({
			id: uuidv4(),
			host_id: host.id,
			timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
			level: (entry.level || "info").toLowerCase(),
			source: entry.source || "",
			message: String(entry.message || "").slice(0, 10000), // Limit message length
			metadata: entry.metadata || null,
		}));

		// Bulk insert
		const result = await prisma.agent_logs.createMany({ data: records });

		logger.debug(
			`[AgentLogs] Received ${result.count} log entries from ${host.friendly_name || host.hostname}`,
		);

		return res.json({
			success: true,
			received: result.count,
			message: `${result.count} log entries stored`,
		});
	} catch (error) {
		logger.error(`[AgentLogs] Ingest failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to store log entries" });
	}
});

// ============================================================================
// UI-FACING ENDPOINTS  (JWT auth)
// ============================================================================

// GET /api/v1/agent-logs/:hostId - Retrieve logs for a host
router.get("/:hostId", authenticateToken, async (req, res) => {
	/* #swagger.tags = ['Agent Logs'] */
	/* #swagger.summary = 'Get agent logs for a host' */
	/* #swagger.description = 'Retrieve agent log entries for a specific host with filtering by level, source, time range, and search text. Supports pagination. Requires JWT auth.' */
	/* #swagger.security = [{ "bearerAuth": [] }] */
	/* #swagger.parameters['level'] = { in: 'query', type: 'string', description: 'Filter by log level (debug, info, warn, error). Comma-separated for multiple.', required: false } */
	/* #swagger.parameters['source'] = { in: 'query', type: 'string', description: 'Filter by source module (e.g. configmanagement). Comma-separated for multiple.', required: false } */
	/* #swagger.parameters['search'] = { in: 'query', type: 'string', description: 'Full-text search in message field', required: false } */
	/* #swagger.parameters['since'] = { in: 'query', type: 'string', description: 'ISO 8601 timestamp - only entries after this time', required: false } */
	/* #swagger.parameters['until'] = { in: 'query', type: 'string', description: 'ISO 8601 timestamp - only entries before this time', required: false } */
	/* #swagger.parameters['limit'] = { in: 'query', type: 'integer', description: 'Max results (default 200, max 1000)', required: false } */
	/* #swagger.parameters['offset'] = { in: 'query', type: 'integer', description: 'Pagination offset', required: false } */
	/* #swagger.parameters['order'] = { in: 'query', type: 'string', description: 'Sort order: desc (newest first, default) or asc', required: false } */
	try {
		const { hostId } = req.params;
		const {
			level,
			source,
			search,
			since,
			until,
			limit = 200,
			offset = 0,
			order = "desc",
		} = req.query;

		// Verify host exists
		const host = await prisma.hosts.findUnique({
			where: { id: hostId },
			select: { id: true },
		});
		if (!host) {
			return res.status(404).json({ error: "Host not found" });
		}

		// Build filters
		const where = { host_id: hostId };

		if (level) {
			const levels = level
				.split(",")
				.map((l) => l.trim().toLowerCase())
				.filter(Boolean);
			if (levels.length === 1) {
				where.level = levels[0];
			} else if (levels.length > 1) {
				where.level = { in: levels };
			}
		}

		if (source) {
			const sources = source
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (sources.length === 1) {
				where.source = sources[0];
			} else if (sources.length > 1) {
				where.source = { in: sources };
			}
		}

		if (search) {
			where.message = { contains: search, mode: "insensitive" };
		}

		if (since || until) {
			where.timestamp = {};
			if (since) where.timestamp.gte = new Date(since);
			if (until) where.timestamp.lte = new Date(until);
		}

		const take = Math.min(Number.parseInt(limit, 10) || 200, 1000);
		const skip = Number.parseInt(offset, 10) || 0;

		const [entries, total] = await Promise.all([
			prisma.agent_logs.findMany({
				where,
				orderBy: { timestamp: order === "asc" ? "asc" : "desc" },
				take,
				skip,
			}),
			prisma.agent_logs.count({ where }),
		]);

		return res.json({
			success: true,
			entries,
			total,
			limit: take,
			offset: skip,
		});
	} catch (error) {
		logger.error(`[AgentLogs] Retrieval failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to retrieve logs" });
	}
});

// GET /api/v1/agent-logs/:hostId/sources - Get distinct log sources for a host
router.get("/:hostId/sources", authenticateToken, async (req, res) => {
	/* #swagger.tags = ['Agent Logs'] */
	/* #swagger.summary = 'Get log source modules for a host' */
	/* #swagger.description = 'Returns distinct source modules that have produced log entries for this host. Useful for populating filter dropdowns.' */
	/* #swagger.security = [{ "bearerAuth": [] }] */
	try {
		const { hostId } = req.params;
		const sources = await prisma.agent_logs.findMany({
			where: { host_id: hostId },
			distinct: ["source"],
			select: { source: true },
			orderBy: { source: "asc" },
		});

		return res.json({
			success: true,
			sources: sources.map((s) => s.source).filter(Boolean),
		});
	} catch (error) {
		logger.error(`[AgentLogs] Sources query failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to get sources" });
	}
});

// GET /api/v1/agent-logs/:hostId/stats - Get log stats for a host
router.get("/:hostId/stats", authenticateToken, async (req, res) => {
	/* #swagger.tags = ['Agent Logs'] */
	/* #swagger.summary = 'Get log statistics for a host' */
	/* #swagger.description = 'Returns counts per level, date range, and total entries for a host. Requires JWT auth.' */
	/* #swagger.security = [{ "bearerAuth": [] }] */
	try {
		const { hostId } = req.params;
		const [total, levelCounts, dateRange] = await Promise.all([
			prisma.agent_logs.count({ where: { host_id: hostId } }),
			prisma.agent_logs.groupBy({
				by: ["level"],
				where: { host_id: hostId },
				_count: { level: true },
			}),
			prisma.agent_logs.aggregate({
				where: { host_id: hostId },
				_min: { timestamp: true },
				_max: { timestamp: true },
			}),
		]);

		const levels = {};
		for (const lc of levelCounts) {
			levels[lc.level] = lc._count.level;
		}

		return res.json({
			success: true,
			total,
			levels,
			oldest: dateRange._min.timestamp,
			newest: dateRange._max.timestamp,
		});
	} catch (error) {
		logger.error(`[AgentLogs] Stats query failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to get stats" });
	}
});

// DELETE /api/v1/agent-logs/:hostId - Clear logs for a host
router.delete("/:hostId", authenticateToken, async (req, res) => {
	/* #swagger.tags = ['Agent Logs'] */
	/* #swagger.summary = 'Clear logs for a host' */
	/* #swagger.description = 'Delete all log entries for a specific host. Optionally filter by age. Requires JWT auth.' */
	/* #swagger.security = [{ "bearerAuth": [] }] */
	/* #swagger.parameters['older_than'] = { in: 'query', type: 'string', description: 'Delete only entries older than this ISO 8601 timestamp', required: false } */
	try {
		const { hostId } = req.params;
		const { older_than } = req.query;

		const where = { host_id: hostId };
		if (older_than) {
			where.timestamp = { lt: new Date(older_than) };
		}

		const result = await prisma.agent_logs.deleteMany({ where });

		logger.info(
			`[AgentLogs] Cleared ${result.count} log entries for host ${hostId}`,
		);
		return res.json({
			success: true,
			deleted: result.count,
		});
	} catch (error) {
		logger.error(`[AgentLogs] Delete failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete logs" });
	}
});

// ============================================================================
// MAINTENANCE (called by a cron / startup cleanup)
// ============================================================================

/**
 * Purge agent log entries older than the configured retention period.
 * Call this from a background job or startup hook.
 */
async function purgeOldLogs(retentionDays = DEFAULT_RETENTION_DAYS) {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
	const result = await prisma.agent_logs.deleteMany({
		where: { received_at: { lt: cutoff } },
	});
	if (result.count > 0) {
		logger.info(
			`[AgentLogs] Purged ${result.count} entries older than ${retentionDays} days (cutoff: ${cutoff.toISOString()})`,
		);
	}
	return result.count;
}

module.exports = router;
module.exports.purgeOldLogs = purgeOldLogs;
