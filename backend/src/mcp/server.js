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
	console.error("Get one from: https://updates.zedhosting.gg/settings/profile → API Keys");
	process.exit(1);
}

// ── Auth helper ──────────────────────────────────
async function api(method, path, body) {
	const headers = { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` };
	const opts = { method, headers };
	if (body) opts.body = JSON.stringify(body);

	const res = await fetch(`${BASE_URL}${path}`, opts);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`PATCHMON API ${method} ${path}: ${res.status} ${text.substring(0, 200)}`);
	}
	return res.json();
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
				.describe("Filter by OS type prefix (e.g. 'windows', 'linux'). Omit for all hosts."),
		},
		async handler({ os_type }) {
			const data = await api("GET", "/api/v1/hosts");
			const hosts = data.data || data.hosts || [];

			const filtered = os_type
				? hosts.filter((h) => String(h.os_type || "").toLowerCase().includes(os_type.toLowerCase()))
				: hosts;

			const result = filtered.map((h) => ({
				id: h.id,
				api_id: h.api_id,
				hostname: h.hostname || h.name,
				os_type: h.os_type,
				arch: h.architecture || h.cpu_arch,
				version: h.current_version || h.version || null,
				auto_update: h.auto_update,
				last_seen: h.last_seen_at || h.last_ping,
				status: h.status,
			}));

			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	},
	{
		name: "patchmon_diagnose_windows_hosts",
		description:
			"Diagnose all Windows hosts for auto-update issues. Checks: version mismatch, auto_update enabled/disabled, stale pings (>7 days), and critically — whether the server can read versions from the Windows binary (missing 'Monux Agent v...' string breaks updates forever).",
		args: {},
		async handler() {
			const hostsData = await api("GET", "/api/v1/hosts");
			const hosts = hostsData.data || hostsData.hosts || [];
			const winHosts = hosts.filter((h) =>
				String(h.os_type || "").toLowerCase().includes("windows"),
			);

			if (winHosts.length === 0) {
				return {
					content: [{ type: "text", text: "No Windows hosts found in the database." }],
				};
			}

			const results = [];
			let needsUpdateCount = 0;
			let criticalCount = 0;

			for (const host of winHosts) {
				const id = host.id || host.api_id;
				const name = host.hostname || host.name || "(unknown)";
				const currentVer = (host.current_version || host.version || "").replace(/^v/, "");
				const arch = host.architecture || host.cpu_arch || "amd64";

				let versionInfo = null;
				let error = null;
				try {
					const q = new URLSearchParams({
						arch,
						os: "windows",
						currentVersion: currentVer || "unknown",
					});
					versionInfo = await api("GET", `/api/v1/hosts/agent/version?${q}`);
				} catch (e) {
					error = e.message;
				}

				const issues = [];

				if (!error && versionInfo.latestVersion && !versionInfo.latestVersion.trim()) {
					issues.push(
						"CRITICAL: server returned empty latestVersion — the Windows binary has no embedded version string ('Monux Agent v...'). This breaks auto-update permanently because the Linux backend can't extract the version via 'strings'.",
					);
					issues.push(
						"FIX: rebuild with -ldflags='-X patchmon-agent/internal/pkgversion.VersionBanner=Monux Agent vX.Y.Z'",
					);
					criticalCount++;
				}

				if (versionInfo?.autoUpdateDisabled) {
					const reason = versionInfo.autoUpdateDisabledReason || "unknown";
					issues.push(`Auto-update is DISABLED: ${reason}`);
				}

				if (!error && versionInfo?.hasUpdate) {
					needsUpdateCount++;
				}

				results.push({
					host: name,
					id,
					version: currentVer || "(none)",
					server_version: versionInfo?.latestVersion || null,
					has_update: versionInfo?.hasUpdate ?? null,
					auto_update_enabled: !versionInfo?.autoUpdateDisabled,
					last_seen: host.last_seen_at || host.last_ping || "(never)",
					issues,
				});
			}

			const lines = [
				`Windows hosts total: ${winHosts.length}`,
				`Needs update: ${needsUpdateCount}`,
				`Critical (no version): ${criticalCount}`,
				"─".repeat(60),
				...results.map((r) => {
					const core = `${r.host} v${r.version} → server v${r.server_version || "N/A"} | update=${r.has_update ?? "ERR"} | auto_update=${r.auto_update_enabled ? "ON" : "OFF"}`;
					const issueStr =
						r.issues.length > 0 ? `\n   ⚠️ Issues: ${r.issues.join("; ")}` : "";
					return `  ${core}${issueStr}`;
				}),
			].join("\n");

			return { content: [{ type: "text", text: lines }] };
		},
	},
	{
		name: "patchmon_get_agent_version",
		description:
			"Simulate the agent version check for one host — calls the exact same /api/v1/hosts/agent/version endpoint that agents use at startup. Returns hasUpdate, latestVersion, auto-update status, and binary hash.",
		args: {
			host_id: z.string().optional().describe("Host API ID or UUID"),
			architecture: z
				.string()
				.optional()
				.describe("CPU arch: amd64, arm64, arm, 386"),
			os_type: z.string().optional().describe("OS: linux, windows, freebsd"),
		},
		async handler({ host_id, architecture, os_type }) {
			const data = await api("GET", "/api/v1/hosts");
			let hosts = data.data || data.hosts || [];
			if (host_id) {
				hosts = hosts.filter((h) => h.id === host_id || h.api_id === host_id);
			}

			if (hosts.length === 0) {
				return {
					content: [{ type: "text", text: `No hosts found for id="${host_id}"` }],
				};
			}

			let result = {};
			for (const host of hosts) {
				const arch = architecture || host.architecture || "amd64";
				const os = os_type || host.os_type || "linux";
				const cv = (host.current_version || host.version || "").replace(/^v/, "");

				try {
					const q = new URLSearchParams({ arch, os, currentVersion: "" });
					result = await api("GET", `/api/v1/hosts/agent/version?${q}`);
				} catch (e) {
					console.error(`Host ${host.hostname}: ${e.message}`);
					continue;
				}

				console.error(
					`[version check] host=${host.hostname} current=${cv || "N/A"} server=${result.latestVersion || "N/A"} hasUpdate=${result.hasUpdate}`,
				);
			}

			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	},
	{
		name: "patchmon_dashboard_stats",
		description:
			"Get the PatchMon dashboard overview: total hosts, online/offline counts, hosts by OS type, and health summary. Use this as a first call to understand the environment.",
		args: {},
		async handler() {
			const data = await api("GET", "/api/v1/dashboard/stats");
			return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
					(pkg) => pkg.isSecurityUpdate || pkg.host_packages?.some((hp) => hp.isSecurityUpdate),
				);
			}

			const lines = (list || [])
				.map((pkg) => {
					const sec = pkg.isSecurityUpdate ? " [SECURITY]" : "";
					const hosts = (pkg.affectedHosts || pkg.host_packages || []).map(
						(h) => `${h.friendlyName || h.hosts?.friendly_name || h.hostId} (${h.currentVersion} → ${h.availableVersion || pkg.latestVersion})`,
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
			return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
				.describe("Compliance profile type (e.g. 'cis-windows', 'cis-linux'). Omit for the host default."),
		},
		async handler({ host_id, profile }) {
			const result = await api("POST", `/api/v1/compliance/trigger/${host_id}`, {
				profile_type: profile,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
			const params = new URLSearchParams();
			if (limit) params.set("limit", String(limit));
			if (source) params.set("source", source);
			const q = params.toString();
			const data = await api("GET", `/api/v1/agent-logs/${host_id}${q ? `?${q}` : ""}`);
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
			return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
		server.tool(
			tool.name,
			tool.description,
			tool.args,
			tool.handler,
		);
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
