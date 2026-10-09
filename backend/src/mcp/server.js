/**
 * PatchMon MCP Server — exposes PatchMon diagnostics as MCP tools.
 *
 * Connects to a running PatchMon instance via its REST API using an API key.
 * Get your API key from: https://updates.zedhosting.gg/settings/profile → "API Keys" tab
 *
 * Environment variables (set in Vivus MCP config):
 *   PATCHMON_URL       = base URL of your PatchMon server (default: https://updates.zedhosting.gg)
 *   PATCHMON_API_KEY   = your API key from the settings page
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Config ───────────────────────────────────────
const BASE_URL = process.env.PATCHMON_URL || "https://updates.zedhosting.gg";
const API_KEY = process.env.PATCHMON_API_KEY;

if (!API_KEY) {
	console.error("PATCHMON MCP: missing PATCHMON_API_KEY environment variable");
	console.error(
		"Get one from: https://updates.zedhosting.gg/settings/profile → API Keys",
	);
	process.exit(1);
}

// ── Auth helper ──────────────────────────────────
async function api(method, path, body) {
	const headers = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${API_KEY}`,
	};
	const opts = { method, headers };
	if (body) opts.body = JSON.stringify(body);

	const res = await fetch(`${BASE_URL}${path}`, opts);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(
			`PATCHMON API ${method} ${path}: ${res.status} ${text.substring(0, 200)}`,
		);
	}
	const text = await res.text();
	return text ? JSON.parse(text) : {};
}

// ── Host helpers ─────────────────────────────────
// /api/v1/dashboard/hosts returns a raw array (no {data: [...]} wrapper)
async function fetchHosts() {
	const data = await api("GET", "/api/v1/dashboard/hosts");
	return Array.isArray(data) ? data : data.data || data.hosts || [];
}

function mapHost(h) {
	return {
		id: h.id,
		api_id: h.api_id,
		hostname: h.friendly_name || h.hostname || h.name,
		os_type: h.os_type,
		version: h.agent_version || h.current_version || null,
		auto_update: h.auto_update,
		last_seen: h.last_update || h.last_seen_at || h.last_ping || null,
		status: h.effectiveStatus || h.status,
	};
}

// Resolve a user-supplied id (db UUID or agent api_id) to the db row
async function resolveHost(id) {
	const hosts = await fetchHosts();
	return hosts.find((h) => h.id === id || h.api_id === id) || null;
}

// ── Tools ────────────────────────────────────────
const tools = [
	{
		name: "patchmon_list_hosts",
		description:
			"List all managed hosts. Filter by os_type (windows, linux, freebsd) or omit for all. Returns hostname, OS, arch, version, auto_update status, last ping.",
		args: {
			os_type: z
				.string()
				.optional()
				.describe(
					"Filter by OS type prefix (e.g. 'windows', 'linux'). Omit for all hosts.",
				),
		},
		async handler({ os_type }) {
			const hosts = await fetchHosts();
			const filtered = os_type
				? hosts.filter((h) =>
						String(h.os_type || "")
							.toLowerCase()
							.includes(os_type.toLowerCase()),
					)
				: hosts;

			const result = filtered.map(mapHost);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_diagnose_windows_hosts",
		description:
			"Diagnose all Windows hosts for auto-update issues. Checks: version mismatch, auto_update enabled/disabled, stale pings (>7 days), and critically — whether the server can read versions from the Windows binary (missing 'Monux Agent v...' string breaks updates forever).",
		args: {},
		async handler() {
			const hosts = await fetchHosts();
			const winHosts = hosts.filter((h) =>
				String(h.os_type || "")
					.toLowerCase()
					.includes("windows"),
			);

			if (winHosts.length === 0) {
				return {
					content: [
						{ type: "text", text: "No Windows hosts found in the database." },
					],
				};
			}

			const results = [];
			let staleCount = 0;

			const serverInfo = await api("GET", "/api/v1/agent/version").catch(
				() => null,
			);
			const latestServerVer = serverInfo?.latestVersion || null;

			for (const host of winHosts) {
				const name = host.friendly_name || host.hostname || "(unknown)";
				const currentVer = (host.agent_version || "").replace(/^v/, "");
				const lastSeen = host.last_update || null;

				const issues = [];

				if (!currentVer) {
					issues.push(
						"CRITICAL: no agent version reported — the server may not be able to read the version from this Windows binary (missing 'Monux Agent v...' string breaks auto-update permanently)",
					);
				}

				if (latestServerVer && currentVer) {
					const strip = (s) => String(s).replace(/^v/, "");
					if (strip(currentVer) !== strip(latestServerVer)) {
						issues.push(
							`Version mismatch: host v${strip(currentVer)} vs latest server v${strip(latestServerVer)}`,
						);
					}
				}

				if (host.auto_update === false) {
					issues.push("Auto-update is DISABLED for this host");
				}

				if (lastSeen) {
					const ageDays =
						(Date.now() - new Date(lastSeen).getTime()) / 86400000;
					if (ageDays > 7) {
						staleCount++;
						issues.push(`Stale: last ping ${ageDays.toFixed(1)} days ago`);
					}
				} else {
					issues.push("Never pinged the server");
				}

				results.push({
					host: name,
					api_id: host.api_id,
					version: currentVer || "(none)",
					auto_update_enabled: host.auto_update !== false,
					status: host.effectiveStatus || host.status,
					last_seen: lastSeen || "(never)",
					issues,
				});
			}

			const lines = [
				`Windows hosts total: ${winHosts.length}`,
				`Latest server agent version: v${latestServerVer || "unknown"}`,
				`Stale (>7 days): ${staleCount}`,
				`Hosts with issues: ${results.filter((r) => r.issues.length).length}`,
				"─".repeat(60),
				...results.map((r) => {
					const core = `${r.host} | v${r.version} | auto_update=${r.auto_update_enabled ? "ON" : "OFF"} | ${r.status} | last seen ${r.last_seen}`;
					const issueStr =
						r.issues.length > 0 ? `\n   ⚠️ ${r.issues.join("; ")}` : "";
					return `  ${core}${issueStr}`;
				}),
			].join("\n");

			return { content: [{ type: "text", text: lines }] };
		},
	},
	{
		name: "patchmon_get_agent_version",
		description:
			"Get the latest available agent version (hasUpdate, latestVersion, update status) plus one host's current reported version. Per-host version checks (/api/v1/hosts/agent/version) need the host's agent credentials and can't be simulated with an API key.",
		args: {
			host_id: z.string().optional().describe("Host API ID or UUID (optional)"),
		},
		async handler({ host_id }) {
			// Global version info: latest available agent version + server status
			const serverInfo = await api("GET", "/api/v1/agent/version").catch(
				(e) => ({
					error: e.message,
				}),
			);

			const out = { server: serverInfo };

			if (host_id) {
				const host = await resolveHost(host_id);
				if (host) {
					out.host = mapHost(host);
					out.host.version_check_note =
						"Per-host /api/v1/hosts/agent/version requires the host's agent credentials (X-API-ID/X-API-KEY) and can't be simulated with an API key alone. Use patchmon_diagnose_windows_hosts for fleet-level diagnosis.";
				} else {
					out.host = { error: `No host found for id="${host_id}"` };
				}
			}

			return {
				content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_dashboard_stats",
		description:
			"Get the PatchMon dashboard overview: total hosts, online/offline counts, hosts by OS type, and health summary. Use this as a first call to understand the environment.",
		args: {},
		async handler() {
			const data = await api("GET", "/api/v1/dashboard/stats");
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_pending_updates",
		description:
			"List packages that need updates across all hosts, with per-host version details (current → available) and security-update flags.",
		args: {
			security_only: z
				.boolean()
				.optional()
				.describe("Only return packages flagged as security updates"),
		},
		async handler({ security_only }) {
			const packages = await api("GET", "/api/v1/dashboard/packages");
			let list = packages;
			if (security_only) {
				list = (list || []).filter(
					(pkg) =>
						pkg.isSecurityUpdate ||
						pkg.host_packages?.some((hp) => hp.isSecurityUpdate),
				);
			}

			const lines = (list || []).map((pkg) => {
				const sec = pkg.isSecurityUpdate ? " [SECURITY]" : "";
				const hosts = (pkg.affectedHosts || pkg.host_packages || []).map(
					(h) =>
						`${h.friendlyName || h.hosts?.friendly_name || h.hostId} (${h.currentVersion} → ${h.availableVersion || pkg.latestVersion})`,
				);
				return `${pkg.name}${sec} — affects ${hosts.length} host(s): ${hosts.join(", ")}`;
			});

			return {
				content: [
					{
						type: "text",
						text: lines.length
							? `Packages needing updates: ${lines.length}\n${lines.join("\n")}`
							: "No packages need updates — all hosts are up to date.",
					},
				],
			};
		},
	},
	{
		name: "patchmon_compliance_status",
		description:
			"Get the CIS compliance scan dashboard: latest scan per host, pass/fail/skip counts, and hosts that have never been scanned.",
		args: {},
		async handler() {
			const data = await api("GET", "/api/v1/compliance/dashboard");
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_trigger_compliance_scan",
		description:
			"Trigger a CIS compliance scan on a specific host. Returns the scan ID to track progress.",
		args: {
			host_id: z.string().describe("Host ID to scan (UUID or API ID)"),
			profile: z
				.string()
				.optional()
				.describe(
					"Compliance profile type (e.g. 'cis-windows', 'cis-linux'). Omit for the host default.",
				),
		},
		async handler({ host_id, profile }) {
			// Endpoint validates the hostId as a UUID — resolve agent api_id to db id
			const host = await resolveHost(host_id);
			const dbId = host?.id || host_id;
			const result = await api("POST", `/api/v1/compliance/trigger/${dbId}`, {
				profile_type: profile || "all",
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_get_host_logs",
		description:
			"Retrieve recent agent logs for a host (last N entries). Useful for diagnosing agent behavior, patch runs, and config management.",
		args: {
			host_id: z.string().describe("Host ID (UUID or API ID)"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(500)
				.optional()
				.describe("Max entries to return (default 50)"),
			source: z
				.string()
				.optional()
				.describe("Filter by log source (e.g. 'patching', 'configmanagement')"),
		},
		async handler({ host_id, limit, source }) {
			// /api/v1/agent-logs/:hostId takes the db UUID, not the agent api_id
			const host = await resolveHost(host_id);
			const dbId = host?.id || host_id;
			const params = new URLSearchParams();
			if (limit) params.set("limit", String(limit));
			if (source) params.set("source", source);
			const q = params.toString();
			const data = await api(
				"GET",
				`/api/v1/agent-logs/${dbId}${q ? `?${q}` : ""}`,
			);
			const logs = data.entries || data.logs || data.data || data;
			const lines = (Array.isArray(logs) ? logs : []).map((l) => {
				const ts = l.timestamp || l.created_at;
				return `${ts} [${(l.level || "info").toUpperCase()}] ${l.source || "-"}: ${l.message}`;
			});
			return {
				content: [
					{
						type: "text",
						text: lines.length
							? `${lines.length} log entries:\n${lines.join("\n")}`
							: "No logs found for this host.",
					},
				],
			};
		},
	},
	{
		name: "patchmon_validate",
		description:
			"Validate the current API key against the PatchMon server. Returns the key's owner (username), role (user/admin), and last-used time. Use this to debug authentication problems.",
		args: {},
		async handler() {
			const data = await api("GET", "/api/v1/api-keys/validate");
			return {
				content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
			};
		},
	},
];

// ── MCP Server ───────────────────────────────────
async function main() {
	const server = new McpServer({
		name: "patchmon-mcp",
		version: "2.0.0",
	});

	for (const tool of tools) {
		server.tool(tool.name, tool.description, tool.args, tool.handler);
	}

	console.error(`PatchMon MCP server starting...`);
	console.error(`  URL:   ${BASE_URL}`);
	console.error(`  Key:   ${API_KEY.substring(0, 8)}...${API_KEY.slice(-4)}`);
	console.error(`  Tools: ${tools.map((t) => t.name).join(", ")}`);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("PATCHMON MCP fatal:", err.message);
	process.exit(1);
});
