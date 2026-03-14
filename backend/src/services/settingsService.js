const { getPrismaClient } = require("../config/prisma");
const logger = require("../utils/logger");
const { v4: uuidv4 } = require("uuid");

const prisma = getPrismaClient();

// Cached settings instance
let cachedSettings = null;

// Environment variable to settings field mapping
const ENV_TO_SETTINGS_MAP = {
	SERVER_PROTOCOL: "server_protocol",
	SERVER_HOST: "server_host",
	SERVER_PORT: "server_port",
};

// Helper function to construct server URL without default ports
function constructServerUrl(protocol, host, port) {
	const isHttps = protocol.toLowerCase() === "https";
	const isHttp = protocol.toLowerCase() === "http";

	// Don't append port if it's the default port for the protocol
	if ((isHttps && port === 443) || (isHttp && port === 80)) {
		return `${protocol}://${host}`.toLowerCase();
	}

	return `${protocol}://${host}:${port}`.toLowerCase();
}

// Create settings from environment variables and/or defaults
async function createSettingsFromEnvironment() {
	const protocol = process.env.SERVER_PROTOCOL || "http";
	const host = process.env.SERVER_HOST || "localhost";
	const port = parseInt(process.env.SERVER_PORT, 10) || 3001;
	const serverUrl = constructServerUrl(protocol, host, port);

	const settings = await prisma.settings.create({
		data: {
			id: uuidv4(),
			server_url: serverUrl,
			server_protocol: protocol,
			server_host: host,
			server_port: port,
			update_interval: 60,
			auto_update: false,
			default_compliance_mode: "on-demand",
			signup_enabled: false,
			ignore_ssl_self_signed: false,
			updated_at: new Date(),
		},
	});

	logger.info("Created settings");
	return settings;
}

// Sync environment variables with existing settings
async function syncEnvironmentToSettings(currentSettings) {
	const updates = {};
	let hasChanges = false;

	// Check each environment variable mapping
	for (const [envVar, settingsField] of Object.entries(ENV_TO_SETTINGS_MAP)) {
		if (process.env[envVar]) {
			const envValue = process.env[envVar];
			const currentValue = currentSettings[settingsField];

			// Convert environment value to appropriate type
			let convertedValue = envValue;
			if (settingsField === "server_port") {
				convertedValue = parseInt(envValue, 10);
			}

			// Only update if values differ
			if (currentValue !== convertedValue) {
				updates[settingsField] = convertedValue;
				hasChanges = true;
				if (process.env.ENABLE_LOGGING === "true") {
					logger.info(
						`Environment variable ${envVar} (${envValue}) differs from settings ${settingsField} (${currentValue}), updating...`,
					);
				}
			}
		}
	}

	// Construct server_url from components if any components were updated
	const protocol = updates.server_protocol || currentSettings.server_protocol;
	const host = updates.server_host || currentSettings.server_host;
	const port = updates.server_port || currentSettings.server_port;
	const constructedServerUrl = constructServerUrl(protocol, host, port);

	// Update server_url if it differs from the constructed value
	if (currentSettings.server_url !== constructedServerUrl) {
		updates.server_url = constructedServerUrl;
		hasChanges = true;
		if (process.env.ENABLE_LOGGING === "true") {
			logger.info(`Updating server_url to: ${constructedServerUrl}`);
		}
	}

	// Update settings if there are changes
	if (hasChanges) {
		const updatedSettings = await prisma.settings.update({
			where: { id: currentSettings.id },
			data: {
				...updates,
				updated_at: new Date(),
			},
		});
		if (process.env.ENABLE_LOGGING === "true") {
			logger.info(
				`Synced ${Object.keys(updates).length} environment variables to settings`,
			);
		}
		return updatedSettings;
	}

	return currentSettings;
}

// Initialise settings - create from environment or sync existing
async function initSettings() {
	if (cachedSettings) {
		return cachedSettings;
	}

	try {
		// Deterministic ordering so we always get the same row when multiple rows exist (e.g. ties on updated_at)
		let settings = await prisma.settings.findFirst({
			orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		});

		if (!settings) {
			// No settings exist, create from environment variables and defaults
			settings = await createSettingsFromEnvironment();
		}
		// When settings exist, use DB as source of truth so saved URL (and other settings) persist across restarts.
		// Do not overwrite with env vars here; env is only used for initial creation.
		// To reset URL from env, use a dedicated "sync from environment" action if needed.

		// Cache the initialised settings
		cachedSettings = settings;
		return settings;
	} catch (error) {
		logger.error("Failed to initialise settings:", error);
		throw error;
	}
}

// Get current settings (returns cached if available)
async function getSettings() {
	return cachedSettings || (await initSettings());
}

// Get settings from DB and update cache. Use for GET /settings so the UI always
// sees persisted values after refresh (avoids stale in-memory cache when
// multiple processes or when cache was never updated by a PUT on this process).
async function getSettingsForDisplay() {
	try {
		const settings = await prisma.settings.findFirst({
			orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		});
		if (settings) {
			cachedSettings = settings;
			return settings;
		}
		return await initSettings();
	} catch (error) {
		logger.error("Failed to get settings for display:", error);
		throw error;
	}
}

// Update settings and refresh cache
async function updateSettings(id, updateData) {
	try {
		const updatedSettings = await prisma.settings.update({
			where: { id },
			data: {
				...updateData,
				updated_at: new Date(),
			},
		});

		// Reconstruct server_url from components and persist so GET/cache stay in sync
		const serverUrl = constructServerUrl(
			updatedSettings.server_protocol,
			updatedSettings.server_host,
			updatedSettings.server_port,
		);
		if (updatedSettings.server_url !== serverUrl) {
			await prisma.settings.update({
				where: { id },
				data: { server_url: serverUrl },
			});
			updatedSettings.server_url = serverUrl;
		}

		// Update cache with full object so GET /settings returns correct values
		cachedSettings = updatedSettings;
		return updatedSettings;
	} catch (error) {
		logger.error("Failed to update settings:", error);
		throw error;
	}
}

// Invalidate cache (useful for testing or manual refresh)
function invalidateCache() {
	cachedSettings = null;
}

/**
 * Auto-discover custom branding files in the branding/ directory and update
 * settings if they still point to the built-in defaults (/assets/...).
 *
 * This covers two scenarios:
 *  1. The user placed files directly in the branding directory on the server.
 *  2. The user uploaded via Settings > Branding on a previous run, but the DB
 *     row was recreated (e.g. migration) and the defaults were restored.
 *
 * Only upgrades paths that currently match the Prisma @default values.
 */
async function autoDiscoverBranding() {
	const fs = require("node:fs");
	const path = require("node:path");
	const brandingDir =
		process.env.BRANDING_DIR ||
		process.env.ASSETS_DIR ||
		path.join(__dirname, "../../../branding");

	// Map: settings field → { default DB value, filename(s) to look for in branding dir }
	const checks = [
		{
			field: "logo_dark",
			defaults: ["/assets/logo_dark.png", null],
			fileNames: ["logo_dark.png", "logo_dark.svg", "logo_dark.jpg"],
		},
		{
			field: "logo_light",
			defaults: ["/assets/logo_light.png", null],
			fileNames: ["logo_light.png", "logo_light.svg", "logo_light.jpg"],
		},
		{
			field: "favicon",
			defaults: ["/assets/logo_square.svg", "/assets/favicon.svg", null],
			fileNames: ["logo_square.svg", "favicon.svg"],
		},
	];

	try {
		const settings = await getSettings();
		if (!settings) return;

		const updates = {};
		for (const check of checks) {
			const currentVal = settings[check.field];
			// Only replace if the setting is a default/null value
			if (!check.defaults.includes(currentVal)) continue;

			for (const fileName of check.fileNames) {
				const fullPath = path.join(brandingDir, fileName);
				if (fs.existsSync(fullPath)) {
					updates[check.field] = `/api/v1/branding/${fileName}`;
					logger.info(
						`🎨 Auto-discovered branding file: ${fileName} → ${check.field}`,
					);
					break;
				}
			}
		}

		if (Object.keys(updates).length > 0) {
			await updateSettings(settings.id, updates);
			logger.info(
				`🎨 Updated ${Object.keys(updates).length} branding path(s) from branding directory`,
			);
		}
	} catch (err) {
		logger.warn("Failed to auto-discover branding:", err.message);
	}
}

module.exports = {
	initSettings,
	getSettings,
	getSettingsForDisplay,
	updateSettings,
	invalidateCache,
	syncEnvironmentToSettings, // Export for startup use
	autoDiscoverBranding,
};
