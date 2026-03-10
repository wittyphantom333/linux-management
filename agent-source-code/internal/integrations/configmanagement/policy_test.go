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
