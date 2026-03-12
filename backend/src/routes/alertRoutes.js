const express = require("express");
const logger = require("../utils/logger");
const alertService = require("../services/alertService");
const alertConfigService = require("../services/alertConfigService");
const notificationService = require("../services/notificationService");
const { authenticateToken } = require("../middleware/auth");
const {
	requireViewReports,
	requireManageSettings,
} = require("../middleware/permissions");

const { prisma } = require("../services/automation/shared/prisma");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// Get all global alerts (including inactive/resolved)
router.get("/", authenticateToken, requireViewReports, async (req, res) => {
	try {
		const { assignedToMe } = req.query;
		const userId = assignedToMe === "true" ? req.user.id : null;

		// Include inactive alerts so resolved alerts are visible
		const alerts = await alertService.getActiveAlerts(userId, true);

		res.json({
			success: true,
			data: alerts,
		});
	} catch (error) {
		logger.error("Error fetching alerts:", error);
		res.status(500).json({
			success: false,
			error: "Failed to fetch alerts",
		});
	}
});

// Get alert statistics by severity
router.get(
	"/stats",
	authenticateToken,
	requireViewReports,
	async (_req, res) => {
		try {
			const stats = await alertService.getAlertStats();

			res.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Error fetching alert stats:", error);
			res.status(500).json({
				success: false,
				error: "Failed to fetch alert statistics",
			});
		}
	},
);

// Get list of available actions
router.get(
	"/actions",
	authenticateToken,
	requireViewReports,
	async (_req, res) => {
		try {
			const actions = await alertService.getAvailableActions();

			res.json({
				success: true,
				data: actions,
			});
		} catch (error) {
			logger.error("Error fetching available actions:", error);
			res.status(500).json({
				success: false,
				error: "Failed to fetch available actions",
			});
		}
	},
);

// Get all alert configuration settings (MUST be before /:id routes)
router.get(
	"/config",
	authenticateToken,
	requireManageSettings,
	async (_req, res) => {
		try {
			const config = await alertConfigService.getAlertConfig();

			res.json({
				success: true,
				data: config,
			});
		} catch (error) {
			logger.error("Error fetching alert config:", error);
			res.status(500).json({
				success: false,
				error: "Failed to fetch alert configuration",
			});
		}
	},
);

// Bulk update multiple alert type configurations (MUST be before /config/:alertType)
router.post(
	"/config/bulk-update",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { configs } = req.body;

			if (!Array.isArray(configs)) {
				return res.status(400).json({
					success: false,
					error: "Configs must be an array",
				});
			}

			const results = [];

			for (const config of configs) {
				if (!config.alert_type) {
					continue;
				}

				try {
					const updated = await alertConfigService.updateAlertConfig(
						config.alert_type,
						config,
					);
					results.push({
						success: true,
						alert_type: config.alert_type,
						data: updated,
					});
				} catch (error) {
					results.push({
						success: false,
						alert_type: config.alert_type,
						error: error.message,
					});
				}
			}

			res.json({
				success: true,
				data: results,
				message: "Bulk update completed",
			});
		} catch (error) {
			logger.error("Error bulk updating alert config:", error);
			res.status(500).json({
				success: false,
				error: "Failed to bulk update alert configuration",
				details: error.message,
			});
		}
	},
);

// Get configuration for specific alert type (read-only, viewable by users who can view reports)
router.get(
	"/config/:alertType",
	authenticateToken,
	requireViewReports,
	async (req, res) => {
		try {
			const { alertType } = req.params;

			const config = await alertConfigService.getAlertConfigByType(alertType);

			if (!config) {
				return res.status(404).json({
					success: false,
					error: "Alert type configuration not found",
				});
			}

			res.json({
				success: true,
				data: config,
			});
		} catch (error) {
			logger.error("Error fetching alert config by type:", error);
			res.status(500).json({
				success: false,
				error: "Failed to fetch alert configuration",
			});
		}
	},
);

// Update configuration for specific alert type
router.put(
	"/config/:alertType",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { alertType } = req.params;
			const config = req.body;

			const updated = await alertConfigService.updateAlertConfig(
				alertType,
				config,
			);

			res.json({
				success: true,
				data: updated,
				message: "Alert configuration updated successfully",
			});
		} catch (error) {
			logger.error("Error updating alert config:", error);
			res.status(500).json({
				success: false,
				error: "Failed to update alert configuration",
				details: error.message,
			});
		}
	},
);

// Preview which alerts would be cleaned up
router.get(
	"/cleanup/preview",
	authenticateToken,
	requireManageSettings,
	async (_req, res) => {
		try {
			const alerts = await alertConfigService.getAlertsToCleanup();

			res.json({
				success: true,
				data: alerts,
				count: alerts.length,
			});
		} catch (error) {
			logger.error("Error previewing cleanup:", error);
			res.status(500).json({
				success: false,
				error: "Failed to preview cleanup",
			});
		}
	},
);

// Trigger manual cleanup of old alerts
router.post(
	"/cleanup",
	authenticateToken,
	requireManageSettings,
	async (_req, res) => {
		try {
			const result = await alertConfigService.cleanupOldAlerts();

			res.json({
				success: true,
				data: result,
				message: `Cleanup completed: ${result.deleted_count} alerts deleted`,
			});
		} catch (error) {
			logger.error("Error triggering cleanup:", error);
			res.status(500).json({
				success: false,
				error: "Failed to trigger cleanup",
				details: error.message,
			});
		}
	},
);

// ============================================================================
// Alert Channel Routes (Discord, Webhook, Teams)
// ============================================================================

// List all channels
router.get(
	"/channels",
	authenticateToken,
	requireManageSettings,
	async (_req, res) => {
		try {
			const channels = await prisma.alert_channels.findMany({
				orderBy: { created_at: "desc" },
			});

			// Mask webhook URLs for security (show first 40 chars)
			const masked = channels.map((ch) => ({
				...ch,
				webhook_url_preview: ch.webhook_url
					? `${ch.webhook_url.substring(0, 40)}…`
					: "",
			}));

			res.json({ success: true, data: masked });
		} catch (error) {
			logger.error("Error fetching alert channels:", error);
			res
				.status(500)
				.json({ success: false, error: "Failed to fetch channels" });
		}
	},
);

// Create channel
router.post(
	"/channels",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const {
				name,
				channel_type,
				webhook_url,
				enabled,
				severity_filter,
				type_filter,
				config,
			} = req.body;

			if (!name || !channel_type || !webhook_url) {
				return res.status(400).json({
					success: false,
					error: "name, channel_type, and webhook_url are required",
				});
			}

			const validTypes = ["discord", "webhook", "teams"];
			if (!validTypes.includes(channel_type)) {
				return res.status(400).json({
					success: false,
					error: `channel_type must be one of: ${validTypes.join(", ")}`,
				});
			}

			const channel = await prisma.alert_channels.create({
				data: {
					id: uuidv4(),
					name,
					channel_type,
					webhook_url,
					enabled: enabled !== false,
					severity_filter: severity_filter || null,
					type_filter: type_filter || null,
					config: config || null,
					created_by: req.user.id,
				},
			});

			logger.info(`✅ Created alert channel: ${channel.id} (${channel_type})`);
			res.json({ success: true, data: channel });
		} catch (error) {
			logger.error("Error creating alert channel:", error);
			res
				.status(500)
				.json({ success: false, error: "Failed to create channel" });
		}
	},
);

// Test channel with unsaved data (no channelId required) — MUST be before /channels/:channelId
router.post(
	"/channels/test",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { channel_type, webhook_url, config } = req.body;

			if (!channel_type || !webhook_url) {
				return res.status(400).json({
					success: false,
					error: "channel_type and webhook_url are required",
				});
			}

			await notificationService.sendTestNotification({
				id: "unsaved",
				name: "Test",
				channel_type,
				webhook_url,
				config: config || null,
			});

			res.json({
				success: true,
				message: "Test notification sent successfully",
			});
		} catch (error) {
			logger.error("Error testing unsaved channel:", error);
			res.status(500).json({
				success: false,
				error: `Test failed: ${error.message}`,
			});
		}
	},
);

// Update channel
router.put(
	"/channels/:channelId",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { channelId } = req.params;
			const {
				name,
				channel_type,
				webhook_url,
				enabled,
				severity_filter,
				type_filter,
				config,
			} = req.body;

			const existing = await prisma.alert_channels.findUnique({
				where: { id: channelId },
			});
			if (!existing) {
				return res
					.status(404)
					.json({ success: false, error: "Channel not found" });
			}

			const channel = await prisma.alert_channels.update({
				where: { id: channelId },
				data: {
					...(name !== undefined && { name }),
					...(channel_type !== undefined && { channel_type }),
					...(webhook_url !== undefined && { webhook_url }),
					...(enabled !== undefined && { enabled }),
					...(severity_filter !== undefined && {
						severity_filter: severity_filter || null,
					}),
					...(type_filter !== undefined && {
						type_filter: type_filter || null,
					}),
					...(config !== undefined && { config: config || null }),
					updated_at: new Date(),
				},
			});

			logger.info(`✅ Updated alert channel: ${channelId}`);
			res.json({ success: true, data: channel });
		} catch (error) {
			logger.error("Error updating alert channel:", error);
			res
				.status(500)
				.json({ success: false, error: "Failed to update channel" });
		}
	},
);

// Delete channel
router.delete(
	"/channels/:channelId",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { channelId } = req.params;

			await prisma.alert_channels.delete({ where: { id: channelId } });

			logger.info(`✅ Deleted alert channel: ${channelId}`);
			res.json({ success: true, message: "Channel deleted" });
		} catch (error) {
			logger.error("Error deleting alert channel:", error);
			res
				.status(500)
				.json({ success: false, error: "Failed to delete channel" });
		}
	},
);

// Test channel — sends a test notification
router.post(
	"/channels/:channelId/test",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { channelId } = req.params;

			const channel = await prisma.alert_channels.findUnique({
				where: { id: channelId },
			});
			if (!channel) {
				return res
					.status(404)
					.json({ success: false, error: "Channel not found" });
			}

			await notificationService.sendTestNotification(channel);

			res.json({
				success: true,
				message: "Test notification sent successfully",
			});
		} catch (error) {
			logger.error("Error testing alert channel:", error);
			res.status(500).json({
				success: false,
				error: `Test failed: ${error.message}`,
			});
		}
	},
);

// Get specific alert details (MUST be after all specific routes)
router.get("/:id", authenticateToken, requireViewReports, async (req, res) => {
	try {
		const { id } = req.params;

		const alert = await alertService
			.getActiveAlerts()
			.then((alerts) => alerts.find((a) => a.id === id));

		if (!alert) {
			return res.status(404).json({
				success: false,
				error: "Alert not found",
			});
		}

		res.json({
			success: true,
			data: alert,
		});
	} catch (error) {
		logger.error("Error fetching alert:", error);
		res.status(500).json({
			success: false,
			error: "Failed to fetch alert",
		});
	}
});

// Get history of actions for a specific alert
router.get(
	"/:id/history",
	authenticateToken,
	requireViewReports,
	async (req, res) => {
		try {
			const { id } = req.params;

			const history = await alertService.getAlertHistory(id);

			res.json({
				success: true,
				data: history,
			});
		} catch (error) {
			logger.error("Error fetching alert history:", error);
			res.status(500).json({
				success: false,
				error: "Failed to fetch alert history",
			});
		}
	},
);

// Perform action on alert
router.post(
	"/:id/action",
	authenticateToken,
	requireViewReports,
	async (req, res) => {
		try {
			const { id } = req.params;
			const { action, metadata, assignedToUserId } = req.body;

			if (!action) {
				return res.status(400).json({
					success: false,
					error: "Action is required",
				});
			}

			// Handle assignment separately if needed
			if (action === "assigned" && assignedToUserId) {
				await alertService.assignAlertToUser(id, assignedToUserId, req.user.id);
			} else {
				await alertService.performAlertAction(
					req.user.id,
					id,
					action,
					metadata,
				);
			}

			res.json({
				success: true,
				message: `Alert ${action} successfully`,
			});
		} catch (error) {
			logger.error("Error performing alert action:", error);
			res.status(500).json({
				success: false,
				error: "Failed to perform alert action",
				details: error.message,
			});
		}
	},
);

// Assign alert to user
router.post(
	"/:id/assign",
	authenticateToken,
	requireViewReports,
	async (req, res) => {
		try {
			const { id } = req.params;
			const { userId } = req.body;

			if (!userId) {
				return res.status(400).json({
					success: false,
					error: "User ID is required",
				});
			}

			await alertService.assignAlertToUser(id, userId, req.user.id);

			res.json({
				success: true,
				message: "Alert assigned successfully",
			});
		} catch (error) {
			logger.error("Error assigning alert:", error);
			res.status(500).json({
				success: false,
				error: "Failed to assign alert",
				details: error.message,
			});
		}
	},
);

// Unassign alert
router.post(
	"/:id/unassign",
	authenticateToken,
	requireViewReports,
	async (req, res) => {
		try {
			const { id } = req.params;

			await alertService.unassignAlert(id, req.user.id);

			res.json({
				success: true,
				message: "Alert unassigned successfully",
			});
		} catch (error) {
			logger.error("Error unassigning alert:", error);
			res.status(500).json({
				success: false,
				error: "Failed to unassign alert",
				details: error.message,
			});
		}
	},
);

// Resolve alert (admin only)
router.put(
	"/:id/resolve",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { id } = req.params;

			await alertService.performAlertAction(req.user.id, id, "resolved", {
				resolved_by: req.user.id,
			});

			res.json({
				success: true,
				message: "Alert resolved successfully",
			});
		} catch (error) {
			logger.error("Error resolving alert:", error);
			res.status(500).json({
				success: false,
				error: "Failed to resolve alert",
				details: error.message,
			});
		}
	},
);

// Delete single alert (admin only)
router.delete(
	"/:id",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { id } = req.params;

			await alertService.deleteAlert(id);

			res.json({
				success: true,
				message: "Alert deleted successfully",
			});
		} catch (error) {
			logger.error("Error deleting alert:", error);
			res.status(500).json({
				success: false,
				error: "Failed to delete alert",
				details: error.message,
			});
		}
	},
);

// Bulk delete alerts (admin only)
router.post(
	"/bulk-delete",
	authenticateToken,
	requireManageSettings,
	async (req, res) => {
		try {
			const { alertIds } = req.body;

			if (!Array.isArray(alertIds) || alertIds.length === 0) {
				return res.status(400).json({
					success: false,
					error: "alertIds must be a non-empty array",
				});
			}

			const result = await alertService.deleteAlerts(alertIds);

			res.json({
				success: true,
				message: `${result.deletedCount} alert(s) deleted successfully`,
				data: result,
			});
		} catch (error) {
			logger.error("Error bulk deleting alerts:", error);
			res.status(500).json({
				success: false,
				error: "Failed to delete alerts",
				details: error.message,
			});
		}
	},
);

module.exports = router;
