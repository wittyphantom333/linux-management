// Load .env from backend directory so it works regardless of process cwd (e.g. when started from repo root)
require("dotenv").config({
	path: require("node:path").join(__dirname, "..", ".env"),
});

// Global error handlers for unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise);
	console.error("Reason:", reason instanceof Error ? reason.message : reason);
	// Don't exit - let the application continue but log the error
});

process.on("uncaughtException", (error) => {
	console.error("Uncaught Exception:", error.message);
	console.error("Stack:", error.stack);
	// For uncaught exceptions, we should exit after logging
	// Give time for logs to flush
	setTimeout(() => process.exit(1), 1000);
});

// Validate required environment variables on startup
function validateEnvironmentVariables() {
	const requiredVars = {
		JWT_SECRET: "Required for secure authentication token generation",
		DATABASE_URL: "Required for database connection",
	};

	const missing = [];

	// Check required variables
	for (const [varName, description] of Object.entries(requiredVars)) {
		if (!process.env[varName]) {
			missing.push(`${varName}: ${description}`);
		}
	}

	// Fail if required variables are missing
	if (missing.length > 0) {
		console.error("❌ Missing required environment variables:");
		for (const error of missing) {
			console.error(`   - ${error}`);
		}
		console.error("");
		console.error(
			"Please set these environment variables and restart the application.",
		);
		process.exit(1);
	}

	console.log("✅ Environment variable validation passed");
}

// Validate environment variables before importing any modules that depend on them
validateEnvironmentVariables();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const {
	getPrismaClient,
	waitForDatabase,
	disconnectPrisma,
	getTransactionOptions,
} = require("./config/prisma");
const logger = require("./utils/logger");

const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger_output.json");

// Import routes
const authRoutes = require("./routes/authRoutes");
const hostRoutes = require("./routes/hostRoutes");
const hostGroupRoutes = require("./routes/hostGroupRoutes");
const packageRoutes = require("./routes/packageRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const permissionsRoutes = require("./routes/permissionsRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const {
	router: dashboardPreferencesRoutes,
	DEFAULT_CARD_LAYOUT,
	DEFAULT_GRID_LAYOUT,
} = require("./routes/dashboardPreferencesRoutes");
const repositoryRoutes = require("./routes/repositoryRoutes");
const versionRoutes = require("./routes/versionRoutes");
const tfaRoutes = require("./routes/tfaRoutes");
const searchRoutes = require("./routes/searchRoutes");
const autoEnrollmentRoutes = require("./routes/autoEnrollmentRoutes");
const gethomepageRoutes = require("./routes/gethomepageRoutes");
const automationRoutes = require("./routes/automationRoutes");
const dockerRoutes = require("./routes/dockerRoutes");
const integrationRoutes = require("./routes/integrationRoutes");
const wsRoutes = require("./routes/wsRoutes");
const agentVersionRoutes = require("./routes/agentVersionRoutes");
const metricsRoutes = require("./routes/metricsRoutes");
const userPreferencesRoutes = require("./routes/userPreferencesRoutes");
const apiHostsRoutes = require("./routes/apiHostsRoutes");
const releaseNotesRoutes = require("./routes/releaseNotesRoutes");
const releaseNotesAcceptanceRoutes = require("./routes/releaseNotesAcceptanceRoutes");
const buyMeACoffeeRoutes = require("./routes/buyMeACoffeeRoutes");
const oidcRoutes = require("./routes/oidcRoutes");
const discordRoutes = require("./routes/discordRoutes");
const complianceRoutes = require("./routes/complianceRoutes");
const configManagementRoutes = require("./routes/configManagementRoutes");
const patchManagementRoutes = require("./routes/patchManagementRoutes");
const { initializeOIDC } = require("./auth/oidc");
const aiRoutes = require("./routes/aiRoutes");
const alertRoutes = require("./routes/alertRoutes");
const agentLogsRoutes = require("./routes/agentLogsRoutes");
const { initSettings } = require("./services/settingsService");
const { queueManager } = require("./services/automation");
const {
	authenticateToken,
	requireAdmin: _requireAdmin,
} = require("./middleware/auth");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");

// Initialize Prisma client with optimized connection pooling for multiple instances
const prisma = getPrismaClient();

// Use shared logger (configured via ENABLE_LOGGING, LOG_LEVEL, LOG_TO_CONSOLE in .env)
// See backend/src/utils/logger.js

const app = express();
const PORT = process.env.PORT || 3001;
const http = require("node:http");
const server = http.createServer(app);
const {
	init: initAgentWs,
	registerOnAgentConnect,
} = require("./services/agentWs");
const agentVersionService = require("./services/agentVersionService");

// Trust proxy (needed when behind reverse proxy) and remove X-Powered-By
// SECURITY: Only trust proxy when explicitly configured to prevent IP spoofing
if (process.env.TRUST_PROXY) {
	const trustProxyValue = process.env.TRUST_PROXY;

	// Parse the trust proxy setting according to Express documentation
	// IMPORTANT: Avoid using "true" - it's a security risk. Use a number or IP/subnet instead.
	if (trustProxyValue === "true") {
		// Default to trusting private IP ranges (common for Docker/Kubernetes/nginx)
		// This is much safer than "true" which trusts all proxies
		console.warn(
			"⚠️  TRUST_PROXY=true is not recommended. Defaulting to private IP ranges. Set TRUST_PROXY=1 or specific IP/subnet for better security.",
		);
		// Trust common private IP ranges: loopback, Docker, Kubernetes, and RFC1918 private networks
		app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
	} else if (trustProxyValue === "false") {
		app.set("trust proxy", false);
	} else if (/^\d+$/.test(trustProxyValue)) {
		// If it's a number (hop count)
		app.set("trust proxy", parseInt(trustProxyValue, 10));
	} else {
		// If it contains commas, split into array; otherwise use as single value
		// This handles: IP addresses, subnets, named subnets (loopback, linklocal, uniquelocal)
		app.set(
			"trust proxy",
			trustProxyValue.includes(",")
				? trustProxyValue.split(",").map((s) => s.trim())
				: trustProxyValue,
		);
	}
} else {
	// SECURITY: Don't trust proxy by default to prevent IP spoofing via X-Forwarded-For
	// Set TRUST_PROXY environment variable if running behind a reverse proxy
	app.set("trust proxy", false);
	if (process.env.NODE_ENV === "production") {
		console.warn(
			"⚠️  TRUST_PROXY not configured. If behind a reverse proxy, set TRUST_PROXY=1 or appropriate value.",
		);
	}
}
app.disable("x-powered-by");

// Rate limiting with monitoring
const limiter = rateLimit({
	windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
	max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 5000,
	message: {
		error: "Too many requests from this IP, please try again later.",
		retryAfter: Math.ceil(
			(parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000) / 1000,
		),
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: false, // Count all requests for proper rate limiting
	skipFailedRequests: false, // Also count failed requests
	// Disable trust proxy validation - we handle it explicitly above
	validate: { trustProxy: false },
});

// Middleware

// Request ID middleware for log tracing
app.use((req, res, next) => {
	// Use existing request ID from header or generate new one
	req.id =
		req.headers["x-request-id"] ||
		`req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	res.setHeader("X-Request-ID", req.id);
	next();
});

// Security audit logging middleware
const { auditMiddleware } = require("./utils/auditLogger");
app.use(auditMiddleware);

// Helmet with stricter defaults (CSP/HSTS only in production)
app.use(
	helmet({
		contentSecurityPolicy:
			process.env.NODE_ENV === "production"
				? {
						useDefaults: true,
						directives: {
							defaultSrc: ["'self'"],
							scriptSrc: ["'self'"],
							styleSrc: ["'self'", "'unsafe-inline'"],
							imgSrc: ["'self'", "data:"],
							fontSrc: ["'self'", "data:"],
							connectSrc: ["'self'"],
							frameAncestors: ["'none'"],
							objectSrc: ["'none'"],
						},
					}
				: false,
		hsts:
			process.env.ENABLE_HSTS === "true" ||
			process.env.NODE_ENV === "production",
	}),
);

// CORS allowlist from comma-separated env
const parseOrigins = (val) =>
	(val || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
const allowedOrigins = parseOrigins(
	process.env.CORS_ORIGINS ||
		process.env.CORS_ORIGIN ||
		"http://localhost:3000",
);

// Add Bull Board origin to allowed origins if not already present
const bullBoardOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
if (!allowedOrigins.includes(bullBoardOrigin)) {
	allowedOrigins.push(bullBoardOrigin);
}

app.use(
	cors({
		origin: (origin, callback) => {
			// Handle requests without origin header
			if (!origin) {
				// Allow server-to-server requests (agents, curl, etc.)
				// These are legitimate API calls without a browser origin
				// Security note: API endpoints still require authentication
				return callback(null, true);
			}
			if (allowedOrigins.includes(origin)) return callback(null, true);

			// Allow Bull Board requests from the same origin as CORS_ORIGIN
			if (origin === bullBoardOrigin) return callback(null, true);

			// Allow same-origin requests from backend port (localhost/127.0.0.1 only)
			// This safely allows Bull Board to access its own API without allowing arbitrary origins
			try {
				const originUrl = new URL(origin);
				const isLocalhost =
					originUrl.hostname === "localhost" ||
					originUrl.hostname === "127.0.0.1";
				const isBackendPort = originUrl.port === "3001";
				if (isLocalhost && isBackendPort) {
					return callback(null, true);
				}

				// Allow requests from same hostname but different port (frontend on 3000, backend on 3001)
				const corsUrl = new URL(
					process.env.CORS_ORIGIN || "http://localhost:3000",
				);
				if (
					originUrl.hostname === corsUrl.hostname &&
					originUrl.port === "3001"
				) {
					return callback(null, true);
				}
			} catch (_e) {
				// Invalid URL, reject
			}

			return callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
		// Additional CORS options for better cookie handling
		optionsSuccessStatus: 200,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"Content-Type",
			"Authorization",
			"Cookie",
			"X-Requested-With",
			"X-Device-ID", // Allow device ID header for TFA remember-me functionality
		],
	}),
);
app.use(limiter);
// Cookie parser for Bull Board sessions
app.use(cookieParser());
// Reduce body size limits to reasonable defaults
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));
app.use(
	express.urlencoded({
		extended: true,
		limit: process.env.JSON_BODY_LIMIT || "5mb",
	}),
);

// Request logging - only if logging is enabled
// In dev mode, suppress all request logging to reduce terminal noise
// Set PM_LOG_REQUESTS_IN_DEV=true to enable request logging in dev mode
if (process.env.ENABLE_LOGGING === "true") {
	app.use((req, _, next) => {
		const isDev = process.env.NODE_ENV !== "production";
		const logRequestsInDev = process.env.PM_LOG_REQUESTS_IN_DEV === "true";

		// Skip all request logging in dev mode unless explicitly enabled
		if (isDev && !logRequestsInDev) {
			next();
			return;
		}

		// Log requests in production or when explicitly enabled in dev
		logger.info(`${req.method} ${req.path} - ${req.ip}`);
		next();
	});
}

// Health check endpoint
app.get("/health", (_req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve custom branding uploads (logos, favicon) from a dedicated directory
// that survives frontend rebuilds and has correct permissions.
// Served under /api/v1/branding so nginx proxies it through the /api/ location block.
const brandingDir =
	process.env.BRANDING_DIR ||
	process.env.ASSETS_DIR ||
	require("node:path").join(__dirname, "../../branding");
const fsSync = require("node:fs");
fsSync.mkdirSync(brandingDir, { recursive: true });
app.use("/api/v1/branding", express.static(brandingDir, { maxAge: "1h" }));

// API routes
const apiVersion = process.env.API_VERSION || "v1";

// Swagger - Protected with authentication
// Dynamically set Swagger host/scheme from request so it works in any environment
app.use(
	`/api/${apiVersion}/api-docs`,
	authenticateToken,
	swaggerUi.serve,
	(req, res, next) => {
		swaggerDocument.host = req.get("host");
		// Detect real protocol: trust X-Forwarded-Proto when behind a reverse proxy
		const proto = req.get("x-forwarded-proto") || req.protocol;
		swaggerDocument.schemes =
			proto === "https" ? ["https", "http"] : ["http", "https"];
		const handler = swaggerUi.setup(swaggerDocument);
		handler(req, res, next);
	},
);

// Per-route rate limits with monitoring
const authLimiter = rateLimit({
	windowMs:
		parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
	max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 500,
	message: {
		error: "Too many authentication requests, please try again later.",
		retryAfter: Math.ceil(
			(parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000) /
				1000,
		),
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: false, // Count all requests for proper rate limiting
	validate: { trustProxy: false },
});
const agentLimiter = rateLimit({
	windowMs: parseInt(process.env.AGENT_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000,
	max: parseInt(process.env.AGENT_RATE_LIMIT_MAX, 10) || 1000,
	message: {
		error: "Too many agent requests, please try again later.",
		retryAfter: Math.ceil(
			(parseInt(process.env.AGENT_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000) /
				1000,
		),
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: false, // Count all requests for proper rate limiting
	validate: { trustProxy: false },
});

app.use(`/api/${apiVersion}/auth`, authLimiter, authRoutes);
app.use(`/api/${apiVersion}/auth/oidc`, authLimiter, oidcRoutes);
app.use(`/api/${apiVersion}/auth/discord`, authLimiter, discordRoutes);
app.use(`/api/${apiVersion}/hosts`, agentLimiter, hostRoutes);
app.use(`/api/${apiVersion}/host-groups`, hostGroupRoutes);
app.use(`/api/${apiVersion}/packages`, packageRoutes);
app.use(`/api/${apiVersion}/dashboard`, dashboardRoutes);
app.use(`/api/${apiVersion}/permissions`, permissionsRoutes);
app.use(`/api/${apiVersion}/settings`, settingsRoutes);
app.use(`/api/${apiVersion}/dashboard-preferences`, dashboardPreferencesRoutes);
app.use(`/api/${apiVersion}/repositories`, repositoryRoutes);
app.use(`/api/${apiVersion}/version`, versionRoutes);
app.use(`/api/${apiVersion}/tfa`, tfaRoutes);
app.use(`/api/${apiVersion}/search`, searchRoutes);
app.use(
	`/api/${apiVersion}/auto-enrollment`,
	authLimiter,
	autoEnrollmentRoutes,
);
app.use(`/api/${apiVersion}/gethomepage`, gethomepageRoutes);
app.use(`/api/${apiVersion}/automation`, automationRoutes);
app.use(`/api/${apiVersion}/docker`, dockerRoutes);
app.use(`/api/${apiVersion}/integrations`, integrationRoutes);
app.use(`/api/${apiVersion}/ws`, wsRoutes);
app.use(`/api/${apiVersion}/agent`, agentVersionRoutes);
app.use(`/api/${apiVersion}/metrics`, metricsRoutes);
app.use(`/api/${apiVersion}/user/preferences`, userPreferencesRoutes);
app.use(`/api/${apiVersion}/api`, authLimiter, apiHostsRoutes);
app.use(`/api/${apiVersion}/release-notes`, releaseNotesRoutes);
app.use(
	`/api/${apiVersion}/release-notes-acceptance`,
	releaseNotesAcceptanceRoutes,
);
app.use(`/api/${apiVersion}/buy-me-a-coffee`, buyMeACoffeeRoutes);
app.use(`/api/${apiVersion}/compliance`, complianceRoutes);
app.use(`/api/${apiVersion}/configmanagement`, configManagementRoutes);
app.use(`/api/${apiVersion}/patch-management`, patchManagementRoutes);
app.use(`/api/${apiVersion}/ai`, aiRoutes);
app.use(`/api/${apiVersion}/alerts`, alertRoutes);
app.use(`/api/${apiVersion}/agent-logs`, agentLogsRoutes);

// Bull Board - will be populated after queue manager initializes
let bullBoardRouter = null;
const _bullBoardSessions = new Map(); // Store authenticated sessions

// Mount Bull Board at /bullboard for cleaner URL
app.use(`/bullboard`, (_req, res, next) => {
	// Relax COOP/COEP for Bull Board in non-production to avoid browser warnings
	if (process.env.NODE_ENV !== "production") {
		res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
		res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
	}

	// Add headers to help with WebSocket connections
	res.setHeader("X-Frame-Options", "SAMEORIGIN");
	// Tightened CSP: removed blob:, restricted connect-src to same origin only
	// Note: 'unsafe-inline' and 'unsafe-eval' are required for Bull Board's React app
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none';",
	);

	next();
});

// Bull Board authentication using one-time tickets
// SECURITY: Uses tickets instead of tokens in URLs to prevent exposure in server logs
const { consumeBullBoardTicket } = require("./routes/automationRoutes");

app.use(`/bullboard`, async (req, res, next) => {
	// Skip authentication for static assets
	if (req.path.includes("/static/") || req.path.includes("/favicon")) {
		return next();
	}

	// Check for existing Bull Board auth cookie
	if (req.cookies["bull-board-auth"]) {
		// Already authenticated, allow access
		return next();
	}

	// No auth cookie - check for ticket in query (not token!)
	const ticket = req.query.ticket;
	if (!ticket) {
		return res.status(401).json({
			error:
				"Authentication required. Please access Bull Board from the Automation page.",
		});
	}

	// Validate and consume the one-time ticket
	const result = await consumeBullBoardTicket(ticket);
	if (!result.valid) {
		return res.status(401).json({ error: result.reason || "Invalid ticket" });
	}

	// Generate a session identifier for the cookie (not the original ticket)
	const crypto = require("node:crypto");
	const sessionId = crypto.randomBytes(16).toString("hex");

	// Secure cookie only in production and when request is over HTTPS (dev + HTTP Docker work)
	const is_secure_request =
		req.secure || req.get("x-forwarded-proto") === "https";
	const use_secure_cookie =
		process.env.NODE_ENV === "production" && is_secure_request;

	res.cookie("bull-board-auth", sessionId, {
		httpOnly: true,
		secure: use_secure_cookie,
		maxAge: 3600000, // 1 hour
		path: "/bullboard",
		sameSite: "strict",
	});

	return next();
});

// Remove all the old complex middleware below and replace with the new Bull Board router setup
app.use(`/bullboard`, (req, res, next) => {
	if (bullBoardRouter) {
		return bullBoardRouter(req, res, next);
	}
	return res.status(503).json({ error: "Bull Board not initialized yet" });
});

// Error handler specifically for Bull Board routes
app.use("/bullboard", (err, req, res, _next) => {
	console.error("Bull Board error on", req.method, req.url);
	console.error("Error details:", err.message);
	console.error("Stack:", err.stack);
	if (process.env.ENABLE_LOGGING === "true") {
		logger.error(`Bull Board error on ${req.method} ${req.url}:`, err);
	}
	// SECURITY: Don't expose internal error details in production
	res.status(500).json({
		error: "Internal server error",
		...(process.env.NODE_ENV === "development" && {
			message: err.message,
			path: req.path,
			url: req.url,
		}),
	});
});

// Error handling middleware
app.use((err, _req, res, _next) => {
	if (process.env.ENABLE_LOGGING === "true") {
		logger.error(err.stack);
	}

	// SECURITY: Use generic error messages in production to prevent info leakage
	// CORS errors get a specific 403 status but generic message
	if (err.message?.includes("Not allowed by CORS")) {
		return res.status(403).json({
			error: "CORS policy violation",
		});
	}

	// Only expose error details in development
	res.status(500).json({
		error: "Something went wrong!",
		message: process.env.NODE_ENV === "development" ? err.message : undefined,
	});
});

// 404 handler
app.use("*", (_req, res) => {
	res.status(404).json({ error: "Route not found" });
});

// Graceful shutdown
process.on("SIGINT", async () => {
	if (process.env.ENABLE_LOGGING === "true") {
		logger.info("SIGINT received, shutting down gracefully");
	}
	await queueManager.shutdown();
	await disconnectPrisma(prisma);
	process.exit(0);
});

process.on("SIGTERM", async () => {
	if (process.env.ENABLE_LOGGING === "true") {
		logger.info("SIGTERM received, shutting down gracefully");
	}
	await queueManager.shutdown();
	await disconnectPrisma(prisma);
	process.exit(0);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("❌ Unhandled Rejection at:", promise);
	console.error("❌ Reason:", reason);
	if (process.env.ENABLE_LOGGING === "true") {
		logger.error("Unhandled Rejection:", { reason, promise: String(promise) });
	}
	// Don't exit the process - just log the error
	// In production, you might want to track these for debugging
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	console.error("❌ Uncaught Exception:", error);
	if (process.env.ENABLE_LOGGING === "true") {
		logger.error("Uncaught Exception:", error);
	}
	// For uncaught exceptions, it's safer to exit and let process manager restart
	process.exit(1);
});

// Initialize dashboard preferences for all users.
// For users with no preferences, create the curated default layout.
// For users with existing preferences, incrementally add any new cards,
// remove cards the user no longer has permission for, and — on first
// upgrade to 1.4.2+ — seed the dashboard_layout record and apply
// default col_span values while preserving the user's custom order and
// enabled state.
async function initializeDashboardPreferences() {
	try {
		const users = await prisma.users.findMany({
			select: {
				id: true,
				username: true,
				email: true,
				role: true,
				dashboard_preferences: {
					select: {
						id: true,
						card_id: true,
						order: true,
						enabled: true,
						col_span: true,
					},
				},
				dashboard_layout: true,
			},
		});

		if (users.length === 0) {
			return;
		}

		// Build a quick lookup of default col_span values by cardId
		const defaultColSpanMap = new Map(
			DEFAULT_CARD_LAYOUT.map((c) => [c.cardId, c.col_span]),
		);

		let initializedCount = 0;
		let updatedCount = 0;
		const now = new Date();

		for (const user of users) {
			const hasPreferences = user.dashboard_preferences.length > 0;

			const expectedPreferences = await getPermissionBasedPreferences(
				user.role,
			);

			if (!hasPreferences) {
				// ── Brand new user (or wiped) — apply the full curated layout ──
				const preferencesData = expectedPreferences.map((pref) => ({
					id: require("uuid").v4(),
					user_id: user.id,
					card_id: pref.cardId,
					enabled: pref.enabled,
					order: pref.order,
					col_span: pref.col_span,
					created_at: now,
					updated_at: now,
				}));

				await prisma.dashboard_preferences.createMany({
					data: preferencesData,
				});

				// Seed dashboard_layout if it doesn't exist yet
				if (!user.dashboard_layout) {
					await prisma.dashboard_layout.create({
						data: {
							user_id: user.id,
							stats_columns: DEFAULT_GRID_LAYOUT.stats_columns,
							charts_columns: DEFAULT_GRID_LAYOUT.charts_columns,
							updated_at: now,
						},
					});
				}

				initializedCount++;
			} else {
				// ── Existing user — incremental sync ─────────────────────────
				const existingCardIds = new Set(
					user.dashboard_preferences.map((p) => p.card_id),
				);
				const expectedCardIds = new Set(
					expectedPreferences.map((p) => p.cardId),
				);

				const cardsToAdd = expectedPreferences.filter(
					(p) => !existingCardIds.has(p.cardId),
				);

				const cardIdsToRemove = user.dashboard_preferences
					.filter((p) => !expectedCardIds.has(p.card_id))
					.map((p) => p.id);

				// Detect pre-1.4.2 users who need the upgrade defaults applied:
				// they won't have a dashboard_layout record yet.
				const needsUpgradeDefaults = !user.dashboard_layout;

				// Cards that need their col_span updated to the curated default
				// (only touch cards still at the migration default of 1 where the
				// curated default differs, so we don't overwrite manual tweaks)
				const colSpanUpdates = needsUpgradeDefaults
					? user.dashboard_preferences.filter((p) => {
							const target = defaultColSpanMap.get(p.card_id);
							return target && target !== 1 && (p.col_span ?? 1) === 1;
						})
					: [];

				const hasChanges =
					cardsToAdd.length > 0 ||
					cardIdsToRemove.length > 0 ||
					needsUpgradeDefaults;

				if (!hasChanges) {
					continue;
				}

				await prisma.$transaction(async (tx) => {
					if (cardIdsToRemove.length > 0) {
						await tx.dashboard_preferences.deleteMany({
							where: { id: { in: cardIdsToRemove } },
						});
					}

					if (cardsToAdd.length > 0) {
						const maxOrder = Math.max(
							...user.dashboard_preferences.map((p) => p.order),
							-1,
						);

						const newPreferencesData = cardsToAdd.map((pref, idx) => ({
							id: require("uuid").v4(),
							user_id: user.id,
							card_id: pref.cardId,
							enabled: pref.enabled,
							order: maxOrder + 1 + idx,
							col_span: pref.col_span,
							created_at: now,
							updated_at: now,
						}));

						await tx.dashboard_preferences.createMany({
							data: newPreferencesData,
						});
					}

					// Apply curated col_span values for upgrading users
					for (const pref of colSpanUpdates) {
						const target = defaultColSpanMap.get(pref.card_id);
						await tx.dashboard_preferences.update({
							where: { id: pref.id },
							data: { col_span: target, updated_at: now },
						});
					}

					// Seed the dashboard_layout record for upgrading users
					if (needsUpgradeDefaults) {
						await tx.dashboard_layout.create({
							data: {
								user_id: user.id,
								stats_columns: DEFAULT_GRID_LAYOUT.stats_columns,
								charts_columns: DEFAULT_GRID_LAYOUT.charts_columns,
								updated_at: now,
							},
						});
					}
				}, getTransactionOptions());

				updatedCount++;
			}
		}

		if (initializedCount > 0 || updatedCount > 0) {
			console.log(
				`✅ Dashboard preferences: ${initializedCount} initialized, ${updatedCount} updated`,
			);
		}
	} catch (error) {
		console.error("❌ Error initializing dashboard preferences:", error);
		throw error;
	}
}

// Helper function to get user permissions based on role
async function getUserPermissions(userRole) {
	try {
		const permissions = await prisma.role_permissions.findUnique({
			where: { role: userRole },
		});

		// If no specific permissions found, return default admin permissions (for backward compatibility)
		if (!permissions) {
			console.warn(
				`No permissions found for role: ${userRole}, defaulting to admin access`,
			);
			return {
				can_view_dashboard: true,
				can_view_hosts: true,
				can_manage_hosts: true,
				can_view_packages: true,
				can_manage_packages: true,
				can_view_users: true,
				can_manage_users: true,
				can_view_reports: true,
				can_export_data: true,
				can_manage_settings: true,
			};
		}

		return permissions;
	} catch (error) {
		console.error("Error fetching user permissions:", error);
		// Return admin permissions as fallback
		return {
			can_view_dashboard: true,
			can_view_hosts: true,
			can_manage_hosts: true,
			can_view_packages: true,
			can_manage_packages: true,
			can_view_users: true,
			can_manage_users: true,
			can_view_reports: true,
			can_export_data: true,
			can_manage_settings: true,
		};
	}
}

// Helper function to get permission-based dashboard preferences for a role.
// Uses the shared DEFAULT_CARD_LAYOUT from dashboardPreferencesRoutes.js as the
// single source of truth for card definitions, order, enabled state, and col_span.
async function getPermissionBasedPreferences(userRole) {
	const permissions = await getUserPermissions(userRole);

	const allowedCards = DEFAULT_CARD_LAYOUT.filter((card) => {
		return permissions[card.requiredPermission] === true;
	});

	return allowedCards.map((card) => ({
		cardId: card.cardId,
		enabled: card.enabled,
		order: card.order,
		col_span: card.col_span,
	}));
}

// Start server with database health check
async function startServer() {
	try {
		// Wait for database to be available
		await waitForDatabase(prisma);

		if (process.env.ENABLE_LOGGING === "true") {
			logger.info("✅ Database connection successful");
		}

		// Initialise settings on startup
		try {
			await initSettings();
			if (process.env.ENABLE_LOGGING === "true") {
				logger.info("✅ Settings initialised");
			}
		} catch (initError) {
			if (process.env.ENABLE_LOGGING === "true") {
				logger.error("❌ Failed to initialise settings:", initError.message);
			}
			throw initError; // Fail startup if settings can't be initialised
		}

		// Auto-enable Config Management on all existing hosts that still have it disabled
		// This is a one-time migration: CM should be enabled by default for all hosts
		try {
			const updated = await prisma.hosts.updateMany({
				where: { configmanagement_enabled: false },
				data: { configmanagement_enabled: true },
			});
			if (updated.count > 0) {
				logger.info(
					`✅ Config Management auto-enabled on ${updated.count} existing host(s)`,
				);
			}
		} catch (cmErr) {
			logger.warn(
				"⚠️ Failed to auto-enable Config Management on hosts:",
				cmErr.message,
			);
		}

		// Initialize OIDC if enabled
		if (process.env.OIDC_ENABLED === "true") {
			const oidcInitialized = await initializeOIDC();
			if (oidcInitialized) {
				console.log("OIDC authentication enabled and initialized");
			} else {
				console.warn(
					"OIDC is enabled but failed to initialize - check configuration",
				);
			}
		}

		// Initialize dashboard preferences for all users
		await initializeDashboardPreferences();

		// Initialize BullMQ queue manager
		await queueManager.initialize();

		// Schedule recurring jobs
		await queueManager.scheduleAllJobs();

		// Set up Bull Board for queue monitoring
		const serverAdapter = new ExpressAdapter();
		// Set basePath to match where we mount the router
		serverAdapter.setBasePath("/bullboard");

		const { QUEUE_NAMES } = require("./services/automation");
		const bullAdapters = Object.values(QUEUE_NAMES).map(
			(queueName) => new BullMQAdapter(queueManager.queues[queueName]),
		);

		createBullBoard({
			queues: bullAdapters,
			serverAdapter: serverAdapter,
		});

		// Set the router for the Bull Board middleware (secured middleware above)
		bullBoardRouter = serverAdapter.getRouter();
		console.log("✅ Bull Board mounted at /bullboard (secured)");

		// Initialize WS layer with the underlying HTTP server
		initAgentWs(server, prisma);
		// When an agent connects, expedite any queued compliance scan for that host (max 1 per host)
		registerOnAgentConnect(async (apiId) => {
			try {
				const host = await prisma.hosts.findUnique({
					where: { api_id: apiId },
					select: { id: true },
				});
				if (!host) return;
				const queue = queueManager.queues[QUEUE_NAMES.COMPLIANCE];
				const jobId = `compliance-scan-${host.id}`;
				const job = await queue.getJob(jobId);
				if (!job) return;
				const state = await job.getState();
				if (state === "delayed" || state === "waiting") {
					await job.moveToDelayed(Date.now());
				}
			} catch (err) {
				logger.error(
					"[agent-ws] Error expediting queued compliance scan:",
					err,
				);
			}
		});
		await agentVersionService.initialize();

		// Send metrics on startup (silent - no console output)
		try {
			const metricsReporting =
				queueManager.automations[QUEUE_NAMES.METRICS_REPORTING];
			await metricsReporting.sendSilent();
		} catch (_error) {
			// Silent failure - don't block server startup if metrics fail
		}

		// Start patch management window scheduler (check every 60 seconds)
		try {
			const {
				refreshWindowSchedules,
				createPatchJob,
			} = require("./services/patchManagementService");
			const startPatchWindowScheduler = () => {
				let running = false;
				let tickCount = 0;
				const tick = async () => {
					if (running) return; // prevent overlap if previous tick is still going
					running = true;
					tickCount++;
					try {
						const { getPrismaClient } = require("./config/prisma");
						const pdb = getPrismaClient();

						// Log every 5th tick (5 min) so we can verify the scheduler is alive
						const verbose = tickCount % 5 === 1;

						// Count all enabled windows for diagnostic purposes
						const allWindows = await pdb.patch_windows.findMany({
							where: { enabled: true },
							select: {
								id: true,
								name: true,
								schedule_cron: true,
								schedule_type: true,
								next_run_at: true,
								last_run_at: true,
							},
						});

						if (verbose) {
							for (const w of allWindows) {
								logger.info(
									`[PatchMgmt] Window "${w.name}": type=${w.schedule_type} cron=${w.schedule_cron} next_run_at=${w.next_run_at ? w.next_run_at.toISOString() : "null"} last_run_at=${w.last_run_at ? w.last_run_at.toISOString() : "null"}`,
								);
							}
						}

						// Find windows that are due to run BEFORE refreshing schedules,
						// otherwise refreshWindowSchedules() advances next_run_at and
						// the due windows are never found.
						const now = new Date();
						const dueWindows = allWindows.filter(
							(w) => w.next_run_at && w.next_run_at <= now,
						);

						if (dueWindows.length > 0) {
							logger.info(
								`[PatchMgmt] Scheduler tick: ${dueWindows.length} due window(s) found`,
							);
						}

						for (const window of dueWindows) {
							let jobCreated = false;
							try {
								const result = await createPatchJob(window.policy_id, {
									triggeredBy: "scheduled",
									windowId: window.id,
								});
								jobCreated = true;
								logger.info(
									`[PatchMgmt] Auto-triggered job for policy ${window.policy_id} via window "${window.name}"`,
								);
								// Notify affected agents to pick up the job immediately
								if (result.hostIds && result.hostIds.length > 0) {
									const {
										pushReportNow,
										isConnected,
									} = require("./services/agentWs");
									const pdb2 = getPrismaClient();
									const hosts = await pdb2.hosts.findMany({
										where: { id: { in: result.hostIds } },
										select: { api_id: true },
									});
									for (const host of hosts) {
										if (isConnected(host.api_id)) {
											pushReportNow(host.api_id);
										}
									}
								}
							} catch (err) {
								logger.warn(
									`[PatchMgmt] Window "${window.name}" (policy ${window.policy_id}) — no job created: ${err.message}`,
								);
							}

							// Always advance next_run_at so the window moves to its
							// next scheduled occurrence.  If createPatchJob failed
							// because there was nothing to patch (no matching
							// packages, policy disabled, etc.) the schedule should
							// still tick forward; leaving it in the past causes an
							// infinite retry loop that blocks the window permanently.
							try {
								const {
									computeNextRun,
								} = require("./services/patchManagementService");
								const nextRun =
									window.schedule_type === "recurring"
										? computeNextRun(
												window.schedule_cron,
												window.schedule_timezone,
											)
										: null;

								await pdb.patch_windows.update({
									where: { id: window.id },
									data: {
										next_run_at: nextRun,
										last_run_at: new Date(),
										enabled: nextRun ? true : window.schedule_type !== "once",
										updated_at: new Date(),
									},
								});

								if (jobCreated) {
									logger.info(
										`[PatchMgmt] Window "${window.name}" schedule advanced to ${nextRun ? nextRun.toISOString() : "null (one-time)"}`,
									);
								}
							} catch (advErr) {
								logger.error(
									`[PatchMgmt] Failed to advance schedule for window "${window.name}": ${advErr.message}`,
								);
							}
						}

						// Refresh next_run_at for remaining recurring windows
						// (must run AFTER due-window processing)
						await refreshWindowSchedules();
					} catch (err) {
						logger.error(`[PatchMgmt] Window scheduler error: ${err.message}`);
					} finally {
						running = false;
					}
				};
				// Run immediately on startup, then every 60 seconds
				setTimeout(tick, 0);
				setInterval(tick, 60 * 1000);
			};
			startPatchWindowScheduler();
			console.log(
				"✅ Patch management window scheduler started (60s interval)",
			);
		} catch (err) {
			logger.error(
				`[PatchMgmt] Failed to start window scheduler: ${err.message}`,
			);
		}

		server.listen(PORT, () => {
			if (process.env.ENABLE_LOGGING === "true") {
				logger.info(`Server running on port ${PORT}`);
				logger.info(`Environment: ${process.env.NODE_ENV}`);
			}
		});

		// Purge old agent logs on startup and then every 6 hours
		try {
			const { purgeOldLogs } = require("./routes/agentLogsRoutes");
			const retentionDays =
				Number.parseInt(process.env.AGENT_LOG_RETENTION_DAYS, 10) || 7;
			await purgeOldLogs(retentionDays);
			setInterval(() => purgeOldLogs(retentionDays), 6 * 60 * 60 * 1000);
			console.log(`✅ Agent log cleanup active (${retentionDays}d retention)`);
		} catch (err) {
			logger.error(`[AgentLogs] Failed to start log cleanup: ${err.message}`);
		}
	} catch (error) {
		console.error("❌ Failed to start server:", error.message);
		process.exit(1);
	}
}

startServer();

module.exports = app;
