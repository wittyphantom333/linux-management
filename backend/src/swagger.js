const swaggerAutogen = require("swagger-autogen");
const fs = require("node:fs");

const outputFile = "./swagger_output.json";
const endpointsFiles = ["./server.js"];

const doc = {
	info: {
		version: "1.0.0",
		title: "PatchMon REST API",
		description:
			"PatchMon API documentation. For scoped credentials API documentation, see: https://docs.patchmon.net/books/patchmon-application-documentation/page/integration-api-documentation",
	},
	host: process.env.SWAGGER_HOST || "localhost:3000",
	basePath: "/api/v1",
	schemes: ["http", "https"],
	// Global security — applies bearerAuth to all routes by default.
	// Individual routes can override (e.g. agent routes use X-API-ID/X-API-KEY).
	security: [{ bearerAuth: [] }],
	securityDefinitions: {
		basicAuth: {
			type: "basic",
			description:
				"Basic Authentication using API credentials (token_key:token_secret). Used for scoped API endpoints under /api/v1/api/*",
		},
		bearerAuth: {
			type: "apiKey",
			name: "Authorization",
			in: "header",
			description:
				"JWT Bearer token authentication. Format: 'Bearer <token>'. Used for dashboard endpoints.",
		},
	},
	// Tag display order in Swagger UI
	tags: [
		{ name: "Authentication", description: "Login, signup, sessions, admin user management" },
		{ name: "Dashboard", description: "Dashboard stats, host overviews, package trends" },
		{ name: "Hosts", description: "Host registration, management, and integrations" },
		{ name: "Host Groups", description: "Host group CRUD and membership management" },
		{ name: "Packages", description: "Package listing and host-package relationships" },
		{ name: "Repositories", description: "Repository management and stats" },
		{ name: "Config Management - Techniques", description: "Configuration technique CRUD" },
		{ name: "Config Management - Directives", description: "Directive CRUD (parameterised technique instances)" },
		{ name: "Config Management - Rules", description: "Rule CRUD (link directives to host groups)" },
		{ name: "Config Management - Policy", description: "Computed per-host policy generation" },
		{ name: "Config Management - Compliance", description: "Compliance run history and details" },
		{ name: "Config Management - Dashboard", description: "Config management overview and diagnostics" },
		{ name: "Config Management - Agent", description: "Agent-facing config management endpoints" },
		{ name: "Patch Management - Policies", description: "Patch policy CRUD" },
		{ name: "Patch Management - Windows", description: "Maintenance window CRUD" },
		{ name: "Patch Management - Jobs", description: "Patch job management and execution" },
		{ name: "Patch Management - Dashboard", description: "Patch management stats and history" },
		{ name: "Patch Management - Agent", description: "Agent-facing patch management endpoints" },
		{ name: "Compliance Scanning", description: "OpenSCAP compliance scanning and remediation" },
		{ name: "Docker", description: "Docker container, image, volume, and network management" },
		{ name: "Alerts", description: "Alert management, actions, and configuration" },
		{ name: "Agent Updates", description: "Agent version management and push updates" },
		{ name: "Automation", description: "Background job queues, triggers, and monitoring" },
		{ name: "AI Assistant", description: "AI-powered assistance and settings" },
		{ name: "Auto Enrollment", description: "Auto-enrollment tokens and bulk enrollment" },
		{ name: "Permissions", description: "Role and permission management" },
		{ name: "Two-Factor Auth", description: "Two-factor authentication setup and verification" },
		{ name: "User Preferences", description: "User dashboard preferences" },
		{ name: "Metrics", description: "Anonymous usage metrics" },
		{ name: "Version", description: "Application version and update checks" },
		{ name: "Release Notes", description: "Release notes management" },
		{ name: "Search", description: "Global search" },
		{ name: "WebSocket", description: "WebSocket status and streaming endpoints" },
		{ name: "Integrations", description: "Third-party integrations (GetHomepage, Discord, OIDC, etc.)" },
		{ name: "Scoped API - Hosts", description: "Scoped API endpoints for host data (Basic Auth)" },
		{ name: "Agent Logs", description: "Agent log shipping, retrieval, and management" },
		{ name: "System", description: "Health checks, settings, and system-level endpoints" },
	],
};

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
	// Post-process: Fix paths to remove /api/ prefix since basePath is /api/v1
	// swagger-autogen generates paths like /api/auth/... and /api/api/hosts/...
	// With basePath /api/v1, we need to remove /api/ from paths so they become /auth/... and /api/hosts/...
	const path = require("node:path");
	const outputPath = path.join(__dirname, outputFile);
	const swaggerDoc = JSON.parse(fs.readFileSync(outputPath, "utf8"));
	const _apiVersion = process.env.API_VERSION || "v1";

	if (swaggerDoc.paths) {
		const newPaths = {};
		for (const [pathKey, methods] of Object.entries(swaggerDoc.paths)) {
			let correctedPath = pathKey;

			// Remove /api/ prefix from all paths since basePath is /api/v1
			// This handles routes like /api/auth/... -> /auth/... (becomes /api/v1/auth/... with basePath)
			if (pathKey.startsWith("/api/")) {
				correctedPath = pathKey.replace("/api/", "/");
			}

			// Special case: /api/api/hosts should become /api/hosts (becomes /api/v1/api/hosts with basePath)
			if (pathKey.startsWith("/api/api/")) {
				correctedPath = pathKey.replace("/api/api/", "/api/");
			}

			newPaths[correctedPath] = methods;
		}
		swaggerDoc.paths = newPaths;

		// Auto-tag routes that are still in the "default" section
		const prefixTagMap = {
			"auth": "Authentication",
			"dashboard": "Dashboard",
			"hosts": "Hosts",
			"host-groups": "Host Groups",
			"packages": "Packages",
			"repositories": "Repositories",
			"compliance": "Compliance Scanning",
			"docker": "Docker",
			"alerts": "Alerts",
			"agent": "Agent Updates",
			"automation": "Automation",
			"ai": "AI Assistant",
			"auto-enrollment": "Auto Enrollment",
			"permissions": "Permissions",
			"tfa": "Two-Factor Auth",
			"user": "User Preferences",
			"metrics": "Metrics",
			"version": "Version",
			"release-notes": "Release Notes",
			"search": "Search",
			"ws": "WebSocket",
			"integrations": "Integrations",
			"api": "Scoped API - Hosts",
			"gethomepage": "Integrations",
			"buy-me-a-coffee": "Integrations",
			"health": "System",
			"settings": "System",
			"patch-management": "Patch Management - Agent",
			"agent-logs": "Agent Logs",
		};

		for (const [pathKey, methods] of Object.entries(swaggerDoc.paths)) {
			for (const [_method, details] of Object.entries(methods)) {
				if (typeof details !== "object" || !details) continue;
				const tags = details.tags || [];
				// Only auto-tag if untagged or still "default"
				if (tags.length === 0 || (tags.length === 1 && tags[0] === "default")) {
					const prefix = pathKey.replace(/^\//, "").split("/")[0];
					const tag = prefixTagMap[prefix];
					if (tag) {
						details.tags = [tag];
					}
				}
			}
		}

		fs.writeFileSync(outputPath, JSON.stringify(swaggerDoc, null, 2));
		console.log("Fixed API endpoint paths in Swagger documentation");
		console.log("Auto-tagged default routes by path prefix");
	}
});
