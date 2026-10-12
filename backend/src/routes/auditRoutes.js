/**
 * Audit / Usage & Logs Routes
 *
 * Two concerns:
 *  1. `POST /mcp-tool`  — the MCP server (and any pmk_-key client) reports a
 *     tool invocation here. Auth via `authenticateToken` (works for both
 *     Bearer pmk_ keys and JWT sessions), so we can attribute the call to the
 *     key/user that made it.
 *  2. `GET /` and `GET /summary` — admin-only, paginated view of the
 *     audit_logs table (logins, API-key actions, MCP tool calls, scans).
 */

const express = require("express");
const logger = require("../utils/logger");
const { getPrismaClient } = require("../config/prisma");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { AUDIT_EVENTS, logAuditEvent } = require("../utils/auditLogger");

const router = express.Router();

const PAGE_SIZE_MAX = 200;

/**
 * Best-effort: map a list of audit rows to display names.
 * user_id may be a users.id (user keys / sessions) or an admin_api_keys.id
 * (admin keys / MCP). For the latter we fall back to the username recorded
 * in details (which the MCP endpoint + key routes store).
 */
async function resolveDisplayNames(rows) {
	const prisma = getPrismaClient();
	const userIds = [
		...new Set(
			rows.map((r) => r.user_id).filter((v) => v && typeof v === "string"),
		),
	];
	// A user_id may be a users.id (user keys / sessions) OR an admin_api_keys.id
	// (admin keys / MCP calls — for those, req.user.id is the key's own id).
	const [users, adminKeys] =
		userIds.length > 0
			? await Promise.all([
					prisma.users.findMany({
						where: { id: { in: userIds } },
						select: { id: true, username: true },
					}),
					prisma.admin_api_keys.findMany({
						where: { id: { in: userIds } },
						select: { id: true, username: true },
					}),
				])
			: [[], []];
	const nameMap = new Map([
		...users.map((u) => [u.id, u.username]),
		...adminKeys.map((k) => [k.id, k.username]),
	]);

	return rows.map((r) => {
		let details = {};
		if (r.details) {
			try {
				details = JSON.parse(r.details);
			} catch {
				details = {};
			}
		}
		const name =
			nameMap.get(r.user_id) ||
			details?.username ||
			(r.user_id ? r.user_id : "anonymous");
		return { ...r, details, username: name };
	});
}

// ── MCP tool-call reporting ────────────────────────────────────────────────
router.post("/mcp-tool", authenticateToken, async (req, res) => {
	try {
		const { tool, args, success = true, durationMs, error } = req.body || {};
		if (!tool || typeof tool !== "string") {
			return res.status(400).json({ error: "tool (string) is required" });
		}

		await logAuditEvent({
			event: AUDIT_EVENTS.MCP_TOOL_CALL,
			userId: req.user?.id ? String(req.user.id) : null,
			username: req.user?.username || null,
			ipAddress: req.ip,
			userAgent: req.get("user-agent"),
			success: success !== false,
			details: {
				tool,
				args: args && Object.keys(args).length ? args : {},
				durationMs: typeof durationMs === "number" ? durationMs : null,
				// `error` is intentionally not added to sensitiveKeys, but keep it
				// short so we don't store huge payloads.
				error: error ? String(error).substring(0, 500) : null,
				authMethod: req.authMethod || "session",
			},
		});

		res.json({ success: true });
	} catch (err) {
		logger.error("Audit: failed to record MCP tool call:", err.message);
		res.status(500).json({ error: "Failed to record tool call" });
	}
});

// ── Summary counts (for the page header) ───────────────────────────────────
router.get("/summary", authenticateToken, requireAdmin, async (_req, res) => {
	try {
		const prisma = getPrismaClient();
		const now = new Date();
		const since24h = new Date(now.getTime() - 24 * 3600 * 1000);
		const since7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

		const [t24, t7d, total] = await Promise.all([
			prisma.audit_logs.count({ where: { created_at: { gte: since24h } } }),
			prisma.audit_logs.count({ where: { created_at: { gte: since7d } } }),
			prisma.audit_logs.count(),
		]);

		// Breakdown by a few high-value event groups (last 7d).
		const groups = [
			{
				key: "logins",
				label: "Logins",
				events: ["LOGIN_SUCCESS", "LOGIN_FAILED"],
			},
			{
				key: "api_keys",
				label: "API keys",
				events: ["API_KEY_CREATED", "API_KEY_REVOKED"],
			},
			{ key: "mcp_calls", label: "MCP calls", events: ["MCP_TOOL_CALL"] },
			{ key: "scans", label: "Scans", events: ["COMPLIANCE_SCAN_TRIGGERED"] },
		];
		const breakdown = await Promise.all(
			groups.map(async (g) => ({
				key: g.key,
				label: g.label,
				count: await prisma.audit_logs.count({
					where: { created_at: { gte: since7d }, event: { in: g.events } },
				}),
			})),
		);

		res.json({
			total,
			last24h: t24,
			last7d: t7d,
			breakdown: breakdown.reduce((acc, g) => {
				acc[g.key] = g.count;
				return acc;
			}, {}),
		});
	} catch (err) {
		logger.error("Audit: failed to build summary:", err.message);
		res.status(500).json({ error: "Failed to build summary" });
	}
});

// ── Paginated list ─────────────────────────────────────────────────────────
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
	try {
		const prisma = getPrismaClient();

		const page = Math.max(1, parseInt(req.query.page, 10) || 1);
		const limit = Math.min(
			PAGE_SIZE_MAX,
			Math.max(1, parseInt(req.query.limit, 10) || 50),
		);

		const where = {};
		if (req.query.event) where.event = String(req.query.event);
		if (req.query.success !== undefined && req.query.success !== "") {
			where.success = String(req.query.success) === "true";
		}
		const dateFilters = {};
		if (req.query.from) dateFilters.gte = new Date(req.query.from);
		if (req.query.to) dateFilters.lte = new Date(req.query.to);
		if (Object.keys(dateFilters).length) where.created_at = dateFilters;

		const [total, rows] = await Promise.all([
			prisma.audit_logs.count({ where }),
			prisma.audit_logs.findMany({
				where,
				orderBy: { created_at: "desc" },
				skip: (page - 1) * limit,
				take: limit,
			}),
		]);

		const withNames = await resolveDisplayNames(rows);

		res.json({
			data: withNames.map((r) => ({
				id: r.id,
				event: r.event,
				username: r.username,
				success: r.success,
				ipAddress: r.ip_address,
				userAgent: r.user_agent,
				details: r.details,
				createdAt: r.created_at,
			})),
			page,
			limit,
			total,
			pages: Math.max(1, Math.ceil(total / limit)),
		});
	} catch (err) {
		logger.error("Audit: failed to list audit logs:", err.message);
		res.status(500).json({ error: "Failed to list audit logs" });
	}
});

module.exports = router;
