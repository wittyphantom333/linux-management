/**
 * Config Management Routes
 *
 * Provides CRUD endpoints for the Rudder-inspired configuration management system:
 *   - Techniques (reusable configuration skeletons)
 *   - Directives (parameterised technique instances)
 *   - Rules (link directives ↔ host groups)
 *   - Policy generation (computed per-host policy)
 *   - Compliance runs (agent evaluation results)
 *
 * Agent-facing endpoints use X-API-ID / X-API-KEY authentication.
 * UI-facing endpoints use JWT token authentication.
 */

const express = require("express");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");
const { getPrismaClient } = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const { verifyApiKey } = require("../utils/apiKeyUtils");

const prisma = getPrismaClient();
const router = express.Router();

// ============================================================================
// TECHNIQUES
// ============================================================================

// GET /api/v1/configmanagement/techniques - List all techniques
router.get("/techniques", authenticateToken, async (req, res) => {
	try {
		const { category, enabled } = req.query;
		const where = {};
		if (category) where.category = category;
		if (enabled !== undefined) where.enabled = enabled === "true";

		const techniques = await prisma.cm_techniques.findMany({
			where,
			orderBy: [{ category: "asc" }, { name: "asc" }],
			include: {
				_count: { select: { cm_directives: true } },
			},
		});

		return res.json({ success: true, techniques });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to list techniques: ${error.message}`);
		return res.status(500).json({ error: "Failed to list techniques" });
	}
});

// POST /api/v1/configmanagement/techniques - Create a technique
router.post("/techniques", authenticateToken, async (req, res) => {
	try {
		const { name, description, version, category, parameters, methods, conditions } = req.body;

		if (!name || !methods || !Array.isArray(methods) || methods.length === 0) {
			return res.status(400).json({ error: "Name and at least one method are required" });
		}

		// Add IDs to methods if missing
		const methodsWithIds = methods.map((m, idx) => ({
			id: m.id || `method_${idx + 1}`,
			...m,
		}));

		const technique = await prisma.cm_techniques.create({
			data: {
				id: uuidv4(),
				name,
				description: description || null,
				version: version || "1.0",
				category: category || null,
				parameters: parameters || null,
				methods: methodsWithIds,
				conditions: conditions || null,
				enabled: true,
				created_by: req.user?.id || null,
				updated_at: new Date(),
			},
		});

		logger.info(`[ConfigMgmt] Technique created: ${name} v${version || "1.0"}`);
		return res.json({ success: true, technique });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ error: "A technique with that name and version already exists" });
		}
		logger.error(`[ConfigMgmt] Failed to create technique: ${error.message}`);
		return res.status(500).json({ error: "Failed to create technique" });
	}
});

// GET /api/v1/configmanagement/techniques/:id - Get technique details
router.get("/techniques/:id", authenticateToken, async (req, res) => {
	try {
		const technique = await prisma.cm_techniques.findUnique({
			where: { id: req.params.id },
			include: {
				cm_directives: {
					where: { enabled: true },
					orderBy: { priority: "asc" },
				},
			},
		});

		if (!technique) {
			return res.status(404).json({ error: "Technique not found" });
		}

		return res.json({ success: true, technique });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to get technique: ${error.message}`);
		return res.status(500).json({ error: "Failed to get technique" });
	}
});

// PUT /api/v1/configmanagement/techniques/:id - Update a technique
router.put("/techniques/:id", authenticateToken, async (req, res) => {
	try {
		const { name, description, version, category, parameters, methods, conditions, enabled } = req.body;

		const data = { updated_at: new Date() };
		if (name !== undefined) data.name = name;
		if (description !== undefined) data.description = description;
		if (version !== undefined) data.version = version;
		if (category !== undefined) data.category = category;
		if (parameters !== undefined) data.parameters = parameters;
		if (methods !== undefined) data.methods = methods;
		if (conditions !== undefined) data.conditions = conditions;
		if (enabled !== undefined) data.enabled = enabled;

		const technique = await prisma.cm_techniques.update({
			where: { id: req.params.id },
			data,
		});

		logger.info(`[ConfigMgmt] Technique updated: ${technique.name}`);
		return res.json({ success: true, technique });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to update technique: ${error.message}`);
		return res.status(500).json({ error: "Failed to update technique" });
	}
});

// DELETE /api/v1/configmanagement/techniques/:id - Delete a technique
router.delete("/techniques/:id", authenticateToken, async (req, res) => {
	try {
		await prisma.cm_techniques.delete({ where: { id: req.params.id } });
		logger.info(`[ConfigMgmt] Technique deleted: ${req.params.id}`);
		return res.json({ success: true, message: "Technique deleted" });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to delete technique: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete technique" });
	}
});

// ============================================================================
// DIRECTIVES
// ============================================================================

// GET /api/v1/configmanagement/directives
router.get("/directives", authenticateToken, async (req, res) => {
	try {
		const { technique_id, policy_mode, enabled } = req.query;
		const where = {};
		if (technique_id) where.technique_id = technique_id;
		if (policy_mode) where.policy_mode = policy_mode;
		if (enabled !== undefined) where.enabled = enabled === "true";

		const directives = await prisma.cm_directives.findMany({
			where,
			orderBy: [{ priority: "asc" }, { name: "asc" }],
			include: {
				technique: { select: { id: true, name: true, version: true, category: true } },
			},
		});

		return res.json({ success: true, directives });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to list directives: ${error.message}`);
		return res.status(500).json({ error: "Failed to list directives" });
	}
});

// POST /api/v1/configmanagement/directives
router.post("/directives", authenticateToken, async (req, res) => {
	try {
		const { name, description, technique_id, version, priority, policy_mode, parameters, tags } = req.body;

		if (!name || !technique_id) {
			return res.status(400).json({ error: "Name and technique_id are required" });
		}

		// Validate technique exists
		const technique = await prisma.cm_techniques.findUnique({ where: { id: technique_id } });
		if (!technique) {
			return res.status(404).json({ error: "Technique not found" });
		}

		const directive = await prisma.cm_directives.create({
			data: {
				id: uuidv4(),
				name,
				description: description || null,
				technique_id,
				version: version || "1.0",
				priority: priority ?? 50,
				policy_mode: policy_mode || "audit",
				parameters: parameters || null,
				enabled: true,
				tags: tags || null,
				created_by: req.user?.id || null,
				updated_at: new Date(),
			},
			include: {
				technique: { select: { id: true, name: true, version: true, category: true } },
			},
		});

		logger.info(`[ConfigMgmt] Directive created: ${name}`);
		return res.json({ success: true, directive });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to create directive: ${error.message}`);
		return res.status(500).json({ error: "Failed to create directive" });
	}
});

// GET /api/v1/configmanagement/directives/:id
router.get("/directives/:id", authenticateToken, async (req, res) => {
	try {
		const directive = await prisma.cm_directives.findUnique({
			where: { id: req.params.id },
			include: {
				technique: true,
				cm_rule_directives: {
					include: { rule: { select: { id: true, name: true } } },
				},
			},
		});

		if (!directive) {
			return res.status(404).json({ error: "Directive not found" });
		}

		return res.json({ success: true, directive });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to get directive: ${error.message}`);
		return res.status(500).json({ error: "Failed to get directive" });
	}
});

// PUT /api/v1/configmanagement/directives/:id
router.put("/directives/:id", authenticateToken, async (req, res) => {
	try {
		const { name, description, priority, policy_mode, parameters, enabled, tags } = req.body;

		const data = { updated_at: new Date() };
		if (name !== undefined) data.name = name;
		if (description !== undefined) data.description = description;
		if (priority !== undefined) data.priority = priority;
		if (policy_mode !== undefined) data.policy_mode = policy_mode;
		if (parameters !== undefined) data.parameters = parameters;
		if (enabled !== undefined) data.enabled = enabled;
		if (tags !== undefined) data.tags = tags;

		const directive = await prisma.cm_directives.update({
			where: { id: req.params.id },
			data,
			include: { technique: { select: { id: true, name: true, version: true } } },
		});

		logger.info(`[ConfigMgmt] Directive updated: ${directive.name}`);
		return res.json({ success: true, directive });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to update directive: ${error.message}`);
		return res.status(500).json({ error: "Failed to update directive" });
	}
});

// DELETE /api/v1/configmanagement/directives/:id
router.delete("/directives/:id", authenticateToken, async (req, res) => {
	try {
		await prisma.cm_directives.delete({ where: { id: req.params.id } });
		logger.info(`[ConfigMgmt] Directive deleted: ${req.params.id}`);
		return res.json({ success: true, message: "Directive deleted" });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to delete directive: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete directive" });
	}
});

// ============================================================================
// RULES
// ============================================================================

// GET /api/v1/configmanagement/rules
router.get("/rules", authenticateToken, async (req, res) => {
	try {
		const rules = await prisma.cm_rules.findMany({
			orderBy: [{ priority: "asc" }, { name: "asc" }],
			include: {
				cm_rule_directives: {
					include: {
						directive: {
							select: { id: true, name: true, policy_mode: true, enabled: true },
						},
					},
				},
				cm_rule_groups: true,
			},
		});

		return res.json({ success: true, rules });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to list rules: ${error.message}`);
		return res.status(500).json({ error: "Failed to list rules" });
	}
});

// POST /api/v1/configmanagement/rules
router.post("/rules", authenticateToken, async (req, res) => {
	try {
		const { name, description, directive_ids, group_ids, priority, tags } = req.body;

		if (!name) {
			return res.status(400).json({ error: "Name is required" });
		}

		const rule = await prisma.cm_rules.create({
			data: {
				id: uuidv4(),
				name,
				description: description || null,
				enabled: true,
				priority: priority ?? 50,
				tags: tags || null,
				created_by: req.user?.id || null,
				updated_at: new Date(),
				cm_rule_directives: {
					create: (directive_ids || []).map((did) => ({
						id: uuidv4(),
						directive_id: did,
					})),
				},
				cm_rule_groups: {
					create: (group_ids || []).map((gid) => ({
						id: uuidv4(),
						host_group_id: gid,
					})),
				},
			},
			include: {
				cm_rule_directives: {
					include: { directive: { select: { id: true, name: true } } },
				},
				cm_rule_groups: true,
			},
		});

		logger.info(`[ConfigMgmt] Rule created: ${name}`);
		return res.json({ success: true, rule });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to create rule: ${error.message}`);
		return res.status(500).json({ error: "Failed to create rule" });
	}
});

// GET /api/v1/configmanagement/rules/:id
router.get("/rules/:id", authenticateToken, async (req, res) => {
	try {
		const rule = await prisma.cm_rules.findUnique({
			where: { id: req.params.id },
			include: {
				cm_rule_directives: {
					include: {
						directive: {
							include: { technique: { select: { id: true, name: true, version: true, category: true } } },
						},
					},
				},
				cm_rule_groups: true,
			},
		});

		if (!rule) {
			return res.status(404).json({ error: "Rule not found" });
		}

		return res.json({ success: true, rule });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to get rule: ${error.message}`);
		return res.status(500).json({ error: "Failed to get rule" });
	}
});

// PUT /api/v1/configmanagement/rules/:id
router.put("/rules/:id", authenticateToken, async (req, res) => {
	try {
		const { name, description, enabled, priority, directive_ids, group_ids, tags } = req.body;

		const data = { updated_at: new Date() };
		if (name !== undefined) data.name = name;
		if (description !== undefined) data.description = description;
		if (enabled !== undefined) data.enabled = enabled;
		if (priority !== undefined) data.priority = priority;
		if (tags !== undefined) data.tags = tags;

		// Use transaction to update rule + linked directives/groups atomically
		const result = await prisma.$transaction(async (tx) => {
			const updated = await tx.cm_rules.update({
				where: { id: req.params.id },
				data,
			});

			if (directive_ids !== undefined) {
				await tx.cm_rule_directives.deleteMany({ where: { rule_id: req.params.id } });
				if (directive_ids.length > 0) {
					await tx.cm_rule_directives.createMany({
						data: directive_ids.map((did) => ({
							id: uuidv4(),
							rule_id: req.params.id,
							directive_id: did,
						})),
					});
				}
			}

			if (group_ids !== undefined) {
				await tx.cm_rule_groups.deleteMany({ where: { rule_id: req.params.id } });
				if (group_ids.length > 0) {
					await tx.cm_rule_groups.createMany({
						data: group_ids.map((gid) => ({
							id: uuidv4(),
							rule_id: req.params.id,
							host_group_id: gid,
						})),
					});
				}
			}

			return tx.cm_rules.findUnique({
				where: { id: req.params.id },
				include: {
					cm_rule_directives: { include: { directive: { select: { id: true, name: true } } } },
					cm_rule_groups: true,
				},
			});
		});

		logger.info(`[ConfigMgmt] Rule updated: ${result.name}`);
		return res.json({ success: true, rule: result });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to update rule: ${error.message}`);
		return res.status(500).json({ error: "Failed to update rule" });
	}
});

// DELETE /api/v1/configmanagement/rules/:id
router.delete("/rules/:id", authenticateToken, async (req, res) => {
	try {
		await prisma.cm_rules.delete({ where: { id: req.params.id } });
		logger.info(`[ConfigMgmt] Rule deleted: ${req.params.id}`);
		return res.json({ success: true, message: "Rule deleted" });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to delete rule: ${error.message}`);
		return res.status(500).json({ error: "Failed to delete rule" });
	}
});

// ============================================================================
// POLICY GENERATION (server computes the per-host policy)
// ============================================================================

/**
 * Compute the policy for a specific host by resolving:
 *   rules → directives → techniques
 * filtered by the host's group memberships and enabled rules/directives.
 */
async function computePolicyForHost(hostId) {
	// Get all group IDs this host belongs to
	const memberships = await prisma.host_group_memberships.findMany({
		where: { host_id: hostId },
		select: { host_group_id: true },
	});
	const groupIds = memberships.map((m) => m.host_group_id);

	if (groupIds.length === 0) {
		return null; // Host not in any group — no policy
	}

	// Find all enabled rules that target any of these groups
	const ruleGroups = await prisma.cm_rule_groups.findMany({
		where: { host_group_id: { in: groupIds } },
		include: {
			rule: {
				include: {
					cm_rule_directives: {
						include: {
							directive: {
								include: { technique: true },
							},
						},
					},
				},
			},
		},
	});

	// Deduplicate rules
	const rulesMap = new Map();
	for (const rg of ruleGroups) {
		if (rg.rule.enabled) {
			rulesMap.set(rg.rule.id, rg.rule);
		}
	}

	// Sort rules by priority then name (like Rudder's alphanumeric ordering)
	const sortedRules = Array.from(rulesMap.values()).sort(
		(a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
	);

	// Build policy items and collect techniques
	const techniqueMap = new Map();
	const policyItems = [];

	for (const rule of sortedRules) {
		// Sort directives within a rule by priority then name
		const sortedDirectives = [...rule.cm_rule_directives]
			.map((rd) => rd.directive)
			.filter((d) => d.enabled)
			.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

		for (const dir of sortedDirectives) {
			// Compute effective mode: override wins, then audit wins (Rudder logic)
			const effectiveMode = dir.policy_mode; // Can be enhanced with node-level override

			policyItems.push({
				directive: {
					id: dir.id,
					name: dir.name,
					description: dir.description,
					technique_id: dir.technique_id,
					version: dir.version,
					priority: dir.priority,
					policy_mode: dir.policy_mode,
					parameters: dir.parameters || {},
					enabled: dir.enabled,
					tags: dir.tags,
				},
				effective_mode: effectiveMode,
				rule_id: rule.id,
				rule_name: rule.name,
			});

			if (dir.technique && !techniqueMap.has(dir.technique.id)) {
				techniqueMap.set(dir.technique.id, {
					id: dir.technique.id,
					name: dir.technique.name,
					description: dir.technique.description,
					version: dir.technique.version,
					category: dir.technique.category,
					parameters: dir.technique.parameters || [],
					methods: dir.technique.methods || [],
					conditions: dir.technique.conditions || null,
				});
			}
		}
	}

	if (policyItems.length === 0) {
		return null;
	}

	return {
		policy_id: uuidv4(),
		host_id: hostId,
		generated_at: new Date().toISOString(),
		global_mode: "audit", // Default global mode
		directives: policyItems,
		techniques: Array.from(techniqueMap.values()),
	};
}

// GET /api/v1/configmanagement/policy/:hostId - Get computed policy for a host (UI)
router.get("/policy/:hostId", authenticateToken, async (req, res) => {
	try {
		const policy = await computePolicyForHost(req.params.hostId);
		if (!policy) {
			return res.json({ success: true, policy: null, message: "No applicable policy for this host" });
		}
		return res.json({ success: true, policy });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to compute policy: ${error.message}`);
		return res.status(500).json({ error: "Failed to compute policy" });
	}
});

// ============================================================================
// AGENT-FACING ENDPOINTS (X-API-ID / X-API-KEY auth)
// ============================================================================

// GET /api/v1/configmanagement/agent/policy - Agent fetches its computed policy
router.get("/agent/policy", async (req, res) => {
	try {
		const apiId = req.headers["x-api-id"];
		const apiKey = req.headers["x-api-key"];
		const currentHash = req.query.hash || "";

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

		if (!host.configmanagement_enabled) {
			return res.json({ policy: null, changed: false, message: "Config management is disabled for this host" });
		}

		const policy = await computePolicyForHost(host.id);
		if (!policy) {
			return res.json({ policy: null, changed: false, message: "No applicable policy" });
		}

		// Quick hash check — if nothing changed, tell agent to skip
		const crypto = require("node:crypto");
		const policyJson = JSON.stringify(policy);
		const serverHash = crypto.createHash("sha256").update(policyJson).digest("hex");

		if (serverHash === currentHash) {
			return res.json({ policy: null, changed: false, message: "Policy unchanged" });
		}

		return res.json({ policy, changed: true, message: "New policy available" });
	} catch (error) {
		logger.error(`[ConfigMgmt] Agent policy fetch failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to fetch policy" });
	}
});

// POST /api/v1/configmanagement/agent/report - Agent submits compliance report
router.post("/agent/report", async (req, res) => {
	try {
		const apiId = req.headers["x-api-id"];
		const apiKey = req.headers["x-api-key"];
		const { report, current_hash, hostname, machine_id, agent_version } = req.body;

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

		logger.info(`[ConfigMgmt] Report from ${hostname || host.friendly_name}: ` +
			`${report?.total_directives || 0} directives, score=${report?.score?.toFixed(1) || 0}%`);

		// Store the run
		if (report) {
			await prisma.cm_policy_runs.create({
				data: {
					id: uuidv4(),
					host_id: host.id,
					policy_id: report.policy_id || null,
					global_mode: report.global_mode || "audit",
					evaluated_at: report.evaluated_at ? new Date(report.evaluated_at) : new Date(),
					total_directives: report.total_directives || 0,
					compliant: report.compliant || 0,
					non_compliant: report.non_compliant || 0,
					errors: report.errors || 0,
					repaired: report.repaired || 0,
					not_applicable: report.not_applicable || 0,
					score: report.score || 0,
					directive_results: report.directive_results || null,
					created_at: new Date(),
				},
			});
		}

		return res.json({
			message: "Config management report received",
			directives_applied: report?.total_directives || 0,
		});
	} catch (error) {
		logger.error(`[ConfigMgmt] Agent report failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to process report" });
	}
});

// ============================================================================
// COMPLIANCE RUNS (UI queries)
// ============================================================================

// GET /api/v1/configmanagement/runs - List recent policy runs
router.get("/runs", authenticateToken, async (req, res) => {
	try {
		const { host_id, limit = 50, offset = 0 } = req.query;
		const where = {};
		if (host_id) where.host_id = host_id;

		const [runs, total] = await Promise.all([
			prisma.cm_policy_runs.findMany({
				where,
				orderBy: { evaluated_at: "desc" },
				take: Math.min(Number.parseInt(limit, 10), 200),
				skip: Number.parseInt(offset, 10),
				include: {
					hosts: { select: { id: true, friendly_name: true, hostname: true } },
				},
			}),
			prisma.cm_policy_runs.count({ where }),
		]);

		return res.json({ success: true, runs, total });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to list runs: ${error.message}`);
		return res.status(500).json({ error: "Failed to list runs" });
	}
});

// GET /api/v1/configmanagement/runs/:id - Get a specific run with full details
router.get("/runs/:id", authenticateToken, async (req, res) => {
	try {
		const run = await prisma.cm_policy_runs.findUnique({
			where: { id: req.params.id },
			include: {
				hosts: { select: { id: true, friendly_name: true, hostname: true } },
			},
		});

		if (!run) {
			return res.status(404).json({ error: "Run not found" });
		}

		return res.json({ success: true, run });
	} catch (error) {
		logger.error(`[ConfigMgmt] Failed to get run: ${error.message}`);
		return res.status(500).json({ error: "Failed to get run" });
	}
});

// GET /api/v1/configmanagement/dashboard - Overview stats
router.get("/dashboard", authenticateToken, async (req, res) => {
	try {
		const [
			techniqueCount,
			directiveCount,
			ruleCount,
			enabledHosts,
			recentRuns,
		] = await Promise.all([
			prisma.cm_techniques.count({ where: { enabled: true } }),
			prisma.cm_directives.count({ where: { enabled: true } }),
			prisma.cm_rules.count({ where: { enabled: true } }),
			prisma.hosts.count({ where: { configmanagement_enabled: true } }),
			prisma.cm_policy_runs.findMany({
				orderBy: { evaluated_at: "desc" },
				take: 10,
				include: {
					hosts: { select: { id: true, friendly_name: true } },
				},
			}),
		]);

		// Compute average score from last 24h runs
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const recent = await prisma.cm_policy_runs.aggregate({
			where: { evaluated_at: { gte: oneDayAgo } },
			_avg: { score: true },
			_count: true,
		});

		return res.json({
			success: true,
			dashboard: {
				techniques: techniqueCount,
				directives: directiveCount,
				rules: ruleCount,
				enabled_hosts: enabledHosts,
				recent_runs: recentRuns,
				avg_score_24h: recent._avg.score ? Math.round(recent._avg.score * 10) / 10 : null,
				runs_24h: recent._count,
			},
		});
	} catch (error) {
		logger.error(`[ConfigMgmt] Dashboard failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to load dashboard" });
	}
});

module.exports = router;
