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
const {
	requireViewConfigManagement,
	requireManageConfigManagement,
} = require("../middleware/permissions");

const prisma = getPrismaClient();
const router = express.Router();

// ============================================================================
// TECHNIQUES
// ============================================================================

// GET /api/v1/configmanagement/techniques - List all techniques (deduplicated by name — latest version only)
router.get(
	"/techniques",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'List all techniques' */
		/* #swagger.description = 'Retrieve all techniques. By default, deduplicates by name (latest version only). Use all_versions=true to return every version. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['category'] = { in: 'query', type: 'string', description: 'Filter by category', required: false } */
		/* #swagger.parameters['enabled'] = { in: 'query', type: 'string', description: 'Filter by enabled status (true/false)', required: false } */
		/* #swagger.parameters['all_versions'] = { in: 'query', type: 'string', description: 'When true, return all versions instead of deduplicating', required: false } */
		try {
			const { category, enabled, all_versions } = req.query;
			const where = {};
			if (category) where.category = category;
			if (enabled !== undefined) where.enabled = enabled === "true";

			const allTechniques = await prisma.cm_techniques.findMany({
				where,
				orderBy: [{ category: "asc" }, { name: "asc" }, { version: "desc" }],
				include: {
					_count: { select: { cm_directives: true } },
				},
			});

			// When all_versions=true, return everything (used by directive version pickers)
			if (all_versions === "true") {
				return res.json({ success: true, techniques: allTechniques });
			}

			// Deduplicate: keep only the latest version per technique name
			const seen = new Map();
			const versionCounts = new Map();
			const totalDirectiveCounts = new Map();
			for (const t of allTechniques) {
				versionCounts.set(t.name, (versionCounts.get(t.name) || 0) + 1);
				totalDirectiveCounts.set(
					t.name,
					(totalDirectiveCounts.get(t.name) || 0) +
						(t._count?.cm_directives || 0),
				);
				if (!seen.has(t.name)) {
					seen.set(t.name, t);
				}
			}

			const techniques = Array.from(seen.values()).map((t) => ({
				...t,
				version_count: versionCounts.get(t.name) || 1,
				total_directives: totalDirectiveCounts.get(t.name) || 0,
			}));

			return res.json({ success: true, techniques });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to list techniques: ${error.message}`);
			return res.status(500).json({ error: "Failed to list techniques" });
		}
	},
);

// POST /api/v1/configmanagement/techniques - Create a technique
router.post(
	"/techniques",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'Create a technique' */
		/* #swagger.description = 'Create a new configuration technique with methods. Returns 409 if name+version already exists. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'User Present Check',
			description: 'Ensures a user account exists',
			version: '1.0',
			category: 'Users',
			parameters: [],
			methods: [{ type: 'user_present', name: 'Ensure user exists', parameters: { name: 'deploy' } }],
			conditions: null
		}
	} */
		try {
			const {
				name,
				description,
				version,
				category,
				parameters,
				methods,
				conditions,
			} = req.body;

			if (
				!name ||
				!methods ||
				!Array.isArray(methods) ||
				methods.length === 0
			) {
				return res
					.status(400)
					.json({ error: "Name and at least one method are required" });
			}

			// Normalize methods: add IDs if missing, remap "args" → "parameters" and "description" → "name"
			const methodsWithIds = methods.map((m, idx) => ({
				id: m.id || `method_${idx + 1}`,
				type: m.type,
				name: m.name || m.description || "",
				parameters: m.parameters || m.args || {},
				condition: m.condition || "",
				result_alias: m.result_alias || "",
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

			logger.info(
				`[ConfigMgmt] Technique created: ${name} v${version || "1.0"}`,
			);
			return res.json({ success: true, technique });
		} catch (error) {
			if (error.code === "P2002") {
				return res.status(409).json({
					error: "A technique with that name and version already exists",
				});
			}
			logger.error(`[ConfigMgmt] Failed to create technique: ${error.message}`);
			return res.status(500).json({ error: "Failed to create technique" });
		}
	},
);

// GET /api/v1/configmanagement/techniques/:id - Get technique details
router.get(
	"/techniques/:id",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'Get a technique by ID' */
		/* #swagger.description = 'Retrieve a single technique with its enabled directives. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
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
	},
);

// PUT /api/v1/configmanagement/techniques/:id - Update a technique
// If the version field changes, a NEW technique row is created (old version preserved for pinned directives).
router.put(
	"/techniques/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'Update a technique' */
		/* #swagger.description = 'Update a technique. If the version field changes, a NEW row is created (old version preserved for pinned directives). Returns new_version:true and previous_id when versioned. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'User Present Check',
			description: 'Updated description',
			version: '1.1',
			category: 'Users',
			parameters: [],
			methods: [{ type: 'user_present', name: 'Ensure user exists', parameters: { name: 'deploy' } }],
			enabled: true
		}
	} */
		try {
			const {
				name,
				description,
				version,
				category,
				parameters,
				methods,
				conditions,
				enabled,
			} = req.body;

			const existing = await prisma.cm_techniques.findUnique({
				where: { id: req.params.id },
			});
			if (!existing) {
				return res.status(404).json({ error: "Technique not found" });
			}

			// Normalize methods once
			let normalizedMethods;
			if (methods !== undefined) {
				normalizedMethods = methods.map((m, idx) => ({
					id: m.id || `method_${idx + 1}`,
					type: m.type,
					name: m.name || m.description || "",
					parameters: m.parameters || m.args || {},
					condition: m.condition || "",
					result_alias: m.result_alias || "",
				}));
				logger.info(
					`[ConfigMgmt] Technique save: received ${normalizedMethods.length} method(s) [${normalizedMethods.map((m) => `${m.name}(${m.type})`).join(", ")}]`,
				);
			}

			// If version is changing, create a NEW row to preserve old version for pinned directives
			if (version !== undefined && version !== existing.version) {
				const newTechnique = await prisma.cm_techniques.create({
					data: {
						id: uuidv4(),
						name: name ?? existing.name,
						description:
							description !== undefined ? description : existing.description,
						version,
						category: category !== undefined ? category : existing.category,
						parameters:
							parameters !== undefined ? parameters : existing.parameters,
						methods: normalizedMethods || existing.methods,
						conditions:
							conditions !== undefined ? conditions : existing.conditions,
						enabled: enabled !== undefined ? enabled : existing.enabled,
						created_by: req.user?.id || existing.created_by,
						updated_at: new Date(),
					},
				});

				// Auto-upgrade all directives that reference the old version to the new one.
				// Without this, directives stay pinned to the old row (fewer methods, stale config).
				const upgraded = await prisma.cm_directives.updateMany({
					where: { technique_id: existing.id },
					data: {
						technique_id: newTechnique.id,
						technique_version: version,
					},
				});

				logger.info(
					`[ConfigMgmt] Technique new version created: ${newTechnique.name} v${version} (prev v${existing.version}), auto-upgraded ${upgraded.count} directive(s)`,
				);
				return res.json({
					success: true,
					technique: newTechnique,
					new_version: true,
					previous_id: existing.id,
					directives_upgraded: upgraded.count,
				});
			}

			// Same version — update in place
			const data = { updated_at: new Date() };
			if (name !== undefined) data.name = name;
			if (description !== undefined) data.description = description;
			if (category !== undefined) data.category = category;
			if (parameters !== undefined) data.parameters = parameters;
			if (normalizedMethods) data.methods = normalizedMethods;
			if (conditions !== undefined) data.conditions = conditions;
			if (enabled !== undefined) data.enabled = enabled;

			const technique = await prisma.cm_techniques.update({
				where: { id: req.params.id },
				data,
			});

			logger.info(
				`[ConfigMgmt] Technique updated: ${technique.name} v${technique.version}`,
			);
			return res.json({ success: true, technique });
		} catch (error) {
			if (error.code === "P2002") {
				return res.status(409).json({
					error: "A technique with that name and version already exists",
				});
			}
			logger.error(`[ConfigMgmt] Failed to update technique: ${error.message}`);
			return res.status(500).json({ error: "Failed to update technique" });
		}
	},
);

// GET /api/v1/configmanagement/techniques/:id/versions - List all versions of a technique
router.get(
	"/techniques/:id/versions",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'List all versions of a technique' */
		/* #swagger.description = 'List all versions of a technique (matched by name). Returns version history with directive counts. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const technique = await prisma.cm_techniques.findUnique({
				where: { id: req.params.id },
			});
			if (!technique) {
				return res.status(404).json({ error: "Technique not found" });
			}

			// Find all versions with the same name
			const versions = await prisma.cm_techniques.findMany({
				where: { name: technique.name },
				orderBy: { version: "desc" },
				select: {
					id: true,
					name: true,
					version: true,
					category: true,
					enabled: true,
					created_at: true,
					updated_at: true,
					_count: { select: { cm_directives: true } },
				},
			});

			return res.json({
				success: true,
				technique_name: technique.name,
				versions,
			});
		} catch (error) {
			logger.error(
				`[ConfigMgmt] Failed to list technique versions: ${error.message}`,
			);
			return res
				.status(500)
				.json({ error: "Failed to list technique versions" });
		}
	},
);

// DELETE /api/v1/configmanagement/techniques/:id - Delete a technique (all versions)
router.delete(
	"/techniques/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Techniques'] */
		/* #swagger.summary = 'Delete a technique' */
		/* #swagger.description = 'Delete a technique by ID. Also removes all other versions with the same name (since the UI deduplicates by name). Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			// Look up the technique to get its name so we can delete all versions
			const technique = await prisma.cm_techniques.findUnique({
				where: { id: req.params.id },
				select: { name: true },
			});
			if (!technique) {
				return res.status(404).json({ error: "Technique not found" });
			}

			// Delete ALL versions with the same name (cascade removes directives)
			const result = await prisma.cm_techniques.deleteMany({
				where: { name: technique.name },
			});

			logger.info(
				`[ConfigMgmt] Technique "${technique.name}" deleted (${result.count} version(s))`,
			);
			return res.json({
				success: true,
				message: `Technique "${technique.name}" deleted (${result.count} version(s))`,
			});
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to delete technique: ${error.message}`);
			return res.status(500).json({ error: "Failed to delete technique" });
		}
	},
);

// ============================================================================
// DIRECTIVES
// ============================================================================

// GET /api/v1/configmanagement/directives
router.get(
	"/directives",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Directives'] */
		/* #swagger.summary = 'List all directives' */
		/* #swagger.description = 'Retrieve directives with optional filtering. Includes linked technique info. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['technique_id'] = { in: 'query', type: 'string', description: 'Filter by technique ID', required: false } */
		/* #swagger.parameters['policy_mode'] = { in: 'query', type: 'string', description: 'Filter by policy mode (audit/enforce)', required: false } */
		/* #swagger.parameters['enabled'] = { in: 'query', type: 'string', description: 'Filter by enabled status (true/false)', required: false } */
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
					technique: {
						select: { id: true, name: true, version: true, category: true },
					},
				},
			});

			return res.json({ success: true, directives });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to list directives: ${error.message}`);
			return res.status(500).json({ error: "Failed to list directives" });
		}
	},
);

// POST /api/v1/configmanagement/directives
router.post(
	"/directives",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Directives'] */
		/* #swagger.summary = 'Create a directive' */
		/* #swagger.description = 'Create a directive from a technique. Auto-pins to the technique current version. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Ensure deploy user',
			description: 'Creates the deploy user on all servers',
			technique_id: 'uuid-of-technique',
			priority: 50,
			policy_mode: 'audit',
			parameters: { name: 'deploy' },
			tags: { env: 'production' }
		}
	} */
		try {
			const {
				name,
				description,
				technique_id,
				version,
				priority,
				policy_mode,
				parameters,
				tags,
			} = req.body;

			if (!name || !technique_id) {
				return res
					.status(400)
					.json({ error: "Name and technique_id are required" });
			}

			// Validate technique exists
			const technique = await prisma.cm_techniques.findUnique({
				where: { id: technique_id },
			});
			if (!technique) {
				return res.status(404).json({ error: "Technique not found" });
			}

			const directive = await prisma.cm_directives.create({
				data: {
					id: uuidv4(),
					name,
					description: description || null,
					technique_id,
					technique_version: technique.version, // Pin to current technique version
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
					technique: {
						select: { id: true, name: true, version: true, category: true },
					},
				},
			});

			logger.info(`[ConfigMgmt] Directive created: ${name}`);
			return res.json({ success: true, directive });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to create directive: ${error.message}`);
			return res.status(500).json({ error: "Failed to create directive" });
		}
	},
);

// GET /api/v1/configmanagement/directives/:id
router.get(
	"/directives/:id",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Directives'] */
		/* #swagger.summary = 'Get a directive by ID' */
		/* #swagger.description = 'Retrieve a single directive with its technique and linked rules. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
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
	},
);

// PUT /api/v1/configmanagement/directives/:id
router.put(
	"/directives/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Directives'] */
		/* #swagger.summary = 'Update a directive' */
		/* #swagger.description = 'Update directive fields. Can switch technique or pin a specific technique version. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Updated directive name',
			priority: 30,
			policy_mode: 'enforce',
			parameters: { name: 'deploy' },
			enabled: true,
			tags: { env: 'staging' }
		}
	} */
		try {
			const {
				name,
				description,
				priority,
				policy_mode,
				parameters,
				enabled,
				tags,
				technique_id,
				technique_version,
			} = req.body;

			const data = { updated_at: new Date() };
			if (name !== undefined) data.name = name;
			if (description !== undefined) data.description = description;
			if (priority !== undefined) data.priority = priority;
			if (policy_mode !== undefined) data.policy_mode = policy_mode;
			if (parameters !== undefined) data.parameters = parameters;
			if (enabled !== undefined) data.enabled = enabled;
			if (tags !== undefined) data.tags = tags;

			// Allow switching the technique (to a different version)
			if (technique_id !== undefined) {
				const technique = await prisma.cm_techniques.findUnique({
					where: { id: technique_id },
				});
				if (!technique) {
					return res.status(404).json({ error: "Technique not found" });
				}
				data.technique_id = technique_id;
				data.technique_version = technique.version;
			}

			// Allow explicit version pin update
			if (technique_version !== undefined && !technique_id) {
				data.technique_version = technique_version;
			}

			const directive = await prisma.cm_directives.update({
				where: { id: req.params.id },
				data,
				include: {
					technique: { select: { id: true, name: true, version: true } },
				},
			});

			logger.info(`[ConfigMgmt] Directive updated: ${directive.name}`);
			return res.json({ success: true, directive });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to update directive: ${error.message}`);
			return res.status(500).json({ error: "Failed to update directive" });
		}
	},
);

// DELETE /api/v1/configmanagement/directives/:id
router.delete(
	"/directives/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Directives'] */
		/* #swagger.summary = 'Delete a directive' */
		/* #swagger.description = 'Delete a directive by ID. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			await prisma.cm_directives.delete({ where: { id: req.params.id } });
			logger.info(`[ConfigMgmt] Directive deleted: ${req.params.id}`);
			return res.json({ success: true, message: "Directive deleted" });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to delete directive: ${error.message}`);
			return res.status(500).json({ error: "Failed to delete directive" });
		}
	},
);

// ============================================================================
// RULES
// ============================================================================

// GET /api/v1/configmanagement/rules
router.get(
	"/rules",
	authenticateToken,
	requireViewConfigManagement,
	async (_req, res) => {
		/* #swagger.tags = ['Config Management - Rules'] */
		/* #swagger.summary = 'List all rules' */
		/* #swagger.description = 'Retrieve all rules with linked directives and groups. Ordered by priority then name. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const rules = await prisma.cm_rules.findMany({
				orderBy: [{ priority: "asc" }, { name: "asc" }],
				include: {
					cm_rule_directives: {
						include: {
							directive: {
								select: {
									id: true,
									name: true,
									policy_mode: true,
									enabled: true,
								},
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
	},
);

// POST /api/v1/configmanagement/rules
router.post(
	"/rules",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Rules'] */
		/* #swagger.summary = 'Create a rule' */
		/* #swagger.description = 'Create a rule linking directives to host groups. Supports schedule types: always, once, interval, cron. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Production Servers Rule',
			description: 'Apply user management to production',
			directive_ids: ['uuid-of-directive'],
			group_ids: ['uuid-of-group'],
			priority: 50,
			tags: { env: 'prod' },
			run_schedule: 'always',
			schedule_interval: null,
			schedule_cron: null,
			schedule_timezone: 'UTC'
		}
	} */
		try {
			const {
				name,
				description,
				directive_ids,
				group_ids,
				priority,
				tags,
				run_schedule,
				schedule_interval,
				schedule_cron,
				schedule_timezone,
			} = req.body;

			if (!name) {
				return res.status(400).json({ error: "Name is required" });
			}

			// Validate schedule
			const validSchedules = ["always", "once", "interval", "cron"];
			const sched = run_schedule || "always";
			if (!validSchedules.includes(sched)) {
				return res.status(400).json({
					error: `Invalid run_schedule: must be one of ${validSchedules.join(", ")}`,
				});
			}
			if (
				sched === "interval" &&
				(!schedule_interval || schedule_interval < 1)
			) {
				return res.status(400).json({
					error:
						"schedule_interval (minutes) is required and must be >= 1 for interval schedule",
				});
			}
			if (sched === "cron" && !schedule_cron) {
				return res
					.status(400)
					.json({ error: "schedule_cron is required for cron schedule" });
			}

			const rule = await prisma.cm_rules.create({
				data: {
					id: uuidv4(),
					name,
					description: description || null,
					enabled: true,
					priority: priority ?? 50,
					run_schedule: sched,
					schedule_interval: sched === "interval" ? schedule_interval : null,
					schedule_cron: sched === "cron" ? schedule_cron : null,
					schedule_timezone: schedule_timezone || "UTC",
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
	},
);

// GET /api/v1/configmanagement/rules/:id
router.get(
	"/rules/:id",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Rules'] */
		/* #swagger.summary = 'Get a rule by ID' */
		/* #swagger.description = 'Retrieve a single rule with full directive+technique details and groups. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const rule = await prisma.cm_rules.findUnique({
				where: { id: req.params.id },
				include: {
					cm_rule_directives: {
						include: {
							directive: {
								include: {
									technique: {
										select: {
											id: true,
											name: true,
											version: true,
											category: true,
										},
									},
								},
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
	},
);

// PUT /api/v1/configmanagement/rules/:id
router.put(
	"/rules/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Rules'] */
		/* #swagger.summary = 'Update a rule' */
		/* #swagger.description = 'Update rule fields. Replaces directive and group links atomically when provided. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			name: 'Updated Rule Name',
			enabled: true,
			priority: 30,
			directive_ids: ['uuid-of-directive'],
			group_ids: ['uuid-of-group'],
			run_schedule: 'always'
		}
	} */
		try {
			const {
				name,
				description,
				enabled,
				priority,
				directive_ids,
				group_ids,
				tags,
				run_schedule,
				schedule_interval,
				schedule_cron,
				schedule_timezone,
			} = req.body;

			const data = { updated_at: new Date() };
			if (name !== undefined) data.name = name;
			if (description !== undefined) data.description = description;
			if (enabled !== undefined) data.enabled = enabled;
			if (priority !== undefined) data.priority = priority;
			if (tags !== undefined) data.tags = tags;

			// Schedule fields
			if (run_schedule !== undefined) {
				const validSchedules = ["always", "once", "interval", "cron"];
				if (!validSchedules.includes(run_schedule)) {
					return res.status(400).json({
						error: `Invalid run_schedule: must be one of ${validSchedules.join(", ")}`,
					});
				}
				data.run_schedule = run_schedule;
			}
			if (schedule_interval !== undefined)
				data.schedule_interval = schedule_interval;
			if (schedule_cron !== undefined) data.schedule_cron = schedule_cron;
			if (schedule_timezone !== undefined)
				data.schedule_timezone = schedule_timezone;

			// Use transaction to update rule + linked directives/groups atomically
			const result = await prisma.$transaction(async (tx) => {
				const _updated = await tx.cm_rules.update({
					where: { id: req.params.id },
					data,
				});

				if (directive_ids !== undefined) {
					await tx.cm_rule_directives.deleteMany({
						where: { rule_id: req.params.id },
					});
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
					await tx.cm_rule_groups.deleteMany({
						where: { rule_id: req.params.id },
					});
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
						cm_rule_directives: {
							include: { directive: { select: { id: true, name: true } } },
						},
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
	},
);

// DELETE /api/v1/configmanagement/rules/:id
router.delete(
	"/rules/:id",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Rules'] */
		/* #swagger.summary = 'Delete a rule' */
		/* #swagger.description = 'Delete a rule by ID. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			await prisma.cm_rules.delete({ where: { id: req.params.id } });
			logger.info(`[ConfigMgmt] Rule deleted: ${req.params.id}`);
			return res.json({ success: true, message: "Rule deleted" });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to delete rule: ${error.message}`);
			return res.status(500).json({ error: "Failed to delete rule" });
		}
	},
);

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
					technique_version:
						dir.technique_version || dir.technique?.version || "1.0",
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
				schedule: {
					run_schedule: rule.run_schedule || "always",
					schedule_interval: rule.schedule_interval || null,
					schedule_cron: rule.schedule_cron || null,
					schedule_timezone: rule.schedule_timezone || "UTC",
				},
			});

			if (dir.technique && !techniqueMap.has(dir.technique.id)) {
				// Normalize method fields: frontend may store "args" instead of "parameters"
				// and "description" instead of "name" — remap for the Go agent.
				const normalizedMethods = (dir.technique.methods || []).map((m) => ({
					id: m.id,
					type: m.type,
					name: m.name || m.description || "",
					parameters: m.parameters || m.args || {},
					condition: m.condition || "",
					result_alias: m.result_alias || "",
				}));

				techniqueMap.set(dir.technique.id, {
					id: dir.technique.id,
					name: dir.technique.name,
					description: dir.technique.description,
					version: dir.technique.version,
					category: dir.technique.category,
					parameters: dir.technique.parameters || [],
					methods: normalizedMethods,
					conditions: dir.technique.conditions || null,
				});
			}
		}
	}

	if (policyItems.length === 0) {
		return null;
	}

	// Derive global_mode from directive modes instead of hardcoding
	const modes = [...new Set(policyItems.map((item) => item.effective_mode))];
	const globalMode =
		modes.length === 1
			? modes[0]
			: modes.includes("enforce")
				? "enforce"
				: "audit";

	const techniquesArray = Array.from(techniqueMap.values());

	// Diagnostic: log method counts per technique so we can verify the
	// server is including all methods in the policy sent to agents.
	for (const tech of techniquesArray) {
		const methodNames = (tech.methods || []).map(
			(m) => `${m.name || m.id}(${m.type})`,
		);
		logger.info(
			`[ConfigMgmt] Policy technique "${tech.name}" v${tech.version}: ${tech.methods?.length || 0} method(s) [${methodNames.join(", ")}]`,
		);
	}

	return {
		policy_id: uuidv4(),
		host_id: hostId,
		generated_at: new Date().toISOString(),
		global_mode: globalMode,
		directives: policyItems,
		techniques: techniquesArray,
	};
}

// GET /api/v1/configmanagement/policy/:hostId - Get computed policy for a host (UI)
router.get(
	"/policy/:hostId",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Policy'] */
		/* #swagger.summary = 'Get computed policy for a host' */
		/* #swagger.description = 'Compute and return the full resolved policy for a host. Resolves rules → directives → techniques based on host group memberships. Returns null if no applicable rules. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const policy = await computePolicyForHost(req.params.hostId);
			if (!policy) {
				return res.json({
					success: true,
					policy: null,
					message: "No applicable policy for this host",
				});
			}

			// Include a human-readable summary of technique method counts
			const policySummary = (policy.techniques || []).map((t) => ({
				technique: t.name,
				version: t.version,
				method_count: t.methods?.length || 0,
				methods: (t.methods || []).map((m) => ({
					id: m.id,
					name: m.name,
					type: m.type,
				})),
			}));

			return res.json({ success: true, policy, policy_summary: policySummary });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to compute policy: ${error.message}`);
			return res.status(500).json({ error: "Failed to compute policy" });
		}
	},
);

// ============================================================================
// AGENT-FACING ENDPOINTS (X-API-ID / X-API-KEY auth)
// ============================================================================

// GET /api/v1/configmanagement/agent/policy - Agent fetches its computed policy
router.get("/agent/policy", async (req, res) => {
	/* #swagger.tags = ['Config Management - Agent'] */
	/* #swagger.summary = 'Agent: fetch computed policy' */
	/* #swagger.description = 'Agent fetches its computed config management policy. Supports hash-based caching: pass the SHA-256 hash of the last received policy as ?hash= to skip re-download if unchanged. Checks configmanagement_enabled flag. Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	/* #swagger.parameters['hash'] = { in: 'query', type: 'string', description: 'SHA-256 hash of last received policy (for cache check)', required: false } */
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
			return res.json({
				policy: null,
				changed: false,
				message: "Config management is disabled for this host",
			});
		}

		const policy = await computePolicyForHost(host.id);
		if (!policy) {
			return res.json({
				policy: null,
				changed: false,
				message: "No applicable policy",
			});
		}

		// Quick hash check — if nothing changed, tell agent to skip
		const crypto = require("node:crypto");
		const policyJson = JSON.stringify(policy);
		const serverHash = crypto
			.createHash("sha256")
			.update(policyJson)
			.digest("hex");

		if (serverHash === currentHash) {
			return res.json({
				policy: null,
				changed: false,
				message: "Policy unchanged",
			});
		}

		return res.json({ policy, changed: true, message: "New policy available" });
	} catch (error) {
		logger.error(`[ConfigMgmt] Agent policy fetch failed: ${error.message}`);
		return res.status(500).json({ error: "Failed to fetch policy" });
	}
});

// POST /api/v1/configmanagement/agent/report - Agent submits compliance report
router.post("/agent/report", async (req, res) => {
	/* #swagger.tags = ['Config Management - Agent'] */
	/* #swagger.summary = 'Agent: submit compliance report' */
	/* #swagger.description = 'Agent submits a compliance report after evaluating its policy. Stores a cm_policy_runs row. Authenticated via X-API-ID/X-API-KEY headers.' */
	/* #swagger.parameters['X-API-ID'] = { in: 'header', type: 'string', description: 'Host API ID', required: true } */
	/* #swagger.parameters['X-API-KEY'] = { in: 'header', type: 'string', description: 'Host API Key', required: true } */
	/* #swagger.parameters['body'] = {
		in: 'body',
		required: true,
		schema: {
			report: {
				policy_id: 'uuid',
				global_mode: 'audit',
				evaluated_at: '2024-01-01T00:00:00Z',
				total_directives: 1,
				compliant: 1,
				non_compliant: 0,
				errors: 0,
				repaired: 0,
				not_applicable: 0,
				score: 100,
				audited: 0,
				directive_results: []
			},
			current_hash: 'sha256-hash',
			hostname: 'server1',
			machine_id: 'machine-uuid',
			agent_version: '1.5.4'
		}
	} */
	try {
		const apiId = req.headers["x-api-id"];
		const apiKey = req.headers["x-api-key"];
		const { report, current_hash, hostname, machine_id, agent_version } =
			req.body;

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

		logger.info(
			`[ConfigMgmt] Report from ${hostname || host.friendly_name}: ` +
				`${report?.total_directives || 0} directives, score=${report?.score?.toFixed(1) || 0}%`,
		);

		// Diagnostic: log per-directive method counts from the agent report
		if (report?.directive_results && Array.isArray(report.directive_results)) {
			for (const dr of report.directive_results) {
				const methodCount = dr.methods?.length || 0;
				const methodSummary = (dr.methods || [])
					.map((m) => `${m.method_name || m.method_id}:${m.status}`)
					.join(", ");
				logger.info(
					`[ConfigMgmt]   → Directive "${dr.directive_name}": ${methodCount} method result(s) [${methodSummary}] status=${dr.status}`,
				);
			}
		}

		// Store the run — skip if no directives actually ran (e.g. all skipped by schedule)
		if (report && (report.total_directives || 0) > 0) {
			await prisma.cm_policy_runs.create({
				data: {
					id: uuidv4(),
					host_id: host.id,
					policy_id: report.policy_id || null,
					global_mode: report.global_mode || "audit",
					evaluated_at: report.evaluated_at
						? new Date(report.evaluated_at)
						: new Date(),
					total_directives: report.total_directives || 0,
					compliant: report.compliant || 0,
					non_compliant: report.non_compliant || 0,
					errors: report.errors || 0,
					repaired: report.repaired || 0,
					not_applicable: report.not_applicable || 0,
					audited: report.audited || 0,
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

// GET /api/v1/configmanagement/runs/recent - Recent activity (runs in last hour)
router.get(
	"/runs/recent",
	authenticateToken,
	requireViewConfigManagement,
	async (_req, res) => {
		try {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

			const runs = await prisma.cm_policy_runs.findMany({
				where: {
					evaluated_at: { gte: oneHourAgo },
				},
				orderBy: { evaluated_at: "desc" },
				take: 50,
				include: {
					hosts: {
						select: { id: true, friendly_name: true, hostname: true },
					},
				},
			});

			return res.json({
				runs: runs.map((r) => ({
					id: r.id,
					hostId: r.host_id,
					hostName: r.hosts?.friendly_name || r.hosts?.hostname || "Unknown",
					globalMode: r.global_mode,
					evaluatedAt: r.evaluated_at,
					totalDirectives: r.total_directives,
					compliant: r.compliant,
					nonCompliant: r.non_compliant,
					errors: r.errors,
					repaired: r.repaired,
					score: r.score,
				})),
				count: runs.length,
			});
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to fetch recent runs: ${error.message}`);
			return res.status(500).json({ error: "Failed to fetch recent runs" });
		}
	},
);

// GET /api/v1/configmanagement/runs - List recent policy runs
router.get(
	"/runs",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Compliance'] */
		/* #swagger.summary = 'List recent compliance runs' */
		/* #swagger.description = 'List recent policy compliance runs with pagination. Includes host info. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		/* #swagger.parameters['host_id'] = { in: 'query', type: 'string', description: 'Filter by host ID', required: false } */
		/* #swagger.parameters['limit'] = { in: 'query', type: 'integer', description: 'Max results (default 50, max 200)', required: false } */
		/* #swagger.parameters['offset'] = { in: 'query', type: 'integer', description: 'Pagination offset', required: false } */
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
						hosts: {
							select: { id: true, friendly_name: true, hostname: true },
						},
					},
				}),
				prisma.cm_policy_runs.count({ where }),
			]);

			return res.json({ success: true, runs, total });
		} catch (error) {
			logger.error(`[ConfigMgmt] Failed to list runs: ${error.message}`);
			return res.status(500).json({ error: "Failed to list runs" });
		}
	},
);

// GET /api/v1/configmanagement/runs/:id - Get a specific run with full details
router.get(
	"/runs/:id",
	authenticateToken,
	requireViewConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Compliance'] */
		/* #swagger.summary = 'Get a compliance run by ID' */
		/* #swagger.description = 'Retrieve a specific compliance run with full details including host info. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
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
	},
);

// GET /api/v1/configmanagement/dashboard - Overview stats (rich analytics)
router.get(
	"/dashboard",
	authenticateToken,
	requireViewConfigManagement,
	async (_req, res) => {
		/* #swagger.tags = ['Config Management - Dashboard'] */
		/* #swagger.summary = 'Get dashboard statistics' */
		/* #swagger.description = 'Rich analytics: counts, score/run trends (30d), compliance breakdown, mode distribution, category breakdown, top non-compliant hosts, schedule breakdown. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const now = new Date();
			const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

			const [
				allEnabledTechniques,
				allTechniques,
				directiveCount,
				allDirectives,
				ruleCount,
				allRules,
				enabledHosts,
				recentRuns,
				runs30d,
				recent24h,
			] = await Promise.all([
				prisma.cm_techniques.findMany({
					where: { enabled: true },
					select: { name: true },
					distinct: ["name"],
				}),
				prisma.cm_techniques.findMany({
					where: { enabled: true },
					select: { id: true, name: true, category: true },
				}),
				prisma.cm_directives.count({ where: { enabled: true } }),
				prisma.cm_directives.findMany({
					where: { enabled: true },
					select: { id: true, policy_mode: true },
				}),
				prisma.cm_rules.count({ where: { enabled: true } }),
				prisma.cm_rules.findMany({
					where: { enabled: true },
					select: { id: true, run_schedule: true },
				}),
				prisma.hosts.count({ where: { configmanagement_enabled: true } }),
				prisma.cm_policy_runs.findMany({
					orderBy: { evaluated_at: "desc" },
					take: 10,
					include: {
						hosts: {
							select: {
								id: true,
								friendly_name: true,
								hostname: true,
							},
						},
					},
				}),
				prisma.cm_policy_runs.findMany({
					where: { evaluated_at: { gte: thirtyDaysAgo } },
					select: {
						id: true,
						host_id: true,
						evaluated_at: true,
						score: true,
						total_directives: true,
						compliant: true,
						non_compliant: true,
						errors: true,
						repaired: true,
						not_applicable: true,
						audited: true,
						global_mode: true,
					},
					orderBy: { evaluated_at: "asc" },
				}),
				prisma.cm_policy_runs.aggregate({
					where: { evaluated_at: { gte: oneDayAgo } },
					_avg: { score: true },
					_count: true,
				}),
			]);

			const techniqueCount = allEnabledTechniques.length;

			// ── Score & run trend (30d, daily) ────────────────────────────
			const scoreTrend = buildDailyScoreTrend(runs30d, 30);

			// ── Compliance breakdown (30d totals) ─────────────────────────
			const compliance = {
				compliant: 0,
				non_compliant: 0,
				errors: 0,
				repaired: 0,
				not_applicable: 0,
				audited: 0,
			};
			for (const r of runs30d) {
				compliance.compliant += r.compliant || 0;
				compliance.non_compliant += r.non_compliant || 0;
				compliance.errors += r.errors || 0;
				compliance.repaired += r.repaired || 0;
				compliance.not_applicable += r.not_applicable || 0;
				compliance.audited += r.audited || 0;
			}

			// ── Mode distribution (directives) ────────────────────────────
			const modeDistribution = { audit: 0, enforce: 0 };
			for (const d of allDirectives) {
				if (d.policy_mode === "enforce") modeDistribution.enforce++;
				else modeDistribution.audit++;
			}

			// ── Run mode distribution (30d) ───────────────────────────────
			const runModeDistribution = { audit: 0, enforce: 0, mixed: 0 };
			for (const r of runs30d) {
				if (r.global_mode === "enforce") runModeDistribution.enforce++;
				else if (r.global_mode === "audit") runModeDistribution.audit++;
				else runModeDistribution.mixed++;
			}

			// ── Category breakdown (techniques) ───────────────────────────
			const catMap = {};
			for (const t of allTechniques) {
				const cat = t.category || "uncategorized";
				catMap[cat] = (catMap[cat] || 0) + 1;
			}
			const categoryBreakdown = Object.entries(catMap)
				.map(([category, count]) => ({ category, count }))
				.sort((a, b) => b.count - a.count);

			// ── Schedule breakdown (rules) ────────────────────────────────
			const schedMap = {};
			for (const r of allRules) {
				const s = r.run_schedule || "always";
				schedMap[s] = (schedMap[s] || 0) + 1;
			}
			const scheduleBreakdown = Object.entries(schedMap)
				.map(([schedule, count]) => ({ schedule, count }))
				.sort((a, b) => b.count - a.count);

			// ── Top non-compliant hosts (30d, lowest avg score) ───────────
			const hostScores = {};
			for (const r of runs30d) {
				if (!hostScores[r.host_id]) {
					hostScores[r.host_id] = { total: 0, count: 0 };
				}
				hostScores[r.host_id].total += r.score || 0;
				hostScores[r.host_id].count++;
			}
			const hostAvgs = Object.entries(hostScores)
				.map(([host_id, s]) => ({
					host_id,
					avg_score: Math.round((s.total / s.count) * 10) / 10,
					run_count: s.count,
				}))
				.sort((a, b) => a.avg_score - b.avg_score)
				.slice(0, 10);

			// Resolve host names for top non-compliant
			const hostIds = hostAvgs.map((h) => h.host_id);
			const hostsInfo =
				hostIds.length > 0
					? await prisma.hosts.findMany({
							where: { id: { in: hostIds } },
							select: {
								id: true,
								friendly_name: true,
								hostname: true,
							},
						})
					: [];
			const hostNameMap = {};
			for (const h of hostsInfo) {
				hostNameMap[h.id] = h.friendly_name || h.hostname || h.id;
			}
			const topNonCompliant = hostAvgs.map((h) => ({
				...h,
				host_name: hostNameMap[h.host_id] || h.host_id,
			}));

			// ── Score distribution (latest score per host) ────────────────
			const latestByHost = {};
			for (const r of runs30d) {
				if (
					!latestByHost[r.host_id] ||
					r.evaluated_at > latestByHost[r.host_id].evaluated_at
				) {
					latestByHost[r.host_id] = r;
				}
			}
			const scoreDist = { "90-100": 0, "70-89": 0, "50-69": 0, "0-49": 0 };
			for (const r of Object.values(latestByHost)) {
				const s = r.score || 0;
				if (s >= 90) scoreDist["90-100"]++;
				else if (s >= 70) scoreDist["70-89"]++;
				else if (s >= 50) scoreDist["50-69"]++;
				else scoreDist["0-49"]++;
			}

			return res.json({
				success: true,
				dashboard: {
					techniques: techniqueCount,
					directives: directiveCount,
					rules: ruleCount,
					enabled_hosts: enabledHosts,
					recent_runs: recentRuns,
					avg_score_24h: recent24h._avg.score
						? Math.round(recent24h._avg.score * 10) / 10
						: null,
					runs_24h: recent24h._count,
					score_trend: scoreTrend,
					compliance: compliance,
					mode_distribution: modeDistribution,
					run_mode_distribution: runModeDistribution,
					category_breakdown: categoryBreakdown,
					schedule_breakdown: scheduleBreakdown,
					top_non_compliant: topNonCompliant,
					score_distribution: scoreDist,
					total_runs_30d: runs30d.length,
				},
			});
		} catch (error) {
			logger.error(`[ConfigMgmt] Dashboard failed: ${error.message}`);
			return res.status(500).json({ error: "Failed to load dashboard" });
		}
	},
);

/** Build daily score + run-count trend for the last N days. */
function buildDailyScoreTrend(runs, days) {
	const now = new Date();
	const buckets = {};
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		buckets[key] = { date: key, runs: 0, total_score: 0, avg_score: 0 };
	}
	for (const r of runs) {
		const key = new Date(r.evaluated_at).toISOString().slice(0, 10);
		if (buckets[key]) {
			buckets[key].runs++;
			buckets[key].total_score += r.score || 0;
		}
	}
	return Object.values(buckets).map((b) => ({
		date: b.date,
		runs: b.runs,
		avg_score:
			b.runs > 0 ? Math.round((b.total_score / b.runs) * 10) / 10 : null,
	}));
}

// ============================================================================
// DIAGNOSTICS (trace the full pipeline to find issues)
// ============================================================================

// GET /api/v1/configmanagement/diagnose - Full pipeline diagnostic
router.get(
	"/diagnose",
	authenticateToken,
	requireViewConfigManagement,
	async (_req, res) => {
		/* #swagger.tags = ['Config Management - Dashboard'] */
		/* #swagger.summary = 'Run pipeline diagnostics' */
		/* #swagger.description = 'Full pipeline diagnostic: checks techniques, directives, rules, enabled hosts, policy applicability, agent contact recency, and agent version. Returns issues and details. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const prisma = getPrismaClient();
			const issues = [];
			const details = {};

			// Step 1: Check techniques
			const techniques = await prisma.cm_techniques.findMany({
				where: { enabled: true },
				select: { id: true, name: true, methods: true },
			});
			details.techniques = {
				total: techniques.length,
				items: techniques.map((t) => ({
					id: t.id,
					name: t.name,
					methods: Array.isArray(t.methods) ? t.methods.length : 0,
				})),
			};
			if (techniques.length === 0) {
				issues.push({
					severity: "error",
					step: "techniques",
					message:
						"No enabled techniques exist. Create at least one technique with methods.",
				});
			}

			// Step 2: Check directives
			const directives = await prisma.cm_directives.findMany({
				where: { enabled: true },
				select: { id: true, name: true, technique_id: true, parameters: true },
			});
			details.directives = {
				total: directives.length,
				items: directives.map((d) => ({
					id: d.id,
					name: d.name,
					technique_id: d.technique_id,
				})),
			};
			if (directives.length === 0) {
				issues.push({
					severity: "error",
					step: "directives",
					message:
						"No enabled directives exist. Create a directive from a technique.",
				});
			}
			// Check that directives reference valid techniques
			const techIds = new Set(techniques.map((t) => t.id));
			for (const d of directives) {
				if (!techIds.has(d.technique_id)) {
					issues.push({
						severity: "warning",
						step: "directives",
						message: `Directive "${d.name}" references technique ${d.technique_id} which is missing or disabled.`,
					});
				}
			}

			// Step 3: Check rules
			const rules = await prisma.cm_rules.findMany({
				where: { enabled: true },
				include: {
					cm_rule_directives: { select: { directive_id: true } },
					cm_rule_groups: { select: { host_group_id: true } },
				},
			});
			details.rules = {
				total: rules.length,
				items: rules.map((r) => ({
					id: r.id,
					name: r.name,
					directive_count: r.cm_rule_directives.length,
					group_count: r.cm_rule_groups.length,
					directive_ids: r.cm_rule_directives.map((d) => d.directive_id),
					group_ids: r.cm_rule_groups.map((g) => g.host_group_id),
				})),
			};
			if (rules.length === 0) {
				issues.push({
					severity: "error",
					step: "rules",
					message:
						"No enabled rules exist. Create a rule linking directives to host groups.",
				});
			}
			for (const r of rules) {
				if (r.cm_rule_directives.length === 0) {
					issues.push({
						severity: "warning",
						step: "rules",
						message: `Rule "${r.name}" has no directives assigned.`,
					});
				}
				if (r.cm_rule_groups.length === 0) {
					issues.push({
						severity: "warning",
						step: "rules",
						message: `Rule "${r.name}" has no host groups assigned.`,
					});
				}
			}

			// Step 4: Check enabled hosts
			const enabledHosts = await prisma.hosts.findMany({
				where: { configmanagement_enabled: true },
				select: { id: true, friendly_name: true, hostname: true, api_id: true },
			});
			details.enabled_hosts = {
				total: enabledHosts.length,
				items: enabledHosts.map((h) => ({
					id: h.id,
					name: h.friendly_name || h.hostname,
					api_id: h.api_id,
				})),
			};
			if (enabledHosts.length === 0) {
				issues.push({
					severity: "error",
					step: "hosts",
					message:
						"No hosts have Config Management enabled. Toggle it on in each host's detail page (Integrations section).",
				});
			}

			// Step 5: For each enabled host, check if they have an applicable policy
			const hostPolicies = [];
			for (const host of enabledHosts) {
				const policy = await computePolicyForHost(host.id);
				hostPolicies.push({
					host_id: host.id,
					host_name: host.friendly_name || host.hostname,
					has_policy: !!policy,
					directive_count: policy ? policy.directives.length : 0,
				});
				if (!policy) {
					// Check why - is the host in any groups?
					const memberships = await prisma.host_group_memberships.findMany({
						where: { host_id: host.id },
						select: { host_group_id: true },
					});
					if (memberships.length === 0) {
						issues.push({
							severity: "warning",
							step: "hosts",
							message: `Host "${host.friendly_name || host.hostname}" is not in any host group. Add it to a group that has CM rules.`,
						});
					} else {
						const groupIds = memberships.map((m) => m.host_group_id);
						const matchingRules = await prisma.cm_rule_groups.findMany({
							where: { host_group_id: { in: groupIds } },
							select: { rule_id: true },
						});
						if (matchingRules.length === 0) {
							issues.push({
								severity: "warning",
								step: "hosts",
								message: `Host "${host.friendly_name || host.hostname}" is in ${groupIds.length} group(s) but no CM rules target those groups.`,
							});
						}
					}
				}
			}
			details.host_policies = hostPolicies;

			// Step 6: Check recent agent contact
			const allHosts = await prisma.hosts.findMany({
				where: { configmanagement_enabled: true },
				select: {
					id: true,
					friendly_name: true,
					hostname: true,
					last_update: true,
					agent_version: true,
				},
			});
			for (const h of allHosts) {
				if (h.last_update) {
					const lastSeen = new Date(h.last_update);
					const minutesAgo = (Date.now() - lastSeen.getTime()) / 60000;
					if (minutesAgo > 90) {
						issues.push({
							severity: "warning",
							step: "agents",
							message: `Host "${h.friendly_name || h.hostname}" was last seen ${Math.round(minutesAgo)} minutes ago. Agent may not be running.`,
						});
					}
				}
				if (h.agent_version && h.agent_version < "1.4.3") {
					issues.push({
						severity: "warning",
						step: "agents",
						message: `Host "${h.friendly_name || h.hostname}" is running agent ${h.agent_version}. Config Management requires v1.4.3+.`,
					});
				}
			}

			// Summary
			const pipeline_ok =
				issues.filter((i) => i.severity === "error").length === 0 &&
				enabledHosts.length > 0 &&
				hostPolicies.some((hp) => hp.has_policy);

			return res.json({
				success: true,
				pipeline_ok,
				issues,
				details,
			});
		} catch (error) {
			logger.error(`[ConfigMgmt] Diagnose failed: ${error.message}`);
			return res.status(500).json({ error: "Failed to run diagnostics" });
		}
	},
);

// POST /api/v1/configmanagement/test-run/:hostId - Evaluate policy server-side and store a test run
router.post(
	"/test-run/:hostId",
	authenticateToken,
	requireManageConfigManagement,
	async (req, res) => {
		/* #swagger.tags = ['Config Management - Dashboard'] */
		/* #swagger.summary = 'Create a server-side test run' */
		/* #swagger.description = 'Compute policy for a host and generate a cm_policy_runs entry with all directives marked not_evaluated/not_applicable. Useful for testing the pipeline without an agent. Requires JWT auth.' */
		/* #swagger.security = [{ "bearerAuth": [] }] */
		try {
			const prisma = getPrismaClient();
			const { hostId } = req.params;

			// Verify host exists and has CM enabled
			const host = await prisma.hosts.findUnique({
				where: { id: hostId },
				select: {
					id: true,
					friendly_name: true,
					hostname: true,
					configmanagement_enabled: true,
				},
			});
			if (!host) {
				return res.status(404).json({ error: "Host not found" });
			}

			// Compute policy
			const policy = await computePolicyForHost(host.id);
			if (!policy) {
				return res.status(400).json({
					error: "No applicable policy for this host",
					message:
						"Ensure the host is in a group targeted by an enabled rule with directives.",
				});
			}

			// Server-side "evaluation" — since we can't run methods here, mark all as "audit_compliant" or "not_evaluated"
			const directiveResults = policy.directives.map((item) => ({
				directive_id: item.directive.id,
				directive_name: item.directive.name,
				technique_id: item.directive.technique_id,
				policy_mode: item.effective_mode,
				status: "not_evaluated",
				methods: [],
				started_at: new Date().toISOString(),
				completed_at: new Date().toISOString(),
			}));

			const totalDirectives = directiveResults.length;
			const run = await prisma.cm_policy_runs.create({
				data: {
					id: uuidv4(),
					host_id: host.id,
					policy_id: policy.policy_id,
					global_mode: policy.global_mode,
					evaluated_at: new Date(),
					total_directives: totalDirectives,
					compliant: 0,
					non_compliant: 0,
					errors: 0,
					repaired: 0,
					not_applicable: totalDirectives,
					audited: 0,
					score: 0,
					directive_results: directiveResults,
					created_at: new Date(),
				},
			});

			logger.info(
				`[ConfigMgmt] Test run created for ${host.friendly_name || host.hostname}: ${totalDirectives} directives`,
			);

			return res.json({
				success: true,
				run,
				policy_summary: {
					policy_id: policy.policy_id,
					directives: totalDirectives,
					techniques: policy.techniques.length,
				},
			});
		} catch (error) {
			logger.error(`[ConfigMgmt] Test run failed: ${error.message}`);
			return res.status(500).json({ error: "Failed to create test run" });
		}
	},
);

module.exports = router;
