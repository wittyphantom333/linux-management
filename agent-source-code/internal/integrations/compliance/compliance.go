// Package compliance provides compliance scanning functionality including OpenSCAP, Docker Bench, and Windows CIS checks
package compliance

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"patchmon-agent/internal/utils"
	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

const integrationName = "compliance"

// Integration implements the Integration interface for compliance scanning
type Integration struct {
	logger                   *logrus.Logger
	openscap                 *OpenSCAPScanner
	dockerBench              *DockerBenchScanner
	windowsCIS               *WindowsCISScanner
	dockerIntegrationEnabled bool
}

// New creates a new Compliance integration
func New(logger *logrus.Logger) *Integration {
	return &Integration{
		logger:                   logger,
		openscap:                 NewOpenSCAPScanner(logger),
		dockerBench:              NewDockerBenchScanner(logger),
		windowsCIS:               NewWindowsCISScanner(logger),
		dockerIntegrationEnabled: false,
	}
}

// SetDockerIntegrationEnabled sets whether Docker integration is enabled
// Docker Bench scans will only run if this is true AND Docker is available
func (c *Integration) SetDockerIntegrationEnabled(enabled bool) {
	c.dockerIntegrationEnabled = enabled
}

// Name returns the integration name
func (c *Integration) Name() string {
	return integrationName
}

// Priority returns the collection priority (lower = higher priority)
func (c *Integration) Priority() int {
	return 20 // Lower priority than docker (10) since scans can be slow
}

// SupportsRealtime indicates if this integration supports real-time monitoring
func (c *Integration) SupportsRealtime() bool {
	return false // Compliance scans are not real-time
}

// IsAvailable checks if compliance scanning is available on this system
func (c *Integration) IsAvailable() bool {
	// Available if OpenSCAP, Docker Bench, or Windows CIS scanner is available
	oscapAvail := c.openscap.IsAvailable()
	dockerBenchAvail := c.dockerBench.IsAvailable()
	windowsCISAvail := c.windowsCIS.IsAvailable()

	if oscapAvail {
		c.logger.Debug("OpenSCAP is available for compliance scanning")
	}
	if dockerBenchAvail {
		c.logger.Debug("Docker Bench is available for compliance scanning")
	}
	if windowsCISAvail {
		c.logger.Debug("Windows CIS scanner is available")
	}

	return oscapAvail || dockerBenchAvail || windowsCISAvail
}

// Collect gathers compliance scan data
func (c *Integration) Collect(ctx context.Context) (*models.IntegrationData, error) {
	return c.CollectWithOptions(ctx, nil)
}

// CollectWithOptions gathers compliance scan data with scan options (remediation, etc.)
func (c *Integration) CollectWithOptions(ctx context.Context, options *models.ComplianceScanOptions) (*models.IntegrationData, error) {
	startTime := time.Now()

	c.logger.Info("Starting compliance scan collection...")

	// Docker Bench is only available if Docker integration is enabled AND Docker is installed
	dockerBenchEffectivelyAvailable := c.dockerIntegrationEnabled && c.dockerBench.IsAvailable()

	// Per-host scanner toggles: default to enabled if not specified
	openscapScanEnabled := true
	dockerBenchScanEnabled := true
	windowsCISDisabled := false
	if options != nil && options.ProfileID == "cis-windows" {
		windowsCISDisabled = true // explicitly disable for other scans unless cis-windows profile
	}

	// On Windows, populate OSInfo from Windows if no Linux OS detected
	osInfo := c.openscap.GetOSInfo()
	if osInfo.Name == "" && runtime.GOOS == "windows" {
		osInfo.Name = "Windows"
		osInfo.Family = "windows"
	}

	complianceData := &models.ComplianceData{
		Scans:  make([]models.ComplianceScan, 0),
		OSInfo: osInfo,
		ScannerInfo: models.ComplianceScannerInfo{
			OpenSCAPAvailable:    c.openscap.IsAvailable(),
			OpenSCAPVersion:      c.openscap.GetVersion(),
			DockerBenchAvailable: dockerBenchEffectivelyAvailable,
			AvailableProfiles:    c.openscap.GetAvailableProfiles(),
			WINDOWS_CIS_Rules:    c.windowsCIS.GetRulesCount(),
		},
	}

	// Determine which scans to run based on profile ID
	profileID := ""
	if options != nil && options.ProfileID != "" {
		profileID = options.ProfileID
	}

	// Check if this is a Docker Bench only scan (not OpenSCAP)
	isDockerBenchOnly := profileID == "docker-bench"

	// Run OpenSCAP scan if available, enabled via per-host toggle, and not a Docker Bench only request
	if c.openscap.IsAvailable() && openscapScanEnabled && !isDockerBenchOnly {
		var scan *models.ComplianceScan
		var err error

		if options != nil && options.EnableRemediation {
			c.logger.Info("Running OpenSCAP CIS benchmark scan with remediation enabled...")
			scan, err = c.openscap.RunScanWithOptions(ctx, options)
		} else {
			c.logger.Info("Running OpenSCAP CIS benchmark scan...")
			scanProfileID := "level1_server"
			if profileID != "" {
				scanProfileID = profileID
			}
			scan, err = c.openscap.RunScan(ctx, scanProfileID)
		}

		if err != nil {
			c.logger.WithError(err).Warn("OpenSCAP scan failed")
			// Add failed scan result
			complianceData.Scans = append(complianceData.Scans, models.ComplianceScan{
				ProfileName: "level1_server",
				ProfileType: "openscap",
				Status:      "failed",
				StartedAt:   startTime,
				Error:       err.Error(),
			})
		} else {
			complianceData.Scans = append(complianceData.Scans, *scan)
			logFields := logrus.Fields{
				"profile": scan.ProfileName,
				"score":   fmt.Sprintf("%.1f%%", scan.Score),
				"passed":  scan.Passed,
				"failed":  scan.Failed,
			}
			if scan.RemediationApplied {
				logFields["remediation_count"] = scan.RemediationCount
			}
			c.logger.WithFields(logFields).Info("OpenSCAP scan completed")
		}
	}

	// Run Docker Bench scan if Docker integration is enabled AND Docker is available AND per-host toggle allows it
	// Always run if docker-bench profile is specifically selected, or if running all profiles
	runDockerBench := dockerBenchEffectivelyAvailable && dockerBenchScanEnabled && (isDockerBenchOnly || profileID == "" || profileID == "all")
	if runDockerBench {
		c.logger.Info("Running Docker Bench for Security scan...")
		scan, err := c.dockerBench.RunScan(ctx)
		if err != nil {
			c.logger.WithError(err).Warn("Docker Bench scan failed")
			// Add failed scan result with truncated error message
			errMsg := err.Error()
			if len(errMsg) > 500 {
				errMsg = errMsg[:500] + "... (truncated)"
			}
			now := time.Now()
			complianceData.Scans = append(complianceData.Scans, models.ComplianceScan{
				ProfileName: "Docker Bench for Security",
				ProfileType: "docker-bench",
				Status:      "failed",
				StartedAt:   startTime,
				CompletedAt: &now,
				Error:       errMsg,
			})
		} else {
			complianceData.Scans = append(complianceData.Scans, *scan)
			c.logger.WithFields(logrus.Fields{
				"profile":  scan.ProfileName,
				"score":    fmt.Sprintf("%.1f%%", scan.Score),
				"passed":   scan.Passed,
				"failed":   scan.Failed,
				"warnings": scan.Warnings,
			}).Info("Docker Bench scan completed")
		}
	}

	// Run Windows CIS scanner if available (Windows-only), not disabled, and not a Docker Bench only request
	runWindowsCIS := c.windowsCIS.IsAvailable() && !windowsCISDisabled && !isDockerBenchOnly
	if runWindowsCIS {
		c.logger.Info("Running Windows CIS compliance scan...")
		scan, err := c.windowsCIS.Collect(ctx, options)
		if err != nil {
			c.logger.WithError(err).Warn("Windows CIS scan failed")
			now := time.Now()
			complianceData.Scans = append(complianceData.Scans, models.ComplianceScan{
				ProfileName: "Windows CIS Benchmark",
				ProfileType: "cis-windows",
				Status:      "failed",
				StartedAt:   startTime,
				CompletedAt: &now,
				Error:       err.Error(),
			})
		} else {
			complianceData.Scans = append(complianceData.Scans, *scan)
			c.logger.WithFields(logrus.Fields{
				"profile": scan.ProfileName,
				"score":   fmt.Sprintf("%.1f%%", scan.Score),
				"passed":  scan.Passed,
				"failed":  scan.Failed,
				"rules":   c.windowsCIS.GetRulesCount(),
			}).Info("Windows CIS scan completed")
		}
	}

	executionTime := time.Since(startTime).Seconds()

	return &models.IntegrationData{
		Name:          c.Name(),
		Enabled:       true,
		Data:          complianceData,
		CollectedAt:   utils.GetCurrentTimeUTC(),
		ExecutionTime: executionTime,
	}, nil
}

// UpgradeSSGContent upgrades the SCAP Security Guide content packages
func (c *Integration) UpgradeSSGContent() error {
	if c.openscap == nil {
		return fmt.Errorf("OpenSCAP scanner not initialized")
	}
	return c.openscap.UpgradeSSGContent()
}
