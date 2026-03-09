package configmanagement

import (
	"context"
	"fmt"
	"time"

	"patchmon-agent/internal/utils"
	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

// PolicyExecutor evaluates a policy's directives against the current system state.
type PolicyExecutor struct {
	logger   *logrus.Logger
	methods  map[string]MethodHandler
}

// MethodHandler is the signature for a built-in method implementation.
// It receives the method parameters and the effective policy mode.
// It returns the evaluation result and any error.
type MethodHandler func(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error)

// NewPolicyExecutor creates a new executor with all built-in method handlers registered.
func NewPolicyExecutor(logger *logrus.Logger) *PolicyExecutor {
	pe := &PolicyExecutor{
		logger:  logger,
		methods: make(map[string]MethodHandler),
	}
	pe.registerBuiltinMethods()
	return pe
}

// registerBuiltinMethods registers all available technique method handlers.
func (pe *PolicyExecutor) registerBuiltinMethods() {
	pe.methods["file_content"] = pe.methodFileContent
	pe.methods["file_key_value"] = pe.methodFileKeyValue
	pe.methods["file_permissions"] = pe.methodFilePermissions
	pe.methods["package_present"] = pe.methodPackagePresent
	pe.methods["package_absent"] = pe.methodPackageAbsent
	pe.methods["service_running"] = pe.methodServiceRunning
	pe.methods["service_stopped"] = pe.methodServiceStopped
	pe.methods["service_restart"] = pe.methodServiceRestart
	pe.methods["command_audit"] = pe.methodCommandAudit
	pe.methods["command_exec"] = pe.methodCommandExec
	pe.methods["user_present"] = pe.methodUserPresent
	pe.methods["user_absent"] = pe.methodUserAbsent
	pe.methods["directory_present"] = pe.methodDirectoryPresent
}

// Evaluate walks through all directives in the policy and evaluates each method.
// schedState may be nil — if so, all directives are treated as "always" schedule.
func (pe *PolicyExecutor) Evaluate(ctx context.Context, policy *models.ConfigPolicy, schedState *ScheduleState) *models.ConfigComplianceReport {
	report := &models.ConfigComplianceReport{
		PolicyID:    policy.PolicyID,
		HostID:      policy.HostID,
		GlobalMode:  policy.GlobalMode,
		EvaluatedAt: utils.GetCurrentTimeUTC(),
	}

	// Build technique lookup map
	techMap := make(map[string]*models.ConfigTechnique, len(policy.Techniques))
	for i := range policy.Techniques {
		techMap[policy.Techniques[i].ID] = &policy.Techniques[i]
	}

	directiveResults := make([]models.ConfigDirectiveResult, 0, len(policy.Directives))

	// Condition results from previous methods (for inter-method dependencies)
	conditionResults := make(map[string]string) // "method_id" -> "success"|"repaired"|"error"

	for _, policyItem := range policy.Directives {
		dir := policyItem.Directive
		if !dir.Enabled {
			continue
		}

		dirStart := time.Now()
		effectiveMode := policyItem.EffectiveMode

		// Check schedule — skip directives that aren't due to run yet
		if schedState != nil && !schedState.ShouldRun(policyItem) {
			pe.logger.WithFields(logrus.Fields{
				"directive": dir.Name,
				"schedule":  policyItem.Schedule.RunSchedule,
			}).Debug("Directive skipped (not scheduled to run yet)")
			dirEnd := time.Now()
			directiveResults = append(directiveResults, models.ConfigDirectiveResult{
				DirectiveID:   dir.ID,
				DirectiveName: dir.Name,
				TechniqueID:   dir.TechniqueID,
				PolicyMode:    effectiveMode,
				Status:        "skipped",
				Message:       fmt.Sprintf("Not due: schedule=%s", policyItem.Schedule.RunSchedule),
				Methods:       nil,
				StartedAt:     dirStart,
				CompletedAt:   &dirEnd,
			})
			continue
		}

		tech, ok := techMap[dir.TechniqueID]
		if !ok {
			pe.logger.WithFields(logrus.Fields{
				"directive":  dir.Name,
				"technique":  dir.TechniqueID,
			}).Warn("Technique not found for directive, skipping")
			continue
		}

		// Check technique OS conditions
		if tech.Conditions != nil && len(tech.Conditions.OS) > 0 {
			if !pe.osMatches(tech.Conditions.OS) {
				dirEnd := time.Now()
				directiveResults = append(directiveResults, models.ConfigDirectiveResult{
					DirectiveID:   dir.ID,
					DirectiveName: dir.Name,
					TechniqueID:   dir.TechniqueID,
					PolicyMode:    effectiveMode,
					Status:        "not_applicable",
					Methods:       nil,
					StartedAt:     dirStart,
					CompletedAt:   &dirEnd,
				})
				report.NotApplicable++
				continue
			}
		}

		// Evaluate each method in order
		methodResults := make([]models.ConfigMethodResult, 0, len(tech.Methods))
		dirStatus := "compliant"

		for _, method := range tech.Methods {
			// Check method condition
			if method.Condition != "" && !pe.evaluateCondition(method.Condition, conditionResults) {
				pe.logger.WithFields(logrus.Fields{
					"method":    method.Name,
					"condition": method.Condition,
				}).Debug("Method condition not met, skipping")
				continue
			}

			// Resolve parameters (substitute ${param_name} references)
			resolvedParams := pe.resolveParameters(method.Parameters, dir.Parameters)

			// Execute the method
			handler, exists := pe.methods[method.Type]
			if !exists {
				result := &models.ConfigMethodResult{
					MethodID:   method.ID,
					MethodName: method.Name,
					MethodType: method.Type,
					Status:     "error",
					Message:    fmt.Sprintf("Unknown method type: %s", method.Type),
				}
				methodResults = append(methodResults, *result)
				condAlias := method.ID
				if method.ResultAlias != "" {
					condAlias = method.ResultAlias
				}
				conditionResults[condAlias] = "error"
				dirStatus = "error"
				continue
			}

			result, err := handler(ctx, resolvedParams, effectiveMode)
			if err != nil {
				result = &models.ConfigMethodResult{
					MethodID:   method.ID,
					MethodName: method.Name,
					MethodType: method.Type,
					Status:     "error",
					Message:    err.Error(),
				}
			}
			result.MethodID = method.ID
			result.MethodName = method.Name
			result.MethodType = method.Type

			methodResults = append(methodResults, *result)

			// Store result for condition evaluation
			condAlias := method.ID
			if method.ResultAlias != "" {
				condAlias = method.ResultAlias
			}
			conditionResults[condAlias] = result.Status

			// Update directive status (worst status wins)
			dirStatus = worstStatus(dirStatus, result.Status)
		}

		dirEnd := time.Now()
		directiveResults = append(directiveResults, models.ConfigDirectiveResult{
			DirectiveID:   dir.ID,
			DirectiveName: dir.Name,
			TechniqueID:   dir.TechniqueID,
			PolicyMode:    effectiveMode,
			Status:        dirStatus,
			Methods:       methodResults,
			StartedAt:     dirStart,
			CompletedAt:   &dirEnd,
		})

		// Record that this directive was evaluated (for schedule tracking)
		if schedState != nil {
			schedState.RecordRun(policyItem)
		}

		// Update report counters
		switch dirStatus {
		case "compliant", "success", "audit_compliant":
			report.Compliant++
		case "non_compliant", "audit_non_compliant":
			report.NonCompliant++
		case "repaired":
			report.Repaired++
		case "error", "audit_error":
			report.Errors++
		case "not_applicable":
			report.NotApplicable++
		default:
			report.NonCompliant++
		}
	}

	report.DirectiveResults = directiveResults
	report.TotalDirectives = report.Compliant + report.NonCompliant + report.Errors + report.Repaired + report.NotApplicable

	// Compute score (compliant + repaired = good)
	if report.TotalDirectives > 0 {
		report.Score = float64(report.Compliant+report.Repaired) / float64(report.TotalDirectives) * 100
	}

	return report
}

// resolveParameters substitutes ${param_name} references in method parameters.
func (pe *PolicyExecutor) resolveParameters(methodParams, directiveParams map[string]string) map[string]string {
	resolved := make(map[string]string, len(methodParams))
	for k, v := range methodParams {
		resolved[k] = substituteParams(v, directiveParams)
	}
	return resolved
}

// evaluateCondition checks whether a condition string is met.
// Supports simple conditions like "method_id.repaired", "method_id.success",
// and boolean operators: ! (not), | (or), . (and).
func (pe *PolicyExecutor) evaluateCondition(condition string, results map[string]string) bool {
	// Simple case: "method_id.status"
	// For now, support the simple dotted notation: "<alias>.<status>"
	// More complex boolean expressions can be added later.
	for alias, status := range results {
		check := alias + "." + status
		if condition == check {
			return true
		}
		// Also match broad conditions like "method_id.repaired"
		if condition == alias+".repaired" && status == "repaired" {
			return true
		}
		if condition == alias+".error" && status == "error" {
			return true
		}
		if condition == alias+".success" && (status == "success" || status == "compliant" || status == "audit_compliant") {
			return true
		}
	}

	return false
}

// osMatches checks whether the current OS matches any of the allowed families.
func (pe *PolicyExecutor) osMatches(allowedOS []string) bool {
	// Determine current OS family
	currentFamily := detectOSFamily()
	for _, allowed := range allowedOS {
		if allowed == "linux" && currentFamily != "" {
			return true // Any Linux counts
		}
		if allowed == currentFamily {
			return true
		}
	}
	return false
}

// worstStatus returns the "worse" of two statuses.
// Priority: error > non_compliant > repaired > compliant > not_applicable
func worstStatus(current, incoming string) string {
	priority := map[string]int{
		"not_applicable":      0,
		"compliant":           1,
		"success":             1,
		"audit_compliant":     1,
		"repaired":            2,
		"non_compliant":       3,
		"audit_non_compliant": 3,
		"error":               4,
		"audit_error":         4,
	}

	cp, ok1 := priority[current]
	ip, ok2 := priority[incoming]
	if !ok1 {
		cp = 3
	}
	if !ok2 {
		ip = 3
	}

	if ip > cp {
		return incoming
	}
	return current
}
