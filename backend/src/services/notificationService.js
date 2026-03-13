const { prisma } = require("./automation/shared/prisma");
const logger = require("../utils/logger");

// ─── Severity → colour mapping ───────────────────────────────────────────────
const SEVERITY_COLORS = {
	critical: 0xff0000, // red
	warning: 0xffa500, // orange
	informational: 0x3b82f6, // blue
	low: 0x6b7280, // grey
};

const SEVERITY_EMOJI = {
	critical: "🔴",
	warning: "🟠",
	informational: "🔵",
	low: "⚪",
};

// ─── Discord ─────────────────────────────────────────────────────────────────
async function sendDiscord(channel, alert) {
	const color = SEVERITY_COLORS[alert.severity] ?? 0x6b7280;
	const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚪";
	const cfg = channel.config ?? {};

	const embed = {
		title: `${emoji}  ${alert.title}`,
		description: alert.message || "",
		color,
		fields: [
			{ name: "Type", value: alert.type, inline: true },
			{
				name: "Severity",
				value: alert.severity?.toUpperCase() ?? "UNKNOWN",
				inline: true,
			},
		],
		timestamp: new Date().toISOString(),
		footer: { text: "Monux Alert System" },
	};

	// Attach host info from metadata when available
	if (alert.metadata?.hostname) {
		embed.fields.push({
			name: "Host",
			value: alert.metadata.hostname,
			inline: true,
		});
	}

	const body = {
		username: cfg.username || "Monux",
		avatar_url: cfg.avatar_url || undefined,
		embeds: [embed],
	};

	const resp = await fetch(channel.webhook_url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`Discord ${resp.status}: ${text}`);
	}
}

// ─── Microsoft Teams (Incoming Webhook – Adaptive Card) ──────────────────────
async function sendTeams(channel, alert) {
	const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚪";
	const cfg = channel.config ?? {};

	// Teams webhook expects an Adaptive Card payload
	const card = {
		type: "message",
		attachments: [
			{
				contentType: "application/vnd.microsoft.card.adaptive",
				contentUrl: null,
				content: {
					$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
					type: "AdaptiveCard",
					version: "1.4",
					body: [
						{
							type: "TextBlock",
							size: "Large",
							weight: "Bolder",
							text: `${emoji} ${alert.title}`,
							wrap: true,
						},
						{
							type: "TextBlock",
							text: alert.message || "",
							wrap: true,
							spacing: "Small",
						},
						{
							type: "FactSet",
							facts: [
								{ title: "Type", value: alert.type },
								{
									title: "Severity",
									value: alert.severity?.toUpperCase() ?? "UNKNOWN",
								},
								...(alert.metadata?.hostname
									? [{ title: "Host", value: alert.metadata.hostname }]
									: []),
							],
						},
						{
							type: "TextBlock",
							text: `Sent by Monux at ${new Date().toISOString()}`,
							size: "Small",
							isSubtle: true,
							wrap: true,
							spacing: "Medium",
						},
					],
					...(cfg.theme_color ? { msTeams: { width: "Full" } } : {}),
				},
			},
		],
	};

	const resp = await fetch(channel.webhook_url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(card),
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`Teams ${resp.status}: ${text}`);
	}
}

// ─── Generic Webhook ─────────────────────────────────────────────────────────
async function sendWebhook(channel, alert) {
	const cfg = channel.config ?? {};

	const payload = {
		event: "alert.created",
		alert: {
			id: alert.id,
			type: alert.type,
			severity: alert.severity,
			title: alert.title,
			message: alert.message,
			metadata: alert.metadata ?? {},
			created_at: alert.created_at,
		},
		channel: {
			id: channel.id,
			name: channel.name,
		},
		sent_at: new Date().toISOString(),
	};

	const headers = {
		"Content-Type": "application/json",
		"User-Agent": "Monux-Webhook/1.0",
		...(cfg.headers ?? {}),
	};

	// Optional shared secret for HMAC-style auth
	if (cfg.secret) {
		const crypto = require("node:crypto");
		const hmac = crypto
			.createHmac("sha256", cfg.secret)
			.update(JSON.stringify(payload))
			.digest("hex");
		headers["X-PatchMon-Signature"] = `sha256=${hmac}`;
	}

	const resp = await fetch(channel.webhook_url, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`Webhook ${resp.status}: ${text}`);
	}
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────
const SENDERS = {
	discord: sendDiscord,
	teams: sendTeams,
	webhook: sendWebhook,
};

/**
 * Dispatch an alert to all matching, enabled channels.
 * Called fire-and-forget from alertService.createAlert().
 */
async function dispatchAlert(alert) {
	try {
		const channels = await prisma.alert_channels.findMany({
			where: { enabled: true },
		});

		if (channels.length === 0) return;

		for (const ch of channels) {
			// ── severity filter ──
			if (ch.severity_filter && Array.isArray(ch.severity_filter)) {
				if (!ch.severity_filter.includes(alert.severity)) continue;
			}

			// ── type filter ──
			if (ch.type_filter && Array.isArray(ch.type_filter)) {
				if (!ch.type_filter.includes(alert.type)) continue;
			}

			const sender = SENDERS[ch.channel_type];
			if (!sender) {
				logger.warn(
					`⚠️ Unknown channel type "${ch.channel_type}" for channel ${ch.id}`,
				);
				continue;
			}

			try {
				await sender(ch, alert);
				logger.info(
					`📨 Alert ${alert.id} dispatched to ${ch.channel_type} channel "${ch.name}"`,
				);
			} catch (err) {
				logger.error(
					`❌ Failed to send alert ${alert.id} to channel "${ch.name}" (${ch.channel_type}):`,
					err.message,
				);
			}
		}
	} catch (err) {
		logger.error("❌ dispatchAlert top-level error:", err);
	}
}

/**
 * Send a test notification to a specific channel.
 * @param {object} channelData - channel row (or unsaved channel body).
 */
async function sendTestNotification(channelData) {
	const testAlert = {
		id: "test-00000000",
		type: "test_notification",
		severity: "informational",
		title: "🔔 Test notification from Monux",
		message:
			"If you're seeing this, your alert channel is configured correctly!",
		metadata: { hostname: "test-host.example.com" },
		created_at: new Date().toISOString(),
	};

	const sender = SENDERS[channelData.channel_type];
	if (!sender) {
		throw new Error(`Unknown channel type: ${channelData.channel_type}`);
	}

	await sender(channelData, testAlert);
}

module.exports = {
	dispatchAlert,
	sendTestNotification,
};
