// Package models provides data models for the config management integration.
// This integration is inspired by Rudder.io's approach to configuration management:
//   - Techniques: reusable configuration skeletons (file management, package state, service state, etc.)
//   - Directives: parameterised instances of techniques
//   - Rules: link directives to host groups (applied via Monux's existing group system)
//   - Policies: the computed set of directives applicable to a specific host
//   - Compliance: audit (report only) or enforce (auto-remediate) with drift detection
package models

import (
	"encoding/json"
	"fmt"
	"time"
)

// ParamMap is a string→string map that tolerates non-string JSON values.
// During JSON unmarshalling, booleans, numbers, and null values are coerced
// to their string representation so that parameters stored via Prisma's Json
// column type (which may contain mixed types) always deserialise successfully.
type ParamMap map[string]string

func (p *ParamMap) UnmarshalJSON(data []byte) error {
	// Try the fast path: all values are already strings.
	var strict map[string]string
	if err := json.Unmarshal(data, &strict); err == nil {
		*p = strict
		return nil
	}

	// Slow path: coerce each value.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	m := make(map[string]string, len(raw))
	for k, v := range raw {
		var s string
		if err := json.Unmarshal(v, &s); err == nil {
			m[k] = s
			continue
		}
		// Trim surrounding whitespace; use the raw JSON representation.
		m[k] = fmt.Sprintf("%s", string(v))
	}
	*p = m
	return nil
}

func (p ParamMap) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string(p))
}

// ---------------------------------------------------------------------------
// Techniques
// ---------------------------------------------------------------------------

// ConfigTechnique defines a reusable configuration skeleton.
// Techniques are defined server-side and pushed to agents as part of their policies.
type ConfigTechnique struct {
	ID          string                    `json:"id"`
	Name        string                    `json:"name"`
	Description string                    `json:"description,omitempty"`
	Version     string                    `json:"version"`
	Category    string                    `json:"category,omitempty"` // e.g. "files", "packages", "services", "users", "commands"
	Parameters  []ConfigTechniqueParam    `json:"parameters,omitempty"`
	Methods     []ConfigTechniqueMethod   `json:"methods"`
	Conditions  *ConfigTechniqueCondition `json:"conditions,omitempty"`
}

// ConfigTechniqueParam describes a parameter accepted by a technique.
type ConfigTechniqueParam struct {
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	Type         string `json:"type"`                    // "string", "boolean", "integer", "enum", "json"
	Default      string `json:"default,omitempty"`       // Default value (always serialised as string)
	Required     bool   `json:"required"`                // Whether a directive MUST provide this value
	Validation   string `json:"validation,omitempty"`    // Optional regex for string values
	EnumValues   string `json:"enum_values,omitempty"`   // Pipe-separated allowed values for enum type
	Sensitive    bool   `json:"sensitive,omitempty"`      // Mask value in UI/logs
}

// ConfigTechniqueMethod is a single operation inside a technique.
// Methods are evaluated in order; each produces a result condition that
// subsequent methods can reference (inspired by Rudder's method chaining).
type ConfigTechniqueMethod struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`                    // Built-in method type: "file_content", "file_key_value", "package_present", "package_absent", "service_running", "service_stopped", "service_restart", "command_audit", "command_exec", "user_present", "user_absent", "directory_present", "file_permissions"
	Name        string   `json:"name"`                    // Human-readable label
	Parameters  ParamMap `json:"parameters"`              // Key → value (may reference technique params via ${param_name} or {{param_name}})
	Condition   string   `json:"condition,omitempty"`     // Run only when this condition expression is true (e.g. "method_1.repaired")
	ResultAlias string   `json:"result_alias,omitempty"` // Override the result condition name (defaults to method ID)
}

// ConfigTechniqueCondition restricts the whole technique to certain environments.
type ConfigTechniqueCondition struct {
	OS       []string `json:"os,omitempty"`       // Allowed OS families: "debian", "rhel", "suse", "freebsd", "linux"
	MinAgent string   `json:"min_agent,omitempty"` // Minimum agent version required
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

// ConfigDirective is a parameterised instance of a technique.
type ConfigDirective struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Description      string            `json:"description,omitempty"`
	TechniqueID      string            `json:"technique_id"`
	TechniqueVersion string   `json:"technique_version,omitempty"` // Pinned technique version
	Version          string   `json:"version"`
	Priority         int      `json:"priority"`                // Lower = higher priority (like Rudder)
	PolicyMode       string   `json:"policy_mode"`             // "audit" or "enforce"
	Parameters       ParamMap `json:"parameters"`              // Technique param values
	Enabled          bool     `json:"enabled"`
	Tags             ParamMap `json:"tags,omitempty"`
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// ConfigRule links one or more directives to one or more host groups.
type ConfigRule struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Description      string            `json:"description,omitempty"`
	DirectiveIDs     []string          `json:"directive_ids"`
	GroupIDs         []string          `json:"group_ids"`          // Monux host-group IDs
	Enabled          bool              `json:"enabled"`
	Priority         int               `json:"priority"`           // Rule ordering (lower = first)
	RunSchedule      string            `json:"run_schedule"`       // "always", "once", "interval", "cron"
	ScheduleInterval int               `json:"schedule_interval"` // Minutes between runs
	ScheduleCron     string            `json:"schedule_cron"`     // Cron expression
	ScheduleTimezone string   `json:"schedule_timezone"` // IANA timezone
	Tags             ParamMap `json:"tags,omitempty"`
}

// ---------------------------------------------------------------------------
// Policies  (computed server-side, delivered to agents)
// ---------------------------------------------------------------------------

// ConfigPolicy is the resolved set of directives applicable to a single host.
// The server computes this from rules, groups, and directive priorities.
type ConfigPolicy struct {
	PolicyID    string                `json:"policy_id"`
	HostID      string                `json:"host_id"`
	GeneratedAt time.Time            `json:"generated_at"`
	GlobalMode  string                `json:"global_mode"`  // Default policy mode: "audit" or "enforce"
	Directives  []ConfigPolicyItem    `json:"directives"`   // Ordered by priority
	Techniques  []ConfigTechnique     `json:"techniques"`   // Resolved technique definitions (so agent doesn't need to fetch separately)
}

// ConfigPolicyItem is a directive within a resolved policy, with its effective mode.
type ConfigPolicyItem struct {
	Directive     ConfigDirective        `json:"directive"`
	EffectiveMode string                  `json:"effective_mode"`   // Computed: override wins, then audit wins
	RuleID        string                  `json:"rule_id"`
	RuleName      string                  `json:"rule_name"`
	Schedule      ConfigPolicySchedule    `json:"schedule"`
}

// ConfigPolicySchedule defines when a directive should be evaluated.
type ConfigPolicySchedule struct {
	RunSchedule      string `json:"run_schedule"`       // "always", "once", "interval", "cron"
	ScheduleInterval int    `json:"schedule_interval"` // Minutes between runs (for "interval")
	ScheduleCron     string `json:"schedule_cron"`     // Cron expression (for "cron")
	ScheduleTimezone string `json:"schedule_timezone"` // IANA timezone for cron
}

// ---------------------------------------------------------------------------
// Compliance / Reporting
// ---------------------------------------------------------------------------

// ConfigMethodResult captures the outcome of evaluating one method.
type ConfigMethodResult struct {
	MethodID    string `json:"method_id"`
	MethodName  string `json:"method_name"`
	MethodType  string `json:"method_type"`
	Status      string `json:"status"`               // "success", "repaired", "error", "not_applicable", "audit_compliant", "audit_non_compliant", "audit_error"
	Message     string `json:"message,omitempty"`
	Actual      string `json:"actual,omitempty"`      // What was found
	Expected    string `json:"expected,omitempty"`     // What was desired
}

// ConfigDirectiveResult captures the outcome of evaluating one directive.
type ConfigDirectiveResult struct {
	DirectiveID   string               `json:"directive_id"`
	DirectiveName string               `json:"directive_name"`
	TechniqueID   string               `json:"technique_id"`
	PolicyMode    string               `json:"policy_mode"`            // "audit" or "enforce"
	Status        string               `json:"status"`                 // "compliant", "non_compliant", "error", "not_applicable", "repaired", "skipped", "audited"
	Message       string               `json:"message,omitempty"`      // Human-readable message (e.g. schedule skip reason)
	Methods       []ConfigMethodResult `json:"methods"`
	StartedAt     time.Time            `json:"started_at"`
	CompletedAt   *time.Time           `json:"completed_at,omitempty"`
}

// ConfigComplianceReport is the full report sent from agent → server after policy evaluation.
type ConfigComplianceReport struct {
	PolicyID         string                  `json:"policy_id"`
	HostID           string                  `json:"host_id"`
	GlobalMode       string                  `json:"global_mode"`
	EvaluatedAt      time.Time               `json:"evaluated_at"`
	TotalDirectives  int                     `json:"total_directives"`
	Compliant        int                     `json:"compliant"`
	NonCompliant     int                     `json:"non_compliant"`
	Errors           int                     `json:"errors"`
	Repaired         int                     `json:"repaired"`
	NotApplicable    int                     `json:"not_applicable"`
	Audited          int                     `json:"audited"`
	Score            float64                 `json:"score"` // 0-100%
	DirectiveResults []ConfigDirectiveResult `json:"directive_results"`
}

// ---------------------------------------------------------------------------
// Agent ↔ Server payloads
// ---------------------------------------------------------------------------

// ConfigManagementData wraps everything the agent collects for this integration.
type ConfigManagementData struct {
	Report      *ConfigComplianceReport `json:"report,omitempty"`
	CurrentHash string                  `json:"current_hash,omitempty"` // SHA-256 of the last-applied policy, so server can skip unchanged pushes
}

// ConfigManagementPayload is sent from the agent to the server.
type ConfigManagementPayload struct {
	ConfigManagementData
	Hostname     string `json:"hostname"`
	MachineID    string `json:"machine_id"`
	AgentVersion string `json:"agent_version"`
}

// ConfigManagementResponse is what the server returns.
type ConfigManagementResponse struct {
	Message           string `json:"message"`
	DirectivesApplied int    `json:"directives_applied"`
}

// ConfigPolicyResponse is sent from server → agent when it fetches its policy.
type ConfigPolicyResponse struct {
	Policy  *ConfigPolicy `json:"policy,omitempty"`
	Message string        `json:"message,omitempty"`
	Changed bool          `json:"changed"` // Whether this policy differs from the agent's current hash
}
