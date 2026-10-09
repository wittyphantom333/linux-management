/**
 * PatchMon MCP Server — exposes agent diagnostics as MCP tools.
 *
 * Connects to a running PatchMon instance via its REST API using an API key.
 * Get your API key from: https://updates.zedhosting.gg/settings/profile → "API Keys" section
 *
 * Environment variables (set in Vivus MCP config):
 *   PATCHMON_URL       = base URL of your PatchMon server (default: http://172.16.21.31:3380)
 *   PATCHMON_API_KEY   = your API key from the settings page
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ── Config ───────────────────────────────────────
const BASE_URL = process.env.PATCHMON_URL || "http://172.16.21.31:3380";
const API_KEY = process.env.PATCHMON_API_KEY;

if (!API_KEY) {
	console.error("PATCHMON MCP: missing PATCHMON_API_KEY environment variable");
	console.error("Get one from: https://updates.zedhosting.gg/settings/profile");
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
		inputSchema: {
			type: "object",
			properties: {
				os_type: {
					type: "string",
					description: "Filter by OS type prefix (e.g. 'windows', 'linux'). Omit for all hosts.",
				},
			},
			required: [],
		},
		async handler(args) {
			const data = await api("GET", "/api/v1/hosts");
			const hosts = (data.data || data.hosts || []);

			const filtered = args.os_type
				? hosts.filter(h => String(h.os_type || "").toLowerCase().includes(args.os_type.toLowerCase()))
				: hosts;

			const result = filtered.map(h => ({
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

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	},
	{
		name: "patchmon_diagnose_windows_hosts",
		description:
			"Diagnose all Windows hosts for auto-update issues. Checks: version mismatch, auto_update enabled/disabled, stale pings (>7 days), and critically — whether the server can read versions from the Windows binary (missing 'Monux Agent v...' string breaks updates forever).",
		inputSchema: {
			type: "object",
			properties: {},
		},
		async handler() {
			const hostsData = await api("GET", "/api/v1/hosts");
			const hosts = (hostsData.data || hostsData.hosts || []);
			const winHosts = hosts.filter(h =>
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
				...results.map(r => {
					const core = `${r.host} v${r.version} → server v${r.server_version || "N/A"} | update=${r.has_update ?? "ERR"} | auto_update=${r.auto_update_enabled ? "ON" : "OFF"}`;
					const issueStr = r.issues.length > 0
						? "\n   ⚠️ Issues: " + r.issues.join("; ")
						: "";
					return `  ${core}${issueStr}`;
				}),
			].join("\n");

			return {
				content: [{ type: "text", text: lines }],
			};
		},
	},
	{
		name: "patchmon_get_agent_version",
		description:
			"Simulate the agent version check for one host — calls the exact same /api/v1/hosts/agent/version endpoint that agents use at startup. Returns hasUpdate, latestVersion, auto-update status, and binary hash.",
		inputSchema: {
			type: "object",
			properties: {
				host_id: { type: "string", description: "Host API ID or UUID" },
				architecture: { type: "string", description: "CPU arch: amd64, arm64, arm, 386" },
				os_type: { type: "string", description: "OS: linux, windows, freebsd" },
			},
			required: [],
		},
		async handler(args) {
			const hostId = args.host_id;
			let hosts = [];
			if (hostId) {
				// Try to get just this host — query all and filter
				const data = await api("GET", "/api/v1/hosts");
				hosts = (data.data || data.hosts || []).filter(h => h.id === hostId || h.api_id === hostId);
			} else {
				const data = await api("GET", "/api/v1/hosts");
				hosts = data.data || data.hosts || [];
			}

			if (hosts.length === 0) {
				return {
					content: [{ type: "text", text: `No hosts found for id="${hostId}"` }],
				};
			}

			let result = {};
			for (const host of hosts) {
				const arch = args.architecture || host.architecture || "amd64";
				const os = args.os_type || host.os_type || "linux";
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

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	},
];

// ── MCP Server ───────────────────────────────────
async function main() {
	const server = new McpServer({
		name: "patchmon-mcp",
		version: "1.0.0",
	});

	for (const tool of tools) {
		server.tool(tool.name, tool.description, tool.inputSchema.properties || {}, tool.handler);
	}

	console.error(`PatchMon MCP server starting...`);
	console.error(`  URL:   ${BASE_URL}`);
	console.error(`  Key:   ${API_KEY.substring(0, 8)}...${API_KEY.slice(-4)}`);
	console.error(`  Tools: ${tools.map(t => t.name).join(", ")}`);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(err => {
	console.error("PATCHMON MCP fatal:", err.message);
	process.exit(1);
});
