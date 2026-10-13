#!/usr/bin/env node
/**
 * Check Windows compliance scanner status across all Windows agents:
 *  - agent versions on Windows hosts (which support the native CIS scanner)
 *  - compliance dashboard: whether any cis-windows scans have run
 *  - last compliance scan details per Windows host
 *
 * Usage:
 *   node scripts/check-windows-compliance.js \
 *     --server http://172.16.21.31:3380
 *   (PATCHMON_KEY env or --key)
 */
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const serverUrl = arg("server", "http://172.16.21.31:3380");
const key = arg("key", process.env.PATCHMON_KEY);
if (!key) {
	console.error("Missing --key (or PATCHMON_KEY env)");
	process.exit(1);
}
const base = `${serverUrl}/api/v1`;
const headers = { Authorization: `Bearer ${key}` };

async function get(path) {
	const res = await fetch(`${base}${path}`, { headers });
	if (!res.ok)
		throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
	return res.json();
}

(async () => {
	console.log(`Server: ${serverUrl}\n`);

	// 1. Windows hosts + agent versions
	let hosts = [];
	try {
		const h = await get("/dashboard/hosts");
		hosts = h.data || h.hosts || h;
	} catch {
		hosts = (await get("/hosts")).data || [];
	}
	const win = (Array.isArray(hosts) ? hosts : []).filter((h) =>
		/windows/i.test(h.os_type || ""),
	);
	console.log(`=== ${win.length} Windows host(s) ===`);
	for (const h of win) {
		console.log(
			`  ${h.friendly_name || h.hostname}  os=${h.os_type} ${h.os_version || ""}  ` +
				`agent=${h.agent_version || "?"}  status=${h.status}  ` +
				`compliance=${h.compliance_enabled ? "on" : "off"}  ` +
				`onDemandOnly=${h.compliance_on_demand_only ? 1 : 0}`,
		);
	}

	// 2. Compliance dashboard
	const dash = await get("/compliance/dashboard");
	console.log(`\n=== Compliance dashboard ===`);
	console.log("profile_type_stats:", JSON.stringify(dash.profile_type_stats));
	console.log(
		"profile_distribution:",
		JSON.stringify(dash.profile_distribution),
	);
	const cisHosts = (dash.hosts_with_latest_scan || []).filter((h) =>
		/cis-windows/i.test(h.last_activity_title || ""),
	);
	for (const h of cisHosts) {
		console.log(
			`  ${h.friendly_name}: ${h.last_activity_title} score=${h.score} ` +
				`passed=${h.passed} failed=${h.failed} skipped=${h.skipped} ` +
				`@ ${h.last_scan_date}`,
		);
	}
	if (!cisHosts.length) console.log("  (no cis-windows scans recorded yet)");

	// 3. Per-Windows-host stored cis-windows scan
	for (const h of win) {
		const id = h.id || h.hostname;
		const name = h.friendly_name || h.hostname;
		try {
			const raw = await get(`/compliance/scans/${id}`);
			const rawList = raw.scans || raw.data || (Array.isArray(raw) ? raw : []);
			const cisRaw = rawList.filter((x) =>
				/cis-windows/i.test(x.profile_type || x.profileType || ""),
			);
			if (cisRaw.length) {
				console.log(
					`\n=== ${name}: ${cisRaw.length} stored cis-windows scan(s) ===`,
				);
				for (const c of cisRaw.slice(0, 2)) {
					console.log(
						`  status=${c.status} score=${c.score} passed=${c.passed} ` +
							`failed=${c.failed} skipped=${c.skipped} na=${c.not_applicable} ` +
							`rules=${c.total_rules} err=${c.error || c.error_message || ""}`,
					);
				}
			} else {
				console.log(`\n=== ${name}: no cis-windows scan recorded`);
			}
		} catch {
			console.log(`\n=== ${name}: (no per-host scan data available)`);
		}
	}
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
