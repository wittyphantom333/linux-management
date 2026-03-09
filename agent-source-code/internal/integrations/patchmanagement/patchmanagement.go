// Package patchmanagement implements the patch management integration for the
// PatchMon agent. It fetches pending patch jobs from the server, executes the
// required package updates via the host's native package manager, captures
// before/after package snapshots, and reports per-package results.
package patchmanagement

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"patchmon-agent/internal/client"
	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

const integrationName = "patchmanagement"

// Integration implements the integrations.Integration interface.
type Integration struct {
	logger *logrus.Logger
	client *client.Client
}

// New creates a new patch management integration.
func New(logger *logrus.Logger) *Integration {
	return &Integration{logger: logger}
}

// SetClient injects the HTTP client so we can communicate with the server.
func (i *Integration) SetClient(c *client.Client) {
	i.client = c
}

// Name returns the integration name.
func (i *Integration) Name() string { return integrationName }

// IsAvailable returns true on Linux and FreeBSD (systems with package managers).
func (i *Integration) IsAvailable() bool {
	return runtime.GOOS == "linux" || runtime.GOOS == "freebsd"
}

// Priority determines the run order. Patch management should run after basic
// data collection but has no hard dependency on other integrations.
func (i *Integration) Priority() int { return 50 }

// SupportsRealtime returns false; patching is not a real-time monitored thing.
func (i *Integration) SupportsRealtime() bool { return false }

// Collect checks for pending patch jobs, executes them, and returns the result.
func (i *Integration) Collect(ctx context.Context) (*models.IntegrationData, error) {
	result := &models.IntegrationData{
		Name:        integrationName,
		CollectedAt: time.Now(),
	}

	if i.client == nil {
		result.Error = "no HTTP client configured"
		return result, nil
	}

	// 1. Ask the server if there is a pending job for us
	pending, err := i.client.FetchPendingPatchJob(ctx)
	if err != nil {
		result.Error = fmt.Sprintf("failed to fetch pending patch job: %v", err)
		return result, nil
	}

	if !pending.HasJob || pending.Job == nil {
		i.logger.Debug("No pending patch job")
		result.Data = &models.PatchManagementData{}
		return result, nil
	}

	job := pending.Job
	i.logger.WithFields(logrus.Fields{
		"job_id":     job.JobID,
		"policy":     job.PolicyName,
		"packages":   len(job.Packages),
		"reboot":     job.RebootPolicy,
	}).Info("Starting patch job execution")

	report := &models.PatchReport{
		JobID:     job.JobID,
		JobHostID: job.JobHostID,
		StartedAt: time.Now(),
	}

	// 2. Notify server we're starting (status = downloading)
	_ = i.sendStatus(ctx, job, "downloading")

	// 3. Capture pre-patch snapshot
	if job.PreSnapshot {
		i.logger.Debug("Capturing pre-patch snapshot")
		report.PreSnapshot = captureSnapshot()
	}

	// 4. Execute updates
	_ = i.sendStatus(ctx, job, "installing")

	pkgResults, overallErr := i.executeUpdates(ctx, job)
	report.Results = pkgResults

	// Count successes and failures
	var updated, failed int
	for _, r := range pkgResults {
		switch r.Status {
		case "updated":
			updated++
		case "failed":
			failed++
		}
	}

	// 5. Capture post-patch snapshot
	if job.PostSnapshot {
		i.logger.Debug("Capturing post-patch snapshot")
		report.PostSnapshot = captureSnapshot()
	}

	// 6. Check if reboot is required
	report.RebootRequired = isRebootRequired()

	// 7. Handle reboot policy
	if report.RebootRequired && job.RebootPolicy == "always" {
		_ = i.sendStatus(ctx, job, "rebooting")
		report.RebootDone = true
		// Schedule reboot for 1 minute from now so we have time to send the report
		i.logger.Warn("Scheduling system reboot in 60 seconds per policy")
		scheduleReboot()
	} else if report.RebootRequired && job.RebootPolicy == "if_needed" {
		_ = i.sendStatus(ctx, job, "rebooting")
		report.RebootDone = true
		i.logger.Warn("Scheduling system reboot in 60 seconds (reboot required)")
		scheduleReboot()
	}

	// 8. Determine overall status
	report.CompletedAt = time.Now()
	if overallErr != nil {
		report.Status = "failed"
		report.ErrorMessage = overallErr.Error()
	} else if failed > 0 {
		report.Status = "completed_with_errors"
		report.ErrorMessage = fmt.Sprintf("%d of %d packages failed to update", failed, len(pkgResults))
	} else {
		report.Status = "completed"
	}

	i.logger.WithFields(logrus.Fields{
		"status":  report.Status,
		"updated": updated,
		"failed":  failed,
	}).Info("Patch job execution finished")

	// 9. Send the report
	_, err = i.client.SendPatchReport(ctx, report)
	if err != nil {
		result.Error = fmt.Sprintf("patch job executed but failed to send report: %v", err)
	}

	result.Data = &models.PatchManagementData{Report: report}
	return result, nil
}

// sendStatus sends a status update to the server (best-effort, errors logged).
func (i *Integration) sendStatus(ctx context.Context, job *models.PatchJob, status string) error {
	_, err := i.client.SendPatchStatus(ctx, &models.PatchStatusUpdate{
		JobID:     job.JobID,
		JobHostID: job.JobHostID,
		Status:    status,
	})
	if err != nil {
		i.logger.WithError(err).WithField("status", status).Warn("Failed to send patch status update")
	}
	return err
}

// executeUpdates runs the actual package manager commands and returns per-package results.
func (i *Integration) executeUpdates(ctx context.Context, job *models.PatchJob) ([]models.PatchPackageResult, error) {
	pm := detectPackageManager()
	if pm == "" {
		return nil, fmt.Errorf("no supported package manager found")
	}

	i.logger.WithField("package_manager", pm).Debug("Detected package manager")

	// If the job specifies individual packages, update them one by one.
	// Otherwise, do a full system update.
	if len(job.Packages) > 0 {
		return i.updateSpecificPackages(ctx, pm, job.Packages)
	}
	return i.updateAllPackages(ctx, pm, job.PolicyType)
}

// updateSpecificPackages updates the named packages one at a time for granular reporting.
func (i *Integration) updateSpecificPackages(ctx context.Context, pm string, packages []models.PatchJobPackage) ([]models.PatchPackageResult, error) {
	results := make([]models.PatchPackageResult, 0, len(packages))

	for _, pkg := range packages {
		if ctx.Err() != nil {
			results = append(results, models.PatchPackageResult{
				PackageName:     pkg.PackageName,
				PreviousVersion: pkg.CurrentVersion,
				TargetVersion:   pkg.TargetVersion,
				Status:          "skipped",
				ErrorMessage:    "context cancelled",
			})
			continue
		}

		r := i.updateSinglePackage(pm, pkg)
		results = append(results, r)
	}

	return results, nil
}

// updateSinglePackage updates one package and returns the result.
func (i *Integration) updateSinglePackage(pm string, pkg models.PatchJobPackage) models.PatchPackageResult {
	result := models.PatchPackageResult{
		PackageName:     pkg.PackageName,
		PreviousVersion: pkg.CurrentVersion,
		TargetVersion:   pkg.TargetVersion,
	}

	var cmd *exec.Cmd
	switch pm {
	case "apt-get":
		cmd = exec.Command("apt-get", "install", "-y", "--only-upgrade", pkg.PackageName)
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	case "dnf":
		cmd = exec.Command("dnf", "update", "-y", pkg.PackageName)
	case "yum":
		cmd = exec.Command("yum", "update", "-y", pkg.PackageName)
	case "apk":
		cmd = exec.Command("apk", "upgrade", pkg.PackageName)
	case "pkg":
		cmd = exec.Command("pkg", "upgrade", "-y", pkg.PackageName)
	case "zypper":
		cmd = exec.Command("zypper", "--non-interactive", "update", pkg.PackageName)
	default:
		result.Status = "failed"
		result.ErrorMessage = fmt.Sprintf("unsupported package manager: %s", pm)
		return result
	}

	i.logger.WithFields(logrus.Fields{
		"package": pkg.PackageName,
		"command": cmd.String(),
	}).Debug("Updating package")

	out, err := cmd.CombinedOutput()
	if err != nil {
		result.Status = "failed"
		result.ErrorMessage = truncate(string(out), 500)
		i.logger.WithError(err).WithField("package", pkg.PackageName).Warn("Package update failed")
		return result
	}

	// Check what version is now installed
	installed := getInstalledVersion(pm, pkg.PackageName)
	result.InstalledVersion = installed

	if installed != "" && installed != pkg.CurrentVersion {
		result.Status = "updated"
	} else if installed == pkg.CurrentVersion {
		// Version didn't change — might be held or already at target
		result.Status = "held"
	} else {
		result.Status = "updated"
	}

	return result
}

// updateAllPackages does a full system upgrade and captures results in bulk.
func (i *Integration) updateAllPackages(ctx context.Context, pm string, policyType string) ([]models.PatchPackageResult, error) {
	// First, get the list of upgradable packages so we can report on each
	upgradable := listUpgradablePackages(pm, policyType)

	if len(upgradable) == 0 {
		i.logger.Debug("No upgradable packages found")
		return nil, nil
	}

	i.logger.WithField("count", len(upgradable)).Info("Running full system upgrade")

	// Run the upgrade
	var cmd *exec.Cmd
	switch pm {
	case "apt-get":
		if policyType == "security_only" {
			cmd = exec.Command("apt-get", "upgrade", "-y", "-o", "Dir::Etc::SourceList=/etc/apt/sources.list", "--only-upgrade")
		} else {
			cmd = exec.Command("apt-get", "upgrade", "-y")
		}
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	case "dnf":
		if policyType == "security_only" {
			cmd = exec.Command("dnf", "update", "-y", "--security")
		} else {
			cmd = exec.Command("dnf", "update", "-y")
		}
	case "yum":
		if policyType == "security_only" {
			cmd = exec.Command("yum", "update", "-y", "--security")
		} else {
			cmd = exec.Command("yum", "update", "-y")
		}
	case "apk":
		cmd = exec.Command("apk", "upgrade")
	case "pkg":
		cmd = exec.Command("pkg", "upgrade", "-y")
	case "zypper":
		cmd = exec.Command("zypper", "--non-interactive", "update")
	default:
		return nil, fmt.Errorf("unsupported package manager: %s", pm)
	}

	out, err := cmd.CombinedOutput()

	// Even if the overall command fails, build per-package results
	results := make([]models.PatchPackageResult, 0, len(upgradable))
	for _, u := range upgradable {
		installed := getInstalledVersion(pm, u.Name)
		r := models.PatchPackageResult{
			PackageName:      u.Name,
			PreviousVersion:  u.Version,
			TargetVersion:    u.Version, // best we know
			InstalledVersion: installed,
		}
		if installed != "" && installed != u.Version {
			r.Status = "updated"
		} else if err != nil {
			r.Status = "failed"
			r.ErrorMessage = truncate(string(out), 200)
		} else {
			r.Status = "updated"
		}
		results = append(results, r)
	}

	if err != nil {
		return results, fmt.Errorf("system upgrade command failed: %s", truncate(string(out), 500))
	}

	return results, nil
}

// ============================================================================
// Helper functions
// ============================================================================

// detectPackageManager returns the package manager binary name for this system.
func detectPackageManager() string {
	if runtime.GOOS == "freebsd" {
		return "pkg"
	}

	content, err := os.ReadFile("/etc/os-release")
	if err == nil {
		lower := strings.ToLower(string(content))
		switch {
		case strings.Contains(lower, "id=ubuntu") || strings.Contains(lower, "id=debian") ||
			strings.Contains(lower, "id=linuxmint") || strings.Contains(lower, "id=pop"):
			return "apt-get"
		case strings.Contains(lower, "id=rhel") || strings.Contains(lower, "id=centos") ||
			strings.Contains(lower, "id=rocky") || strings.Contains(lower, "id=alma") ||
			strings.Contains(lower, "id=fedora") || strings.Contains(lower, "id=oracle"):
			if _, err := exec.LookPath("dnf"); err == nil {
				return "dnf"
			}
			return "yum"
		case strings.Contains(lower, "id=sles") || strings.Contains(lower, "id=opensuse"):
			return "zypper"
		case strings.Contains(lower, "id=alpine"):
			return "apk"
		}
	}

	// Fallback detection
	for _, pm := range []string{"apt-get", "dnf", "yum", "zypper", "apk", "pkg"} {
		if _, err := exec.LookPath(pm); err == nil {
			return pm
		}
	}
	return ""
}

// captureSnapshot returns a list of all installed packages with their versions.
func captureSnapshot() []models.PatchSnapshotEntry {
	pm := detectPackageManager()
	var entries []models.PatchSnapshotEntry

	switch pm {
	case "apt-get":
		out, err := exec.Command("dpkg-query", "-W", "-f=${Package}\t${Version}\n").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			parts := strings.SplitN(line, "\t", 2)
			if len(parts) == 2 {
				entries = append(entries, models.PatchSnapshotEntry{Name: parts[0], Version: parts[1]})
			}
		}
	case "dnf", "yum":
		out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			parts := strings.SplitN(line, "\t", 2)
			if len(parts) == 2 {
				entries = append(entries, models.PatchSnapshotEntry{Name: parts[0], Version: parts[1]})
			}
		}
	case "apk":
		out, err := exec.Command("apk", "info", "-v").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			// apk info -v outputs: package-name-version
			lastDash := strings.LastIndex(line, "-")
			if lastDash > 0 {
				entries = append(entries, models.PatchSnapshotEntry{
					Name:    line[:lastDash],
					Version: line[lastDash+1:],
				})
			}
		}
	case "pkg":
		out, err := exec.Command("pkg", "info", "-a", "-q").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			// pkg info outputs: name-version
			lastDash := strings.LastIndex(line, "-")
			if lastDash > 0 {
				entries = append(entries, models.PatchSnapshotEntry{
					Name:    line[:lastDash],
					Version: line[lastDash+1:],
				})
			}
		}
	case "zypper":
		out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			parts := strings.SplitN(line, "\t", 2)
			if len(parts) == 2 {
				entries = append(entries, models.PatchSnapshotEntry{Name: parts[0], Version: parts[1]})
			}
		}
	}

	return entries
}

type upgradablePackage struct {
	Name    string
	Version string
}

// listUpgradablePackages returns packages that can be upgraded.
func listUpgradablePackages(pm string, policyType string) []upgradablePackage {
	var packages []upgradablePackage

	switch pm {
	case "apt-get":
		// Refresh cache first
		_ = exec.Command("apt-get", "update", "-qq").Run()

		out, err := exec.Command("apt", "list", "--upgradable").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(out), "\n") {
			// Format: package/source version arch [upgradable from: old-version]
			if !strings.Contains(line, "[upgradable") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				name := strings.Split(parts[0], "/")[0]
				packages = append(packages, upgradablePackage{Name: name, Version: parts[1]})
			}
		}
	case "dnf":
		args := []string{"check-update", "-q"}
		if policyType == "security_only" {
			args = append(args, "--security")
		}
		out, _ := exec.Command("dnf", args...).Output()
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 && !strings.HasPrefix(line, " ") && fields[0] != "" {
				packages = append(packages, upgradablePackage{Name: fields[0], Version: fields[1]})
			}
		}
	case "yum":
		args := []string{"check-update", "-q"}
		if policyType == "security_only" {
			args = append(args, "--security")
		}
		out, _ := exec.Command("yum", args...).Output()
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 && !strings.HasPrefix(line, " ") && fields[0] != "" {
				packages = append(packages, upgradablePackage{Name: fields[0], Version: fields[1]})
			}
		}
	case "apk":
		_ = exec.Command("apk", "update").Run()
		out, err := exec.Command("apk", "version", "-l", "<").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.Fields(line)
			if len(parts) >= 1 && parts[0] != "Installed:" {
				// Format: name-version < new-version
				lastDash := strings.LastIndex(parts[0], "-")
				if lastDash > 0 {
					packages = append(packages, upgradablePackage{
						Name:    parts[0][:lastDash],
						Version: parts[0][lastDash+1:],
					})
				}
			}
		}
	case "pkg":
		out, err := exec.Command("pkg", "version", "-l", "<").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.Fields(line)
			if len(parts) >= 1 {
				lastDash := strings.LastIndex(parts[0], "-")
				if lastDash > 0 {
					packages = append(packages, upgradablePackage{
						Name:    parts[0][:lastDash],
						Version: parts[0][lastDash+1:],
					})
				}
			}
		}
	case "zypper":
		out, err := exec.Command("zypper", "--non-interactive", "list-updates").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(out), "\n") {
			// Table format: v | repo | Name | Current Version | Available Version | Arch
			if !strings.HasPrefix(line, "v") {
				continue
			}
			cols := strings.Split(line, "|")
			if len(cols) >= 5 {
				name := strings.TrimSpace(cols[2])
				version := strings.TrimSpace(cols[4])
				if name != "" {
					packages = append(packages, upgradablePackage{Name: name, Version: version})
				}
			}
		}
	}

	return packages
}

// getInstalledVersion returns the currently installed version of a package.
func getInstalledVersion(pm, name string) string {
	switch pm {
	case "apt-get":
		out, err := exec.Command("dpkg-query", "-W", "-f=${Version}", name).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	case "dnf", "yum", "zypper":
		out, err := exec.Command("rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", name).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	case "apk":
		out, err := exec.Command("apk", "info", "-v", name).Output()
		if err != nil {
			return ""
		}
		line := strings.TrimSpace(string(out))
		lastDash := strings.LastIndex(line, "-")
		if lastDash > 0 {
			return line[lastDash+1:]
		}
		return line
	case "pkg":
		out, err := exec.Command("pkg", "info", name).Output()
		if err != nil {
			return ""
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "Version") {
				parts := strings.SplitN(line, ":", 2)
				if len(parts) == 2 {
					return strings.TrimSpace(parts[1])
				}
			}
		}
	}
	return ""
}

// isRebootRequired checks whether the system needs a reboot after updates.
func isRebootRequired() bool {
	if runtime.GOOS == "freebsd" {
		return false // FreeBSD doesn't have a standard reboot-required flag
	}

	// Debian/Ubuntu: /var/run/reboot-required
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		return true
	}

	// RHEL/CentOS/Fedora: needs-restarting -r (exit code 1 means reboot needed)
	if _, err := exec.LookPath("needs-restarting"); err == nil {
		cmd := exec.Command("needs-restarting", "-r")
		if err := cmd.Run(); err != nil {
			return true // exit code 1 = reboot needed
		}
	}

	return false
}

// scheduleReboot schedules a system reboot in 60 seconds.
func scheduleReboot() {
	if runtime.GOOS == "freebsd" {
		_ = exec.Command("shutdown", "-r", "+1").Start()
	} else {
		_ = exec.Command("shutdown", "-r", "+1", "PatchMon: scheduled reboot after patching").Start()
	}
}

// truncate shortens a string to at most max bytes.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
