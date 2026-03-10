package configmanagement

import (
	"context"
	"encoding/json"
	"testing"

	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

// TestMultiMethodTechniqueAllMethodsRun verifies that a technique with multiple
// methods produces a result for EVERY method, not just the first one.
func TestMultiMethodTechniqueAllMethodsRun(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)

	pe := NewPolicyExecutor(logger)

	policy := &models.ConfigPolicy{
		PolicyID:   "test-policy-1",
		HostID:     "test-host-1",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-1",
				Name:    "Multi-Method Test",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{
						ID:         "method_1",
						Type:       "command_run",
						Name:       "First method",
						Parameters: models.ParamMap{"command": "echo first"},
					},
					{
						ID:         "method_2",
						Type:       "command_run",
						Name:       "Second method",
						Parameters: models.ParamMap{"command": "echo second"},
					},
					{
						ID:         "method_3",
						Type:       "command_run",
						Name:       "Third method",
						Parameters: models.ParamMap{"command": "echo third"},
					},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-1",
					Name:        "Test Directive",
					TechniqueID: "tech-1",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{},
				},
				EffectiveMode: "audit",
				RuleID:        "rule-1",
				RuleName:      "Test Rule",
				Schedule: models.ConfigPolicySchedule{
					RunSchedule: "always",
				},
			},
		},
	}

	report := pe.Evaluate(context.Background(), policy, nil)

	if report == nil {
		t.Fatal("report is nil")
	}

	if len(report.DirectiveResults) != 1 {
		t.Fatalf("expected 1 directive result, got %d", len(report.DirectiveResults))
	}

	dr := report.DirectiveResults[0]
	if len(dr.Methods) != 3 {
		t.Fatalf("expected 3 method results, got %d", len(dr.Methods))
	}

	for i, mr := range dr.Methods {
		t.Logf("Method %d: id=%s name=%q type=%s status=%s message=%q actual=%q",
			i, mr.MethodID, mr.MethodName, mr.MethodType, mr.Status, mr.Message, mr.Actual)
		if mr.MethodID == "" {
			t.Errorf("method %d has empty MethodID", i)
		}
		if mr.MethodType != "command_run" {
			t.Errorf("method %d has wrong type: %s", i, mr.MethodType)
		}
	}

	// Verify each method got the right name back
	expectedNames := []string{"First method", "Second method", "Third method"}
	for i, expected := range expectedNames {
		if dr.Methods[i].MethodName != expected {
			t.Errorf("method %d name: got %q, want %q", i, dr.Methods[i].MethodName, expected)
		}
	}
}

// TestMultiMethodWithDifferentTypes verifies that mixed method types all execute.
func TestMultiMethodWithDifferentTypes(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)

	pe := NewPolicyExecutor(logger)

	policy := &models.ConfigPolicy{
		PolicyID:   "test-policy-2",
		HostID:     "test-host-2",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-2",
				Name:    "Mixed Method Test",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{
						ID:         "method_1",
						Type:       "command_run",
						Name:       "Run a command",
						Parameters: models.ParamMap{"command": "echo hello"},
					},
					{
						ID:         "method_2",
						Type:       "command_audit",
						Name:       "Audit a command",
						Parameters: models.ParamMap{"command": "echo check", "expected_code": "0"},
					},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-2",
					Name:        "Mixed Directive",
					TechniqueID: "tech-2",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{},
				},
				EffectiveMode: "audit",
				RuleID:        "rule-2",
				RuleName:      "Test Rule 2",
				Schedule: models.ConfigPolicySchedule{
					RunSchedule: "always",
				},
			},
		},
	}

	report := pe.Evaluate(context.Background(), policy, nil)

	if len(report.DirectiveResults) != 1 {
		t.Fatalf("expected 1 directive result, got %d", len(report.DirectiveResults))
	}

	dr := report.DirectiveResults[0]
	if len(dr.Methods) != 2 {
		t.Fatalf("expected 2 method results, got %d", len(dr.Methods))
	}

	if dr.Methods[0].MethodType != "command_run" {
		t.Errorf("method 0 type: got %q, want %q", dr.Methods[0].MethodType, "command_run")
	}
	if dr.Methods[1].MethodType != "command_audit" {
		t.Errorf("method 1 type: got %q, want %q", dr.Methods[1].MethodType, "command_audit")
	}
}

// TestMultiMethodWithParameterSubstitution verifies that directive parameters
// are correctly substituted into method parameters across all methods.
func TestMultiMethodWithParameterSubstitution(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)

	pe := NewPolicyExecutor(logger)

	policy := &models.ConfigPolicy{
		PolicyID:   "test-policy-3",
		HostID:     "test-host-3",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-3",
				Name:    "Param Substitution Test",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{
						ID:         "method_1",
						Type:       "command_run",
						Name:       "Show name",
						Parameters: models.ParamMap{"command": "echo ${username}"},
					},
					{
						ID:         "method_2",
						Type:       "command_run",
						Name:       "Show key",
						Parameters: models.ParamMap{"command": "echo ${ssh_key}"},
					},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-3",
					Name:        "With Params",
					TechniqueID: "tech-3",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{"username": "deploy", "ssh_key": "ssh-rsa AAAA..."},
				},
				EffectiveMode: "audit",
				RuleID:        "rule-3",
				RuleName:      "Test Rule 3",
				Schedule: models.ConfigPolicySchedule{
					RunSchedule: "always",
				},
			},
		},
	}

	report := pe.Evaluate(context.Background(), policy, nil)

	dr := report.DirectiveResults[0]
	if len(dr.Methods) != 2 {
		t.Fatalf("expected 2 method results, got %d", len(dr.Methods))
	}

	// Both methods should have executed successfully
	for i, mr := range dr.Methods {
		t.Logf("Method %d: status=%s actual=%q", i, mr.Status, mr.Actual)
		if mr.Status == "error" {
			t.Errorf("method %d errored: %s", i, mr.Message)
		}
	}
}

// TestJSONRoundtripPreservesAllMethods verifies that serializing and
// deserializing a ConfigPolicy with multi-method techniques preserves
// all methods — ruling out JSON serialization bugs.
func TestJSONRoundtripPreservesAllMethods(t *testing.T) {
	original := models.ConfigPolicy{
		PolicyID:   "rt-policy",
		HostID:     "rt-host",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-rt",
				Name:    "Roundtrip Test",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{ID: "m1", Type: "command_run", Name: "First", Parameters: models.ParamMap{"command": "echo 1"}},
					{ID: "m2", Type: "command_exec", Name: "Second", Parameters: models.ParamMap{"command": "echo 2"}},
					{ID: "m3", Type: "command_audit", Name: "Third", Parameters: models.ParamMap{"command": "echo 3", "expected_code": "0"}},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-rt",
					Name:        "RT Directive",
					TechniqueID: "tech-rt",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{},
				},
				EffectiveMode: "audit",
			},
		},
	}

	// Marshal
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	t.Logf("Serialized policy JSON (%d bytes): %s", len(data), string(data))

	// Unmarshal
	var restored models.ConfigPolicy
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if len(restored.Techniques) != 1 {
		t.Fatalf("expected 1 technique, got %d", len(restored.Techniques))
	}

	tech := restored.Techniques[0]
	if len(tech.Methods) != 3 {
		t.Fatalf("expected 3 methods after roundtrip, got %d", len(tech.Methods))
	}

	for i, m := range tech.Methods {
		t.Logf("Restored method %d: id=%s type=%s name=%q params=%v", i, m.ID, m.Type, m.Name, m.Parameters)
	}

	// Also test ConfigPolicyResponse roundtrip (what the agent actually receives)
	resp := models.ConfigPolicyResponse{
		Policy:  &original,
		Message: "test",
		Changed: true,
	}

	respData, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal ConfigPolicyResponse failed: %v", err)
	}

	var restoredResp models.ConfigPolicyResponse
	if err := json.Unmarshal(respData, &restoredResp); err != nil {
		t.Fatalf("unmarshal ConfigPolicyResponse failed: %v", err)
	}

	if restoredResp.Policy == nil {
		t.Fatal("restored policy is nil")
	}
	if len(restoredResp.Policy.Techniques) != 1 {
		t.Fatalf("expected 1 technique, got %d", len(restoredResp.Policy.Techniques))
	}
	if len(restoredResp.Policy.Techniques[0].Methods) != 3 {
		t.Fatalf("expected 3 methods in response roundtrip, got %d", len(restoredResp.Policy.Techniques[0].Methods))
	}
}

// TestParamMapHandlesMixedTypes verifies that the ParamMap custom unmarshaler
// doesn't break when technique methods have parameters with mixed JSON types
// (strings, booleans, numbers, nulls) — which can happen with Prisma's Json column.
func TestParamMapHandlesMixedTypes(t *testing.T) {
	// Simulate a technique method from the server with mixed-type parameters
	rawJSON := `{
		"id": "tech-pm",
		"name": "ParamMap Test",
		"version": "1.0",
		"methods": [
			{
				"id": "m1",
				"type": "command_run",
				"name": "String params",
				"parameters": {"command": "echo hello", "path": "/tmp/test"}
			},
			{
				"id": "m2",
				"type": "command_run",
				"name": "Mixed params",
				"parameters": {"command": "echo world", "count": 5, "verbose": true, "extra": null}
			},
			{
				"id": "m3",
				"type": "command_run",
				"name": "Empty params",
				"parameters": {}
			}
		]
	}`

	var tech models.ConfigTechnique
	if err := json.Unmarshal([]byte(rawJSON), &tech); err != nil {
		t.Fatalf("failed to unmarshal technique: %v", err)
	}

	if len(tech.Methods) != 3 {
		t.Fatalf("expected 3 methods, got %d", len(tech.Methods))
	}

	// Method 1: pure strings
	if tech.Methods[0].Parameters["command"] != "echo hello" {
		t.Errorf("m1 command: got %q", tech.Methods[0].Parameters["command"])
	}

	// Method 2: mixed types (numbers and bools coerced to strings)
	if tech.Methods[1].Parameters["command"] != "echo world" {
		t.Errorf("m2 command: got %q", tech.Methods[1].Parameters["command"])
	}
	if tech.Methods[1].Parameters["count"] != "5" {
		t.Errorf("m2 count: got %q, want %q", tech.Methods[1].Parameters["count"], "5")
	}
	if tech.Methods[1].Parameters["verbose"] != "true" {
		t.Errorf("m2 verbose: got %q, want %q", tech.Methods[1].Parameters["verbose"], "true")
	}

	// Method 3: empty params
	if len(tech.Methods[2].Parameters) != 0 {
		t.Errorf("m3 should have 0 params, got %d", len(tech.Methods[2].Parameters))
	}
}

// TestConditionEvaluator verifies the revamped condition evaluator handles
// all supported syntax variants: dot notation, == / != operators, negation,
// OR, and status aliases.
func TestConditionEvaluator(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)
	pe := NewPolicyExecutor(logger)

	results := map[string]string{
		"method_1": "audit_compliant",
		"method_2": "repaired",
		"method_3": "error",
		"check":    "non_compliant",
	}

	tests := []struct {
		condition string
		expected  bool
	}{
		// Dot notation
		{"method_1.success", true},
		{"method_1.compliant", true},
		{"method_1.ok", true},
		{"method_1.audit_compliant", true},
		{"method_1.error", false},
		{"method_2.repaired", true},
		{"method_2.success", false},
		{"method_3.error", true},
		{"method_3.success", false},
		{"check.non_compliant", true},
		{"check.failed", true},
		{"check.success", false},

		// Equality syntax (what the UI placeholder previously showed)
		{"method_1 == success", true},
		{"method_1 == compliant", true},
		{"method_1 == error", false},
		{"method_2 == repaired", true},
		{"method_3 == error", true},
		{"check == non_compliant", true},

		// Not-equal syntax
		{"method_1 != error", true},
		{"method_1 != success", false},
		{"method_3 != error", false},
		{"method_3 != success", true},

		// Negation with dot notation
		{"!method_1.error", true},
		{"!method_1.success", false},
		{"!method_3.error", false},
		{"!method_3.success", true},

		// OR
		{"method_1.success | method_2.success", true},
		{"method_1.error | method_2.error", false},
		{"method_1.error | method_3.error", true},
		{"method_1 == success | method_3 == success", true},

		// "any" — does method exist with any status?
		{"method_1.any", true},
		{"method_1 == any", true},
		{"nonexistent.any", false},

		// Missing method
		{"nonexistent.success", false},
		{"!nonexistent.success", true}, // vacuously true

		// Empty condition
		{"", true},
		{"  ", true},

		// "failed" alias — matches error or non_compliant
		{"method_3.failed", true},
		{"check.failed", true},
		{"method_1.failed", false},
		{"method_2.failed", false},
	}

	for _, tc := range tests {
		got := pe.evaluateCondition(tc.condition, results)
		if got != tc.expected {
			t.Errorf("evaluateCondition(%q) = %v, want %v", tc.condition, got, tc.expected)
		}
	}
}

// TestConditionIntegrationWithMultiMethod verifies that conditions actually work
// in a real policy evaluation with method chaining.
func TestConditionIntegrationWithMultiMethod(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)
	pe := NewPolicyExecutor(logger)

	policy := &models.ConfigPolicy{
		PolicyID:   "cond-policy",
		HostID:     "cond-host",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-cond",
				Name:    "Conditional Methods",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{
						ID:         "method_1",
						Type:       "command_run",
						Name:       "Always runs",
						Parameters: models.ParamMap{"command": "echo step1"},
					},
					{
						ID:         "method_2",
						Type:       "command_run",
						Name:       "Runs if method_1 succeeded",
						Parameters: models.ParamMap{"command": "echo step2"},
						Condition:  "method_1 == success",
					},
					{
						ID:         "method_3",
						Type:       "command_run",
						Name:       "Runs if method_1 failed",
						Parameters: models.ParamMap{"command": "echo step3"},
						Condition:  "method_1 == error",
					},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-cond",
					Name:        "Conditional Directive",
					TechniqueID: "tech-cond",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{},
				},
				EffectiveMode: "audit",
				Schedule: models.ConfigPolicySchedule{
					RunSchedule: "always",
				},
			},
		},
	}

	report := pe.Evaluate(context.Background(), policy, nil)
	dr := report.DirectiveResults[0]

	if len(dr.Methods) != 3 {
		t.Fatalf("expected 3 method results, got %d", len(dr.Methods))
	}

	// method_1: should run (no condition) → audit_compliant
	if dr.Methods[0].Status == "error" || dr.Methods[0].Status == "skipped" {
		t.Errorf("method_1 should have run, got status %q", dr.Methods[0].Status)
	}

	// method_2: condition "method_1 == success" should match audit_compliant → should run
	if dr.Methods[1].Status == "skipped" {
		t.Errorf("method_2 should have run (method_1 was audit_compliant which matches 'success'), got skipped: %s", dr.Methods[1].Message)
	}

	// method_3: condition "method_1 == error" should NOT match → skipped
	if dr.Methods[2].Status != "skipped" {
		t.Errorf("method_3 should be skipped (method_1 was not error), got %q", dr.Methods[2].Status)
	}

	for i, mr := range dr.Methods {
		t.Logf("Method %d: name=%q status=%s message=%q", i, mr.MethodName, mr.Status, mr.Message)
	}
}

// TestPositionalMethodAliases verifies that conditions using "method_1", "method_2"
// positional aliases work even when the actual method IDs are long/random strings
// (e.g. "method_1773030615059"). This was the root cause of user-reported
// "Condition not met: method_1 == success" failures.
func TestPositionalMethodAliases(t *testing.T) {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)
	pe := NewPolicyExecutor(logger)

	policy := &models.ConfigPolicy{
		PolicyID:   "pos-alias-policy",
		HostID:     "pos-alias-host",
		GlobalMode: "audit",
		Techniques: []models.ConfigTechnique{
			{
				ID:      "tech-pos",
				Name:    "Positional Alias Test",
				Version: "1.0",
				Methods: []models.ConfigTechniqueMethod{
					{
						ID:         "method_1773030615059", // realistic timestamp-based ID
						Type:       "command_run",
						Name:       "Check package",
						Parameters: models.ParamMap{"command": "echo installed"},
					},
					{
						ID:         "method_1773030615999", // another realistic ID
						Type:       "command_run",
						Name:       "Run if first succeeded",
						Parameters: models.ParamMap{"command": "echo configuring"},
						Condition:  "method_1 == success", // positional alias, NOT the real ID
					},
					{
						ID:         "method_1773030616111",
						Type:       "command_run",
						Name:       "Run if first failed",
						Parameters: models.ParamMap{"command": "echo fallback"},
						Condition:  "method_1 == error",
					},
				},
			},
		},
		Directives: []models.ConfigPolicyItem{
			{
				Directive: models.ConfigDirective{
					ID:          "dir-pos",
					Name:        "Positional Alias Directive",
					TechniqueID: "tech-pos",
					Version:     "1.0",
					PolicyMode:  "audit",
					Enabled:     true,
					Parameters:  models.ParamMap{},
				},
				EffectiveMode: "audit",
				Schedule: models.ConfigPolicySchedule{
					RunSchedule: "always",
				},
			},
		},
	}

	report := pe.Evaluate(context.Background(), policy, nil)
	dr := report.DirectiveResults[0]

	if len(dr.Methods) != 3 {
		t.Fatalf("expected 3 method results, got %d", len(dr.Methods))
	}

	// method_1773030615059: should run (no condition) → audit_compliant
	if dr.Methods[0].Status == "error" || dr.Methods[0].Status == "skipped" {
		t.Errorf("first method should have run, got status %q", dr.Methods[0].Status)
	}

	// method_1773030615999: condition "method_1 == success" should match via positional alias
	if dr.Methods[1].Status == "skipped" {
		t.Errorf("second method should have run via positional alias 'method_1 == success', got skipped: %s", dr.Methods[1].Message)
	}

	// method_1773030616111: condition "method_1 == error" should NOT match → skipped
	if dr.Methods[2].Status != "skipped" {
		t.Errorf("third method should be skipped (method_1 was not error), got %q", dr.Methods[2].Status)
	}

	for i, mr := range dr.Methods {
		t.Logf("Method %d (id=%s): name=%q status=%s message=%q", i, mr.MethodID, mr.MethodName, mr.Status, mr.Message)
	}
}
