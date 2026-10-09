#!/usr/bin/env node
/**
 * Diagnose Windows agent auto-update health via the PatchMon server API.
 *
 * Usage:
 *   # With admin login
 *   node scripts/diagnose-windows-updates.js \
 *     --server http://172.16.21.31:3380 \
 *     --user admin@example.com \
 *     --pass yourpassword
 *
 *   # Or with an existing JWT token (from browser localStorage or manual login)
 *   node scripts/diagnose-windows-updates.js \
 *     --token eyJhbGc... \
 *     --server http://172.16.21.31:3380
 */

const https = require("node:https");
const http = require("node:http");

// ── Args ─────────────────────────────────────
function arg(name) {
	const flag = `--${name}=`;
	return (process.argv.find((a) => a.startsWith(flag)) || "").replace(flag, "");
}

const serverUrl = arg("server") || "http://172.16.21.31:3380";
const user = arg("user");
const pass = arg("pass");
const token = arg("token");

let authToken = token; // may be set from --token or filled by login below

// ── HTTP helpers ─────────────────────────────
async function httpGet(path) {
	return new Promise((resolve, reject) => {
		const mod = serverUrl.startsWith("https") ? https : http;
		const url = new URL(path, serverUrl);
		const headers = {};
		if (authToken) headers.Authorization = `Bearer ${authToken}`;

		const req = mod.get(url, (res) => {
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => resolve({ status: res.statusCode, body }));
		});
		req.on("error", reject);
		req.setTimeout(15000, () => {
			reject(new Error("timeout"));
			req.destroy();
		});
	});
}

// ── Login if needed ──────────────────────────
async function ensureAuth() {
	if (authToken) return;
	if (!user || !pass) {
		console.log("\n⚠️  Need admin credentials to authenticate.");
		console.log("   Usage: --user <email> --pass <password>");
		console.log("   Or:    --token <jwt from browser localStorage>");
		process.exit(1);
	}

	const res = await httpGet("/api/v1/auth/login");
	if (res.status !== 200) {
		console.log(`❌ Login failed (${res.status}): ${res.body}`);
		process.exit(1);
	}

	const data = JSON.parse(res.body);
	authToken = data.token || data.jwt || data.access_token;
	if (!authToken) {
		console.log("❌ No token in login response:", res.body.substring(0, 300));
		process.exit(1);
	}
	console.log(`✅ Authenticated as: ${user}`);
}

// ── Main ─────────────────────────────────────
async function main() {
	const sep = "═".repeat(72);
	console.log(sep);
	console.log("  PatchMon — Windows Agent Auto-Update Diagnostic");
	console.log(`  Server: ${serverUrl}`);
	console.log(sep);

	await ensureAuth();

	// ── Fetch all hosts ────────────────────────
	const res = await httpGet("/api/v1/hosts");
	if (res.status !== 200) {
		console.log(`❌ GET /api/v1/hosts returned ${res.status}`);
		console.log("   Response:", res.body.substring(0, 400));
		process.exit(1);
	}

	const data = JSON.parse(res.body);
	const hosts = data?.data || data?.hosts || [];
	if (!Array.isArray(hosts)) {
		console.log("❌ Unexpected response structure:", typeof data);
		process.exit(1);
	}

	console.log(`\n📊 Total hosts: ${hosts.length}`);

	// ── Filter Windows ─────────────────────────
	const winHosts = hosts.filter((h) => {
		const os = String(h.os_type || "").toLowerCase();
		return os.includes("windows");
	});

	if (winHosts.length === 0) {
		console.log("\n⚠️  No Windows hosts found in the database.");
		return;
	}

	console.log(`🖥️  Windows hosts: ${winHosts.length}\n`);

	for (const host of winHosts) {
		await diagnoseHost(host);
	}

	// ── Summary ────────────────────────────────
	console.log(`\n${sep}`);
	console.log("  SUMMARY");
	console.log(sep);
	// ...filled in by the loop counters below...
	const upToDate = winHosts.filter((h) => {
		const lv = (h.latestVersion || "").replace("v", "");
		const cv = (h.currentVersion || h.current_version || "").replace("v", "");
		return lv && cv && lv === cv;
	}).length;

	console.log(`  Total Windows hosts : ${winHosts.length}`);
	console.log(`  Up to date          : ${upToDate}`);
	console.log(
		`  Need update         : ${winHosts.filter((h) => !h.upToDate).length}`,
	);
	console.log(sep);

	const allOk = winHosts.every(
		(h) => h.issues?.length === 0 && h.hasUpdate === false,
	);
	if (allOk) {
		console.log("\n✅ All Windows hosts are up to date.");
	} else {
		console.log("\n⚠️  Some issues found — see each host above for details.");
	}
}

// ── Per-host diagnosis ───────────────────────
async function diagnoseHost(host) {
	const id = host.id || host.api_id || "(no id)";
	const name = host.hostname || host.name || "(no hostname)";
	const currentVer = (host.current_version || host.version || "").replace(
		"v",
		"",
	);
	const osType = host.os_type || host.platform || "unknown";
	const arch = host.architecture || host.cpu_arch || host.arch || "amd64";
	const lastSeen =
		host.last_seen_at || host.last_ping || host.last_activity || null;
	const autoUpdate = host.auto_update;

	// Collect issues for this host
	const issues = [];

	console.log("─".repeat(72));
	console.log(`  Host: ${name}`);
	console.log(`  ID:     ${id}`);
	console.log(`  OS:     ${osType}  Arch: ${arch}`);
	console.log(`  Version: ${currentVer || "(none)"}`);
	console.log(
		`  Auto-update: ${autoUpdate === undefined || autoUpdate === null ? "N/A" : autoUpdate ? "enabled ✓" : "DISABLED ⚠️"}`,
	);
	console.log(`  Last seen: ${lastSeen || "(never)"}`);

	// 1. Simulate the agent version check call
	const verUrl = `/api/v1/hosts/agent/version?arch=${arch}&os=windows&currentVersion=${currentVer || "unknown"}`;
	const verRes = await httpGet(verUrl);

	if (verRes.status === 200) {
		const resp = JSON.parse(verRes.body);

		host.latestVersion = (resp.latestVersion || "").replace("v", "");
		host.currentVersion = (resp.currentVersion || currentVer || "").replace(
			"v",
			"",
		);
		host.hasUpdate = resp.hasUpdate;
		host.autoUpdateDisabled = resp.autoUpdateDisabled;
		host.upToDate = host.hasUpdate === false && !host.autoUpdateDisabled;

		console.log(`\n  📋 /agent/version response:`);
		console.log(`     currentVersion: ${resp.currentVersion || "N/A"}`);
		console.log(
			`     latestVersion:  ${resp.latestVersion || "N/A"} (on server)`,
		);
		console.log(
			`     hasUpdate:      ${resp.hasUpdate ? "YES → update available" : "NO ✓"}`,
		);

		if (host.autoUpdateDisabled) {
			issues.push(
				`Auto-update is DISABLED${resp.autoUpdateDisabledReason ? ` (${resp.autoUpdateDisabledReason})` : ""}`,
			);
			console.log(
				`     ⚠️  auto-update: ${resp.autoUpdateDisabledReason || "disabled"}`,
			);
		}

		if (resp.downloadUrl) {
			console.log(`     downloadUrl:    ${resp.downloadUrl}`);
		}

		if (resp.hash) {
			console.log(`     hash:           ${resp.hash.substring(0, 16)}...`);
		}

		// Check for the critical "no version" failure mode
		if (!resp.latestVersion || resp.latestVersion.trim() === "") {
			const issue =
				"Server returned empty latestVersion — Windows binary has no embedded version string.";
			issues.push(issue);
			console.log(`     ❌ ${issue}`);
			console.log(
				`        Fix: rebuild with '-ldflags=...-X ...VersionBanner=Monux Agent vX.Y.Z'`,
			);
		}

		if (resp.hasUpdate && !host.autoUpdateDisabled) {
			const issue = `Update available: ${currentVer} → ${resp.latestVersion}`;
			console.log(`     ✅ ${issue}`);
			host.upToDate = false;
		} else if (!resp.hasUpdate && resp.latestVersion) {
			host.upToDate = true;
		}
	} else {
		const issue = `Agent version endpoint failed: HTTP ${verRes.status} — ${verRes.body.substring(0, 200)}`;
		issues.push(issue);
		console.log(`\n  ❌ ${issue}`);
		host.upToDate = false;
	}

	// 2. Auto-update setting check
	if (!host.autoUpdateDisabled && host.hasUpdate !== false) {
		if (autoUpdate === false) {
			const issue = "Host-level auto_update is disabled in database.";
			if (!issues.includes(issue)) issues.push(issue);
		}
	}

	// 3. Staleness check (>7 days since last seen)
	if (lastSeen) {
		const lastSeenDate = new Date(lastSeen);
		const ageDays =
			(Date.now() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24);
		if (ageDays > 7) {
			issues.push(`Agent hasn't pinged in ${Math.round(ageDays)} days (stale)`);
			console.log(`\n  ⚠️  Agent stale: ${Math.round(ageDays)} days ago`);
		} else if (ageDays > 1) {
			issues.push(`Agent hasn't pinged in ${Math.round(ageDays)} days`);
			console.log(`\n  ⚠️  Agent idle: ${Math.round(ageDays)} days ago`);
		}
	}

	// Print issues
	if (issues.length > 0) {
		console.log(`\n  📝 Issues (${issues.length}):`);
		issues.forEach((i) => {
			console.log(`     • ${i}`);
		});
	}

	host.issues = issues;
	console.log();
}

main().catch((err) => {
	console.error("Fatal error:", err.message);
	process.exit(1);
});
