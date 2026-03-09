package models

import "time"

// ============================================================================
// Patch Management models – agent↔server communication
// ============================================================================

// PatchPendingResponse is what the server returns to GET /patch-management/agent/pending
type PatchPendingResponse struct {
	HasJob  bool     `json:"has_job"`
	Job     *PatchJob `json:"job,omitempty"`
	Message string   `json:"message,omitempty"`
}

// PatchJob describes a pending patch job for this host.
type PatchJob struct {
	JobID        string            `json:"job_id"`
	JobHostID    string            `json:"job_host_id"`
	PolicyName   string            `json:"policy_name"`
	PolicyType   string            `json:"policy_type"`   // all, security_only, selected
	RebootPolicy string            `json:"reboot_policy"` // never, if_needed, always
	PreSnapshot  bool              `json:"pre_snapshot"`
	PostSnapshot bool              `json:"post_snapshot"`
	Packages     []PatchJobPackage `json:"packages"` // specific packages to update
}

// PatchJobPackage is a single package the server expects to be updated.
type PatchJobPackage struct {
	PackageName    string `json:"package_name"`
	TargetVersion  string `json:"target_version"`
	CurrentVersion string `json:"current_version"`
}

// PatchReport is what the agent POSTs to /patch-management/agent/report
type PatchReport struct {
	Hostname       string                `json:"hostname"`
	MachineID      string                `json:"machine_id"`
	JobID          string                `json:"job_id"`
	JobHostID      string                `json:"job_host_id"`
	Status         string                `json:"status"` // completed, failed
	PreSnapshot    []PatchSnapshotEntry  `json:"pre_snapshot,omitempty"`
	PostSnapshot   []PatchSnapshotEntry  `json:"post_snapshot,omitempty"`
	Results        []PatchPackageResult  `json:"results"`
	RebootRequired bool                  `json:"reboot_required"`
	RebootDone     bool                  `json:"reboot_done"`
	ErrorMessage   string                `json:"error_message,omitempty"`
	StartedAt      time.Time             `json:"started_at"`
	CompletedAt    time.Time             `json:"completed_at"`
}

// PatchSnapshotEntry is a single installed-package record for the snapshot.
type PatchSnapshotEntry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// PatchPackageResult is the outcome for a single package.
type PatchPackageResult struct {
	PackageName      string `json:"package_name"`
	PreviousVersion  string `json:"previous_version"`
	TargetVersion    string `json:"target_version"`
	InstalledVersion string `json:"installed_version"`
	Status           string `json:"status"` // updated, failed, skipped, held
	ErrorMessage     string `json:"error_message,omitempty"`
}

// PatchReportResponse is the server's response to the report.
type PatchReportResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// PatchStatusUpdate is sent to /patch-management/agent/status during execution.
type PatchStatusUpdate struct {
	Hostname  string `json:"hostname"`
	MachineID string `json:"machine_id"`
	JobID     string `json:"job_id"`
	JobHostID string `json:"job_host_id"`
	Status    string `json:"status"` // downloading, installing, rebooting
}

// PatchStatusResponse is the server's response to a status update.
type PatchStatusResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// PatchManagementData wraps everything the integration collects.
type PatchManagementData struct {
	Report *PatchReport `json:"report,omitempty"`
}
