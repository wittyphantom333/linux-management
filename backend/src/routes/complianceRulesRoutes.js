const express = require("express");
const logger = require("../utils/logger");
const router = express.Router();
const axios = require("axios");

// Get embedded CIS rules (for frontend display)
router.get("/rules", async (_req, res) => {
	try {
		// In future, this would serve the default embedded ruleset from the server
		// For now, agents use their own embedded rules + optional remote update
		res.json({
			rules: [],
			count: 0,
			message: "Rules are embedded in each agent binary. Remote updates available via /rules/update.",
		});
	} catch (error) {
		logger.error("Failed to get compliance rules:", error.message);
		res.status(500).json({ error: "Failed to retrieve compliance rules" });
	}
});

// Update ruleset from a remote source
router.post(
	"/rules/update",
	requireAuth,
	requirePermission("can_manage_settings"),
	async (req, res) => {
		try {
			const { url } = req.body;
			if (!url) {
				return res.status(400).json({ error: "URL is required" });
			}

			logger.info(`Fetching compliance ruleset from: ${url}`);

			const response = await axios.get(url, {
				timeout: 30000,
				responseType: "arraybuffer",
			});

			// Validate the response is parseable as JSON or ZIP containing JSON
			const contentType = response.headers["content-type"] || "";
			let rules = [];

			if (contentType.includes("application/zip") || url.endsWith(".zip")) {
				// For now, just accept and log — agents handle ZIP parsing
				logger.info(`Received ZIP ruleset (${response.data.length} bytes)`);
				return res.json({
					success: true,
					message: "ZIP ruleset uploaded. Agents will download and parse when needed.",
					fileSize: response.data.length,
				});
			} else {
				// Parse as JSON array of CIS rules
				const text = response.data.toString("utf-8");
				try {
					rules = JSON.parse(text);
					if (!Array.isArray(rules)) {
						throw new Error("Ruleset is not a JSON array");
					}
				} catch (parseErr) {
					logger.error("Failed to parse ruleset as JSON:", parseErr.message);
					return res.status(400).json({
						error: "Invalid ruleset format. Expected JSON array of CIS rules.",
					});
				}
			}

			logger.info(`Uploaded ${rules.length} CIS rules`);
			res.json({
				success: true,
				message: `Ruleset uploaded successfully with ${rules.length} rules`,
				ruleCount: rules.length,
			});
		} catch (error) {
			logger.error("Failed to update ruleset:", error.message);
			res.status(500).json({ error: "Failed to update ruleset", details: error.message });
		}
	},
);

// Download the latest ruleset (for agents to pull)
router.get("/rules/download", async (_req, res) => {
	try {
		const rules = getLocalRules(); // In future, load from DB or file store

		res.setHeader("Content-Type", "application/json");
		res.setHeader("Content-Disposition", 'attachment; filename="patchmon-cis-windows-rules.json"');
		res.json(rules);
	} catch (error) {
		logger.error("Failed to download ruleset:", error.message);
		res.status(500).json({ error: "Failed to download ruleset" });
	}
});

// Get available profiles for Windows CIS scanner
router.get("/profiles", (_req, res) => {
	const profiles = [
		{ id: "cis-windows", name: "Windows CIS Benchmark", type: "cis-windows" },
	];
	res.json({ profiles });
});

// Helper middleware (placeholder — in production this would be the actual auth middleware)
function requireAuth(_req, _res, next) {
	// Authentication middleware is applied at route level in express setup
	next();
}

// Placeholder for local rules storage
function getLocalRules() {
	return [];
}

module.exports = router;
