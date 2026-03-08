/**
 * Config Management API
 *
 * Client-side API wrapper for the Rudder-inspired configuration management system.
 */
import api from "./api";

export const configManagementAPI = {
	// ── Dashboard ──────────────────────────────────────────────────────
	getDashboard: () => api.get("/configmanagement/dashboard"),

	// ── Techniques ─────────────────────────────────────────────────────
	listTechniques: (params = {}) =>
		api.get("/configmanagement/techniques", { params }),
	getTechnique: (id) => api.get(`/configmanagement/techniques/${id}`),
	createTechnique: (data) => api.post("/configmanagement/techniques", data),
	updateTechnique: (id, data) =>
		api.put(`/configmanagement/techniques/${id}`, data),
	deleteTechnique: (id) => api.delete(`/configmanagement/techniques/${id}`),

	// ── Directives ─────────────────────────────────────────────────────
	listDirectives: (params = {}) =>
		api.get("/configmanagement/directives", { params }),
	getDirective: (id) => api.get(`/configmanagement/directives/${id}`),
	createDirective: (data) => api.post("/configmanagement/directives", data),
	updateDirective: (id, data) =>
		api.put(`/configmanagement/directives/${id}`, data),
	deleteDirective: (id) => api.delete(`/configmanagement/directives/${id}`),

	// ── Rules ──────────────────────────────────────────────────────────
	listRules: () => api.get("/configmanagement/rules"),
	getRule: (id) => api.get(`/configmanagement/rules/${id}`),
	createRule: (data) => api.post("/configmanagement/rules", data),
	updateRule: (id, data) => api.put(`/configmanagement/rules/${id}`, data),
	deleteRule: (id) => api.delete(`/configmanagement/rules/${id}`),

	// ── Policy ─────────────────────────────────────────────────────────
	getHostPolicy: (hostId) =>
		api.get(`/configmanagement/policy/${hostId}`),

	// ── Compliance runs ────────────────────────────────────────────────
	listRuns: (params = {}) =>
		api.get("/configmanagement/runs", { params }),
	getRun: (id) => api.get(`/configmanagement/runs/${id}`),

	// ── Diagnostics ────────────────────────────────────────────────────
	diagnose: () => api.get("/configmanagement/diagnose"),
	testRun: (hostId) => api.post(`/configmanagement/test-run/${hostId}`),
};
