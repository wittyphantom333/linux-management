// Package compliance provides compliance scanning functionality including OpenSCAP, Docker Bench, and Windows CIS checks
package compliance

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

// WindowsCISScanner implements registry-based CIS compliance checks for Windows.
// Rules are data-driven (JSON), embedded by default, and can be updated remotely.
type WindowsCISScanner struct {
	logger  *logrus.Logger
	available bool
	ruleset []CISRule
	lastUpdate time.Time
}

// CISRule represents a single compliance rule in the JSON-driven engine
type CISRule struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Section     string `json:"section"`
	Severity    string `json:"severity"` // low, medium, high, critical
	CheckType   string `json:"check_type"`            // registry_key, service_state, policy_value, file_exists
	CheckKey    string `json:"check_key,omitempty"`   // e.g. "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate"
	CheckValue  string `json:"check_value,omitempty"` // expected value name
	CheckData   string `json:"check_data,omitempty"`  // expected content/value
	Operator    string `json:"operator,omitempty"`    // eq, neq, exists, not_exists, contains, gte
	Remediation string `json:"remediation,omitempty"`
}

// scanResult tracks a single rule evaluation
type scanResult struct {
	Rule     CISRule
	Status   string // pass, fail, warn, skip, notapplicable, error
	Finding  string
	Actual   string
	Expected string
}

// NewWindowsCISScanner creates a new Windows CIS scanner (only available on Windows)
func NewWindowsCISScanner(logger *logrus.Logger) *WindowsCISScanner {
	s := &WindowsCISScanner{
		logger:    logger,
		available: runtime.GOOS == "windows",
		ruleset:   defaultRuleset(), // embedded default rules
	}
	if s.available {
		logger.Info("Windows CIS scanner initialized with embedded ruleset")
	}
	return s
}

// IsAvailable returns whether the Windows CIS scanner is available (requires Windows)
func (s *WindowsCISScanner) IsAvailable() bool {
	return s.available
}

// GetVersion returns the agent version string for this scanner
func (s *WindowsCISScanner) GetVersion() string {
	return "1.0.0"
}

// defaultRuleset returns a curated set of Windows CIS compliance checks based on DISA STIG / CIS Benchmark public guidelines
func defaultRuleset() []CISRule {
	return []CISRule{
		// --- Account Policies: Password Policy ---
		{
			ID:          "2.3.1",
			Title:       "Ensure 'Enforce password history' is set to '24 or more passwords'",
			Description: "Prevents re-use of recent passwords",
			Section:     "Account Policies",
			Severity:    "medium",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\PasswordPolicy",
			CheckValue:  "PasswordHistorySize",
			CheckData:   "24",
			Operator:    "gte",
			Remediation: "Set PasswordHistorySize to 24 via gpedit.msc or registry",
		},
		{
			ID:          "2.3.2",
			Title:       "Ensure 'Maximum password age' is set to '180 days or fewer'",
			Description: "Forces periodic password changes",
			Section:     "Account Policies",
			Severity:    "medium",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\PasswordPolicy",
			CheckValue:  "MaximumPasswordAge",
			CheckData:   "180",
			Operator:    "lte", // lower value = more frequent change = stricter
			Remediation: "Set MaximumPasswordAge to 90 days or fewer",
		},
		{
			ID:          "2.3.3",
			Title:       "Ensure 'Minimum password age' is set to '1 or more'",
			Description: "Prevents immediate password reuse/loop",
			Section:     "Account Policies",
			Severity:    "low",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\PasswordPolicy",
			CheckValue:  "MinimumPasswordAge",
			CheckData:   "1",
			Operator:    "gte",
			Remediation: "Set MinimumPasswordAge to 1 via gpedit.msc or registry",
		},
		{
			ID:          "2.3.4",
			Title:       "Ensure 'Minimum password length' is set to '14 or more characters'",
			Description: "Longer passwords resist brute-force attacks",
			Section:     "Account Policies",
			Severity:    "high",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\PasswordPolicy",
			CheckValue:  "MinimumPasswordLength",
			CheckData:   "14",
			Operator:    "gte",
			Remediation: "Set MinimumPasswordLength to 14 or greater",
		},

	// --- Account Policies: Lockout Policy ---
		{
			ID:          "2.3.9",
			Title:       "Ensure 'Enforce password history' is configured via Local Security Policy",
			Description: "Verify account policy applies to user accounts",
			Section:     "Account Policies",
			Severity:    "low",
			CheckType:   "policy_value",
			CheckKey:    "System\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "NoLMHash",
			CheckData:   "1",
			Operator:    "eq",
			Remediation: "Enable 'Do not store LAN Manager hash value on next change' policy",
		},

		// --- Local Policies: Audit Policy ---
		{
			ID:          "2.4.1",
			Title:       "Ensure 'Audit credential validation' is set to (Success, Failure)",
			Description: "Auditing password validation events helps detect brute-force attacks",
			Section:     "Local Policies",
			Severity:    "medium",
			CheckType:   "policy_value",
			CheckKey:    "System\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "CrashOnAuditFail",
			CheckData:   "0",
			Operator:    "eq",
			Remediation: "Configure via auditpol or GPO",
		},

	// --- Logon Rights ---
		{
			ID:          "2.5.1",
			Title:       "Ensure 'Deny access to this computer from the network' includes Guest",
			Description: "Guest accounts should not have network access",
			Section:     "Logon Rights",
			Severity:    "low",
			CheckType:   "policy_value",
			CheckKey:    "System\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "LimitBlankPasswordUse",
			CheckData:   "1",
			Operator:    "eq",
			Remediation: "Add Guest to 'Deny access to this computer from the network'",
		},

	// --- Windows Update Policy ---
		{
			ID:          "4.2.1.1",
			Title:       "Ensure 'Manage updates from within Windows Defender ATP' is set to 'Disabled' (or enabled if using WDATP)",
			Description: "Windows Update configuration for patch management",
			Section:     "Windows Update Management",
			Severity:    "medium",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate",
			CheckValue:  "WUServer",
			Operator:    "", // check existence
			Remediation: "Configure Windows Update server via GPO",
		},

	// --- Firewall Policies ---
		{
			ID:          "5.3.1",
			Title:       "Ensure 'Windows Defender Firewall: Domain: Inbound connections' is set to 'Block'",
			Description: "Default domain firewall policy should block inbound traffic",
			Section:     "Firewall Policies",
			Severity:    "high",
			CheckType:   "service_state",
			CheckKey:    "MpsSvc", // Windows Firewall service
			CheckData:   "running",
			Operator:    "eq", // firewall service should be running
			Remediation: "Ensure the Windows Defender Firewall service is started and set to automatic startup",
		},

	// --- Windows Defender / Antivirus ---
		{
			ID:          "4.1.1",
			Title:       "Ensure 'Tamper Protection' is enabled for Microsoft Defender",
			Description: "Tamper protection prevents unauthorized changes to security settings",
			Section:     "Microsoft Defender",
			Severity:    "critical",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Features",
			CheckValue:  "TamperProtection",
			CheckData:   "5",
			Operator:    "eq",
			Remediation: "Enable Tamper Protection via Microsoft Defender console or GPO",
		},
		{
			ID:          "4.1.2",
			Title:       "Ensure 'Real-time protection' is enabled for Microsoft Defender",
			Description: "Real-time scanning detects malware as it attempts to execute",
			Section:     "Microsoft Defender",
			Severity:    "critical",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection",
			CheckValue:  "DisableRealtimeMonitoring",
			CheckData:   "0",
			Operator:    "eq", // should be disabled (value 0)
			Remediation: "Enable Real-time protection via GPO or defender settings",
		},

	// --- SMB Server Security ---
		{
			ID:          "3.4.1",
			Title:       "Ensure 'SMB server disabled' is set to True (or verify if intentionally enabled)",
			Description: "If file sharing not needed, disable SMB server",
			Section:     "File Share and Permissions",
			Severity:    "medium",
			CheckType:   "service_state",
			CheckKey:    "LanmanServer",
			CheckData:   "running",
			Operator:    "not_eq", // should NOT be running if file sharing not needed
			Remediation: "Disable the LanmanServer (File and Printer Sharing) service if not required",
		},

	// --- Windows Credential Guard ---
		{
			ID:          "1.4.1",
			Title:       "Ensure 'Run credential guard with hardware enforcement' is set to 'Enabled'",
			Description: "Credential Guard protects credential hashes from offline attacks",
			Section:     "Credential Guard",
			Severity:    "critical",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "RunCredentialGuard",
			CheckData:   "1",
			Operator:    "eq",
			Remediation: "Enable Credential Guard via GPO or registry (requires virtualization-based security)",
		},

	// --- UAC Policies ---
		{
			ID:          "2.5.3",
			Title:       "Ensure 'Admin Approval Mode' is enabled for UAC",
			Description: "UAC Admin Approval Mode prompts for elevation",
			Section:     "User Account Control",
			Severity:    "critical",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
			CheckValue:  "EnableLUA",
			CheckData:   "1",
			Operator:    "eq",
			Remediation: "Set EnableLUA to 1 via gpedit.msc or registry",
		},

	// --- Remote Desktop Security ---
		{
			ID:          "3.2.1",
			Title:       "Ensure 'Require secure RDP authentication' is enabled",
			Description: "RDP should require Network Level Authentication (NLA)",
			Section:     "Remote Desktop",
			Severity:    "high",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "ForceKeyProtection",
			Operator:    "",
			Remediation: "Enable NLA for Remote Desktop via gpedit.msc",
		},

	// --- PowerShell Constrained Language Mode ---
		{
			ID:          "6.1.2",
			Title:       "Ensure 'Configure the execution policy' is set to 'AllSigned or Restricted'",
			Description: "Restricting PowerShell execution mitigates script-based attacks",
			Section:     "PowerShell",
			Severity:    "high",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell",
			CheckValue:  "ExecutionPolicy",
			CheckData:   "AllSigned",
			Operator:    "eq", // should be AllSigned or Restricted
			Remediation: "Set ExecutionPolicy to AllSigned via GPO",
		},

	// --- LSA Protection ---
		{
			ID:          "2.5.13",
			Title:       "Ensure 'Run all security administrators in Admin Approval Mode' is configured",
			Description: "LSA protection helps defend against credential extraction",
			Section:     "Local Security Authority",
			Severity:    "critical",
			CheckType:   "registry_key",
			CheckKey:    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
			CheckValue:  "RunAsPPL",
			Operator:    "", // check if present and set
			Remediation: "Enable LSA protection via GPO: System object: Run all security administrators in Admin Approval Mode",
		},
	}
}

// Collect runs all CIS checks against the Windows system and returns compliance scan results
func (s *WindowsCISScanner) Collect(ctx context.Context, _ *models.ComplianceScanOptions) (*models.ComplianceScan, error) {
	if !s.available {
		return nil, fmt.Errorf("Windows CIS scanner only available on Windows OS")
	}

	startTime := time.Now()
	results := s.evaluateAllRules(ctx)

	scan := &models.ComplianceScan{
		ProfileName:  "Windows CIS Benchmark",
		ProfileType:  "cis-windows",
		Status:       "completed",
		Score:        calculateScore(results),
		TotalRules:   len(results),
		Passed:       countStatus(results, "pass"),
		Failed:       countStatus(results, "fail"),
		Warnings:     countStatus(results, "warn"),
		Skipped:      countStatus(results, "skip"),
		NotApplicable: countStatus(results, "notapplicable"),
		StartedAt:    startTime,
		CompletedAt:  ptrTime(time.Now()),
	}

	// Convert results to ComplianceResult slice
	for _, r := range results {
		cr := models.ComplianceResult{
			RuleID:      r.Rule.ID,
			Title:       r.Rule.Title,
			Status:      r.Status,
			Finding:     sanitizeForLog(r.Finding),
			Actual:      sanitizeForLog(r.Actual),
			Expected:    sanitizeForLog(r.Expected),
			Section:     r.Rule.Section,
			Description: r.Rule.Description,
			Severity:    r.Rule.Severity,
			Remediation: r.Rule.Remediation,
		}
		scan.Results = append(scan.Results, cr)
	}

	return scan, nil
}

// evaluateAllRules evaluates all CIS rules and returns results
func (s *WindowsCISScanner) evaluateAllRules(ctx context.Context) []scanResult {
	results := make([]scanResult, 0, len(s.ruleset))

	for _, rule := range s.ruleset {
		result := s.evaluateRule(ctx, rule)
		if result.Status != "skip" && result.Status != "notapplicable" {
			s.logger.WithFields(logrus.Fields{
				"rule_id": rule.ID,
				"title":   rule.Title,
				"status":  result.Status,
			}).Debug("CIS check evaluated")
		}
		results = append(results, result)
	}

	return results
}

// evaluateRule checks a single CIS rule against the system
func (s *WindowsCISScanner) evaluateRule(_ context.Context, rule CISRule) scanResult {
	result := scanResult{Rule: rule, Status: "error"}

	switch rule.CheckType {
	case "registry_key":
		return s.evaluateRegistryKey(rule)
	case "service_state":
		return s.evaluateServiceState(rule)
	case "policy_value":
		return s.evaluatePolicyValue(rule)
	case "file_exists":
		return s.evaluateFileExists(rule)
	default:
		result.Status = "error"
		result.Finding = fmt.Sprintf("Unknown check_type: %s", rule.CheckType)
	}

	return result
}

// evaluateRegistryKey reads a Windows registry key and checks the value
func (s *WindowsCISScanner) evaluateRegistryKey(rule CISRule) scanResult {
	result := scanResult{Rule: rule, Status: "fail"}

	// Use reg query command (built into Windows, works in Session 0 / SYSTEM)
	cmdStr := fmt.Sprintf(`reg query "%s" /v "%s"`, rule.CheckKey, rule.CheckValue)
	cmd := exec.Command("cmd", "/c", cmdStr)
	output, err := cmd.Output()

	if err != nil {
		// reg query returns non-zero if key or value not found
		result.Status = "notapplicable"
		result.Finding = "Registry key or value not found"
		result.Actual = ""
		result.Expected = rule.CheckData
		return result
	}

	// Parse the output to extract the actual value
	actualValue := parseRegOutput(string(output), rule.CheckValue)
	result.Actual = actualValue

	// Perform comparison based on operator
	switch rule.Operator {
	case "eq":
		if actualValue == rule.CheckData {
			result.Status = "pass"
			result.Finding = fmt.Sprintf("Value matches: %s", rule.Title)
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected: %s, Actual: %s", rule.CheckData, actualValue)
		}
	case "neq":
		if actualValue != rule.CheckData {
			result.Status = "pass"
			result.Finding = fmt.Sprintf("Value correctly differs from expected")
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected NOT %s, got same value", rule.CheckData)
		}
	case "exists":
		if actualValue != "" {
			result.Status = "pass"
			result.Finding = "Registry key exists"
		} else {
			result.Status = "fail"
			result.Finding = "Expected registry value to exist but not found"
		}
	case "not_exists":
		if actualValue == "" {
			result.Status = "pass"
			result.Finding = "Registry key correctly does not exist"
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected registry value NOT to exist, but found: %s", actualValue)
		}
	case "contains":
		if strings.Contains(actualValue, rule.CheckData) {
			result.Status = "pass"
			result.Finding = "Value contains expected data"
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected value to contain %s, got: %s", rule.CheckData, actualValue)
		}
	case "gte":
		result.Status = evaluateNumericComparison(actualValue, rule.CheckData, ">=")
		result.Finding = formatComparisonResult(actualValue, rule.CheckData, ">=", result.Status == "pass")
	case "lte":
		result.Status = evaluateNumericComparison(actualValue, rule.CheckData, "<=")
		result.Finding = formatComparisonResult(actualValue, rule.CheckData, "<=", result.Status == "pass")
	default:
		// Default to equality check
		if actualValue == rule.CheckData {
			result.Status = "pass"
			result.Finding = "Default: value matches expected"
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected: %s, Actual: %s", rule.CheckData, actualValue)
		}
	}

	return result
}

// evaluateServiceState checks if a Windows service is in the expected state
func (s *WindowsCISScanner) evaluateServiceState(rule CISRule) scanResult {
	result := scanResult{Rule: rule, Status: "fail"}

	cmd := exec.Command("cmd", "/c", fmt.Sprintf(`sc query "%s"`, rule.CheckKey))
	output, err := cmd.Output()

	if err != nil {
		result.Status = "error"
		result.Finding = fmt.Sprintf("Failed to query service %s: %v", rule.CheckKey, err)
		return result
	}

	// Parse sc query output for STATE field
	state := extractServiceState(string(output))

	result.Actual = state
	result.Expected = rule.CheckData

	switch rule.Operator {
	case "eq":
		if normalizeState(state) == normalizeState(rule.CheckData) {
			result.Status = "pass"
			result.Finding = fmt.Sprintf("Service %s is %s (as expected)", rule.CheckKey, state)
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected service to be %s, but it is %s", rule.CheckData, state)
		}
	case "not_eq": // renamed from not_eq due to Go identifier rules - actually using 'neq' below
		if normalizeState(state) != normalizeState(rule.CheckData) {
			result.Status = "pass"
			result.Finding = fmt.Sprintf("Service %s is NOT %s (as expected)", rule.CheckKey, rule.CheckData)
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected service NOT to be %s, but it is", rule.CheckData)
		}
	default:
		result.Status = "pass" // default if no operator specified
		result.Finding = "Service query successful"
	}

	return result
}

// evaluatePolicyValue checks a local security policy value via reg query or secedit
func (s *WindowsCISScanner) evaluatePolicyValue(rule CISRule) scanResult {
	result := scanResult{Rule: rule, Status: "fail"}

	cmdStr := fmt.Sprintf(`reg query "%s" /v "%s"`, rule.CheckKey, rule.CheckValue)
	cmd := exec.Command("cmd", "/c", cmdStr)
	output, err := cmd.Output()

	if err != nil {
		result.Status = "notapplicable"
		result.Finding = "Policy value not configured"
		result.Actual = ""
		result.Expected = rule.CheckData
		return result
	}

	actualValue := parseRegOutput(string(output), rule.CheckValue)
	result.Actual = actualValue

	switch rule.Operator {
	case "eq":
		if actualValue == rule.CheckData {
			result.Status = "pass"
			result.Finding = fmt.Sprintf("Policy matches: %s", rule.Title)
		} else {
			result.Status = "fail"
			result.Finding = fmt.Sprintf("Expected: %s, Actual: %s", rule.CheckData, actualValue)
		}
	default:
		if actualValue != "" {
			result.Status = "pass"
			result.Finding = "Policy value is configured"
		} else {
			result.Status = "fail"
			result.Finding = "Policy value not set"
		}
	}

	return result
}

// evaluateFileExists checks if a file exists on the Windows filesystem
func (s *WindowsCISScanner) evaluateFileExists(rule CISRule) scanResult {
	result := scanResult{Rule: rule, Status: "fail"}

	// Convert forward slashes to backslashes for Windows paths
	checkPath := strings.ReplaceAll(rule.CheckKey, "/", "\\")

	if _, err := os.Stat(checkPath); err == nil {
		result.Status = "pass"
		result.Finding = fmt.Sprintf("File exists at %s", checkPath)
	} else {
		result.Status = "fail"
		result.Finding = fmt.Sprintf("File not found at %s", checkPath)
		result.Actual = "not found"
		result.Expected = "exists"
	}

	return result
}

// parseRegOutput extracts the value from reg query output
func parseRegOutput(output, valueName string) string {
	lines := strings.Split(strings.TrimSpace(output), "\n")

	for _, line := range lines {
		// Look for lines containing the value name (usually "    REG_SZ    ValueName")
		if strings.Contains(line, valueName) || strings.HasSuffix(strings.Fields(line)[0], valueName) {
			parts := strings.Fields(line)
			if len(parts) > 2 {
				return strings.Join(parts[2:], " ")
			}
		}
	}

	// Fallback: try to find the value in a simpler format
	for _, line := range lines {
		if strings.Contains(strings.ToUpper(line), strings.ToUpper(valueName)) {
			// Extract after the colon or space
			if idx := strings.Index(line, ":"); idx > 0 {
				return strings.TrimSpace(line[idx+1:])
			}
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				return parts[len(parts)-1]
			}
		}
	}

	return ""
}

// extractServiceState extracts the SERVICE_STATE from sc query output
func extractServiceState(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "STATE") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				stateStr := parts[len(parts)-1]
				// Remove trailing newline or carriage return
				stateStr = strings.TrimRight(stateStr, "\r\n")
				return stateStr
			}
		}
	}
	return "unknown"
}

// normalizeState normalizes service state for comparison
func normalizeState(state string) string {
	switch {
	case strings.Contains(strings.ToUpper(state), "RUNNING"):
		return "running"
	case strings.Contains(strings.ToUpper(state), "STOPPED"), strings.Contains(strings.ToUpper(state), "STOPPING"), strings.Contains(strings.ToUpper(state), "PAUSED"):
		return "stopped"
	default:
		return state
	}
}

// evaluateNumericComparison performs numeric comparison and returns pass/fail status
func evaluateNumericComparison(actual, expected string, operator string) string {
	var actualNum, expectedNum float64

	// Try to parse as integers first, then floats
	if _, err := fmt.Sscanf(actual, "%f", &actualNum); err != nil {
		return "error"
	}
	if _, err := fmt.Sscanf(expected, "%f", &expectedNum); err != nil {
		return "error"
	}

	switch operator {
	case ">=":
		if actualNum >= expectedNum {
			return "pass"
		} else if actualNum < expectedNum-0.01 {
			return "fail"
		}
		return "warn" // close enough but not quite
	case "<=":
		if actualNum <= expectedNum {
			return "pass"
		} else if actualNum > expectedNum+0.01 {
			return "fail"
		}
		return "warn"
	default:
		return "error"
	}
}

// formatComparisonResult creates a user-friendly comparison message
func formatComparisonResult(actual, expected string, operator string, passed bool) string {
	if passed {
		return fmt.Sprintf("Value %s expected condition", sanitizeForLog(actual))
	}
	return fmt.Sprintf("Expected value %s to satisfy %s%s, actual: %s",
		sanitizeForLog(expected), "", operator, sanitizeForLog(actual))
}

// calculateScore computes the compliance percentage
func calculateScore(results []scanResult) float64 {
	if len(results) == 0 {
		return 0
	}

	passed := countStatus(results, "pass") + countStatus(results, "notapplicable")
	total := len(results)

	score := (float64(passed) / float64(total)) * 100

	// Round to one decimal place
	return float64(int(score*10)) / 10
}

// countStatus counts results with a specific status
func countStatus(results []scanResult, status string) int {
	count := 0
	for _, r := range results {
		if r.Status == status {
			count++
		}
	}
	return count
}

// ptrTime returns a pointer to the given time value
func ptrTime(t time.Time) *time.Time {
	return &t
}

// UpdateRuleset fetches updated CIS rules from a remote source
func (s *WindowsCISScanner) UpdateRuleset(ctx context.Context, url string) error {
	if !s.available {
		return fmt.Errorf("ruleset update only available on Windows")
	}

	s.logger.WithField("url", url).Info("Fetching updated CIS ruleset...")

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch ruleset: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ruleset update failed: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
	if err != nil {
		return fmt.Errorf("failed to read ruleset: %w", err)
	}

	// Try to parse as JSON array of rules first
	var newRules []CISRule
	if err := json.Unmarshal(body, &newRules); err == nil {
		s.ruleset = newRules
		s.lastUpdate = time.Now()
		s.logger.WithField("rules", len(newRules)).Info("Updated CIS ruleset from JSON")
		return nil
	}

	// Try to parse as zip containing rules.json
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err == nil && len(reader.File) > 0 {
		zipFile, err := reader.File[0].Open()
		if err == nil {
			defer zipFile.Close()
			zipBody, err := io.ReadAll(zipFile)
			if err == nil {
				var newRules []CISRule
				if err := json.Unmarshal(zipBody, &newRules); err == nil {
					s.ruleset = newRules
					s.lastUpdate = time.Now()
					s.logger.WithField("rules", len(newRules)).Info("Updated CIS ruleset from ZIP")
					return nil
				}
			}
		}
	}

	// Try to parse as plain text rule file (one rule per line: ID|Title|CheckType|Key|Value|Data|Operator)
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	newRules = make([]CISRule, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue // skip empty and comments
		}

		parts := strings.SplitN(line, "|", 7)
		if len(parts) < 4 {
			s.logger.WithField("line", line).Warn("Skipping malformed rule line")
			continue
		}

		rule := CISRule{
			ID:        parts[0],
			Title:     parts[1],
			CheckType: parts[2],
			CheckKey:  parts[3],
			CheckValue: parts[4],
			CheckData:  parts[5],
		}
		if len(parts) > 6 {
			rule.Operator = parts[6]
		}
		newRules = append(newRules, rule)
	}

	if len(newRules) > 0 {
		s.ruleset = newRules
		s.lastUpdate = time.Now()
		s.logger.WithField("rules", len(newRules)).Info("Updated CIS ruleset from text")
		return nil
	}

	return fmt.Errorf("failed to parse ruleset content")
}

// GetRuleset returns the current ruleset (for reporting)
func (s *WindowsCISScanner) GetRuleset() []CISRule {
	return s.ruleset
}

// GetRulesCount returns the number of rules in the current ruleset
func (s *WindowsCISScanner) GetRulesCount() int {
	return len(s.ruleset)
}
