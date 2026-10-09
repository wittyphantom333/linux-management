/**
 * API Key Management Routes
 *
 * Allows users to create/manage their own API keys, and admins to view/revoke all keys.
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { getPrismaClient } = require("../config/prisma");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Generate a random API key with "pmk_" prefix
function generateApiKey() {
	const raw = crypto.randomBytes(24).toString("hex");
	return `pmk_${raw}`;
}

// Mask an API key for display (e.g., pmk_••••8f29a1c3)
function maskApiKey(key) {
	if (!key || key.length < 6) return "••••••";
	const prefix = key.substring(0, 4); // pmk_
	const suffix = key.slice(-8);
	return `${prefix}••••${suffix}`;
}

/**
 * GET /api/v1/api-keys
 * List all API keys for the current user (users) or all users' keys (admins)
 */
router.get("/", authenticateToken, async (req, res) => {
	try {
		const prisma = getPrismaClient();
		const userId = req.user.id;
		const isUser = req.user.role === "user";

		let result;

		if (isUser) {
			// Users only see their own keys
			const keys = await prisma.$queryRaw`
				SELECT id, user_id, name, masked_key, last_used_at, created_at, is_active
				FROM user_api_keys
				WHERE user_id = ${userId}
				ORDER BY created_at DESC
			`;
			result = {
				keys: keys.map(k => ({
					id: k.id,
					name: k.name,
					maskedKey: String(k.masked_key),
					lastUsedAt: k.last_used_at?.toISOString() || null,
					createdAt: k.created_at.toISOString(),
					isActive: Boolean(k.is_active),
				})),
				type: "user",
			};
		} else {
			// Admins see all keys
			const [userKeys, adminKeys] = await Promise.all([
				prisma.$queryRaw`
					SELECT id, user_id, name, masked_key, last_used_at, created_at, is_active
					FROM user_api_keys
					ORDER BY created_at DESC
				`,
				prisma.$queryRaw`
					SELECT id, username, email, masked_key, last_used_at, created_at, is_active
					FROM admin_api_keys
					ORDER BY created_at DESC
				`,
			]);

			result = {
				keys: [
					...userKeys.map(k => ({
						id: k.id,
						type: "user",
						user_id: String(k.user_id),
						name: k.name,
						maskedKey: String(k.masked_key),
						lastUsedAt: k.last_used_at?.toISOString() || null,
						createdAt: k.created_at.toISOString(),
						isActive: Boolean(k.is_active),
					})),
					...adminKeys.map(k => ({
						id: k.id,
						type: "admin",
						username: k.username,
						email: k.email,
						maskedKey: String(k.masked_key),
						lastUsedAt: k.last_used_at?.toISOString() || null,
						createdAt: k.created_at.toISOString(),
						isActive: Boolean(k.is_active),
					})),
				],
				type: "all",
			};
		}

		res.json(result);
	} catch (error) {
		logger.error("Failed to list API keys:", error.message);
		res.status(500).json({ error: "Failed to list API keys" });
	}
});

/**
 * POST /api/v1/api-keys/create
 * Create a new API key for the current user
 */
router.post("/create", authenticateToken, async (req, res) => {
	try {
		const prisma = getPrismaClient();
		const userId = req.user.id;
		const isUser = req.user.role === "user";

		if (!isUser) {
			return res.status(403).json({ error: "Only regular users can create personal API keys" });
		}

		const { name } = req.body;
		if (!name || typeof name !== "string" || name.length > 100) {
			return res.status(400).json({ error: "A valid name (max 100 chars) is required" });
		}

		const apiKey = generateApiKey();
		const keyHash = await bcrypt.hash(apiKey, 12);
		const maskedKey = maskApiKey(apiKey);

		await prisma.$executeRaw`
			INSERT INTO user_api_keys (user_id, name, key_hash, masked_key)
			VALUES (${userId}, ${name}, ${keyHash}, ${maskedKey})
		`;

		logger.info(`API key created for user ${userId} (${name})`);

		res.json({
			success: true,
			apiKey, // Only returned once!
			maskedKey,
			name,
			message: "API key created. Copy it now — it won't be shown again.",
		});
	} catch (error) {
		logger.error("Failed to create API key:", error.message);
		res.status(500).json({ error: "Failed to create API key" });
	}
});

/**
 * POST /api/v1/api-keys/revoke
 * Revoke an API key
 */
router.post("/revoke", authenticateToken, async (req, res) => {
	try {
		const prisma = getPrismaClient();
		const userId = req.user.id;
		const isUser = req.user.role === "user";

		const { id } = req.body;
		if (!id) {
			return res.status(400).json({ error: "API key ID is required" });
		}

		let result;

		if (isUser) {
			result = await prisma.$executeRaw`
				UPDATE user_api_keys
				SET is_active = false, updated_at = NOW()
				WHERE id = ${id} AND user_id = ${userId}
			`;
		} else {
			result = await prisma.$executeRaw`
				UPDATE admin_api_keys
				SET is_active = false, updated_at = NOW()
				WHERE id = ${id}
			`;
		}

		if (result === 0) {
			return res.status(404).json({ error: "API key not found or no permissions" });
		}

		logger.info(`API key ${id} revoked`);

		res.json({ success: true, message: "API key revoked successfully" });
	} catch (error) {
		logger.error("Failed to revoke API key:", error.message);
		res.status(500).json({ error: "Failed to revoke API key" });
	}
});

/**
 * GET /api/v1/api-keys/validate
 * Validate an API key and return user info (used by MCP and other integrations)
 */
router.get("/validate", async (req, res) => {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader) {
			return res.status(401).json({ error: "Authorization header required" });
		}

		const apiKey = authHeader.replace("Bearer ", "");
		if (!apiKey) {
			return res.status(401).json({ error: "API key is required" });
		}

		const prisma = getPrismaClient();

		// Search user keys first
		const userKeys = await prisma.$queryRaw`
			SELECT id, user_id, name, masked_key, last_used_at, created_at
			FROM user_api_keys
			WHERE is_active = true
		`;

		for (const key of userKeys) {
			const isValid = await bcrypt.compare(apiKey, String(key.key_hash));
			if (isValid) {
				// Update last used
				await prisma.$executeRaw`
					UPDATE user_api_keys SET last_used_at = NOW() WHERE id = ${key.id}
				`;

				// Get user info
				const users = await prisma.users.findUnique({
					where: { id: String(key.user_id) },
					select: { id: true, username: true, email: true, role: true, last_login: true },
				});

				return res.json({
					valid: true,
					type: "user",
					user: users,
					keyName: key.name,
					maskedKey: String(key.masked_key),
					lastUsedAt: key.last_used_at?.toISOString() || null,
				});
			}
		}

		// Search admin keys
		const adminKeys = await prisma.$queryRaw`
			SELECT id, username, email, masked_key, last_used_at
			FROM admin_api_keys
			WHERE is_active = true
		`;

		for (const key of adminKeys) {
			const isValid = await bcrypt.compare(apiKey, String(key.key_hash));
			if (isValid) {
				await prisma.$executeRaw`
					UPDATE admin_api_keys SET last_used_at = NOW() WHERE id = ${key.id}
				`;

				return res.json({
					valid: true,
					type: "admin",
					username: key.username,
					email: key.email,
					maskedKey: String(key.masked_key),
					lastUsedAt: key.last_used_at?.toISOString() || null,
				});
			}
		}

		res.status(401).json({ valid: false, error: "Invalid or expired API key" });
	} catch (error) {
		logger.error("Failed to validate API key:", error.message);
		res.status(500).json({ error: "Failed to validate API key" });
	}
});

/**
 * POST /api/v1/api-keys/create-admin
 * Create an admin API key (requires admin role)
 */
router.post("/create-admin", authenticateToken, async (req, res) => {
	try {
		if (req.user.role !== "admin") {
			return res.status(403).json({ error: "Admin access required" });
		}

		const prisma = getPrismaClient();
		const { username } = req.body;

		if (!username || typeof username !== "string") {
			return res.status(400).json({ error: "A valid username is required" });
		}

		// Get user info
		const user = await prisma.users.findUnique({
			where: { username },
			select: { id: true, email: true },
		});

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const apiKey = generateApiKey();
		const keyHash = await bcrypt.hash(apiKey, 12);
		const maskedKey = maskApiKey(apiKey);

		await prisma.$executeRaw`
			INSERT INTO admin_api_keys (username, email, key_hash, masked_key)
			VALUES (${username}, ${user.email}, ${keyHash}, ${maskedKey})
		`;

		logger.info(`Admin API key created for user ${username}`);

		res.json({
			success: true,
			apiKey,
			maskedKey,
			username,
			message: "Admin API key created. Copy it now — it won't be shown again.",
		});
	} catch (error) {
		logger.error("Failed to create admin API key:", error.message);
		res.status(500).json({ error: "Failed to create admin API key" });
	}
});

module.exports = router;
