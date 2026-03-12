import api from "./api";

export const patchManagementAPI = {
	// Stats / Dashboard
	getStats: () => api.get("/patch-management/stats"),

	// Policies
	listPolicies: (params = {}) =>
		api.get("/patch-management/policies", { params }),
	getPolicy: (id) => api.get(`/patch-management/policies/${id}`),
	createPolicy: (data) => api.post("/patch-management/policies", data),
	updatePolicy: (id, data) => api.put(`/patch-management/policies/${id}`, data),
	deletePolicy: (id) => api.delete(`/patch-management/policies/${id}`),

	// Windows
	listWindows: (params = {}) =>
		api.get("/patch-management/windows", { params }),
	getWindow: (id) => api.get(`/patch-management/windows/${id}`),
	createWindow: (data) => api.post("/patch-management/windows", data),
	updateWindow: (id, data) => api.put(`/patch-management/windows/${id}`, data),
	deleteWindow: (id) => api.delete(`/patch-management/windows/${id}`),

	// Jobs
	listJobs: (params = {}) => api.get("/patch-management/jobs", { params }),
	getActiveJobs: () => api.get("/patch-management/jobs/active"),
	getJob: (id) => api.get(`/patch-management/jobs/${id}`),
	triggerJob: (data) => api.post("/patch-management/jobs/trigger", data),
	cancelJob: (id) => api.post(`/patch-management/jobs/${id}/cancel`),

	// History
	getHistory: (params = {}) => api.get("/patch-management/history", { params }),

	// Per-host results
	getHostPatchResults: (hostId, params = {}) =>
		api.get(`/patch-management/hosts/${hostId}/results`, { params }),

	// Applicable policies for a host (for run-patches multi-select)
	getHostApplicablePolicies: (hostId) =>
		api.get(`/patch-management/hosts/${hostId}/applicable-policies`),

	// Trigger patches for a single host with selected policy IDs
	triggerHostPatches: (hostId, policyIds) =>
		api.post(`/patch-management/hosts/${hostId}/run-patches`, { policyIds }),

	// Diffs
	getJobHostDiff: (jobId, jobHostId) =>
		api.get(`/patch-management/jobs/${jobId}/hosts/${jobHostId}/diff`),
};
