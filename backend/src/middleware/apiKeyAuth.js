/**
 * API Key Authentication Middleware
 *
 * Validates `pmk_...` API keys (user_api_keys or admin_api_keys tables) and
 * populates req.user the same way JWT auth does, so downstream permission
 * checks work unchanged.
 *
 * - User keys: req.user is the real user row (their actual role/permissions)
 * - Admin keys: req.user gets role "admin" for full access
 *
 * Sets req.authMethod = "api_key" so routes can tell the two apart.
 */

const bcrypt = require("bcryptjs");
const logger = require("../utils/logger");
const { getPrismaClient } = require("../config/prisma");

const prisma = getPrismaClient();

function isApiKeyFormat(token) {
	return typeof token === "string" && token.startsWith("pmk_");
}

/**
 * Attempt to authenticate a request via API key.
 * @returns {Promise<{ok: boolean, user?: object, reason?: string}>}
 */
async function authenticateApiKey(apiKey) {
	// 1. Try user_api_keys first
	const userKeys = await prisma.$queryRaw`
		SELECT id, user_id, name, key_hash
		FROM user_api_keys
		WHERE is_active = true
	`;

	for (const key of userKeys) {
		const isValid = await bcrypt.compare(apiKey, String(key.key_hash));
		if (isValid) {
			await prisma.$executeRaw`
				UPDATE user_api_keys SET last_used_at = NOW() WHERE id = ${key.id}
			`.catch(() => {});

			const user = await prisma.users.findUnique({
				where: { id: String(key.user_id) },
				select: {
					id: true,
					username: true,
					email: true,
					role: true,
					last_login: true,
				},
			});

			if (!user || user.role === "inactive") {
				return { ok: false, reason: "User for this key no longer exists" };
			}

			logger.info(`API key auth: user key "${key.name}" → user ${user.username}`);
			return { ok: true, user };
		}
	}

	// 2. Try admin_api_keys
	const adminKeys = await prisma.$queryRaw`
		SELECT id, username, email, key_hash
		FROM admin_api_keys
		WHERE is_active = true
	`;

	for (const key of adminKeys) {
		const isValid = await bcrypt.compare(apiKey, String(key.key_hash));
		if (isValid) {
			await prisma.$executeRaw`
				UPDATE admin_api_keys SET last_used_at = NOW() WHERE id = ${key.id}
			`.catch(() => {});

			logger.info(`API key auth: admin key → ${key.username}`);
			return {
				ok: true,
				user: {
					id: key.id,
					username: key.username,
					email: key.email,
					role: "admin",
					last_login: new Date(),
				},
			};
		}
	}

	return { ok: false, reason: "Invalid or expired API key" };
}

module.exports = { authenticateApiKey, isApiKeyFormat };
