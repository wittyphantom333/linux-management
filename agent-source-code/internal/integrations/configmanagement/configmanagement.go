// Package configmanagement implements a configuration management integration
// inspired by Rudder.io's approach: techniques → directives → rules → policies → compliance.
//
// The agent periodically fetches its computed policy from the PatchMon server,
// evaluates each directive's methods against the current system state, and
// reports compliance (or applies remediation in "enforce" mode).
package configmanagement

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"patchmon-agent/internal/client"
	"patchmon-agent/internal/utils"
	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

const (
	integrationName = "configmanagement"
	// Where the agent caches its last-received policy
	policyCacheDir  = "/etc/patchmon/policies"
	policyCacheFile = "current_policy.json"
)

// Integration implements the Integration interface for Configuration Management.
type Integration struct {
	logger      *logrus.Logger
	httpClient  *client.Client
	policy      *models.ConfigPolicy
	policyMu    sync.RWMutex
	policyHash  string
	executor    *PolicyExecutor
}

// New creates a new ConfigManagement integration.
func New(logger *logrus.Logger) *Integration {
	return &Integration{
		logger:   logger,
		executor: NewPolicyExecutor(logger),
	}
}

// SetClient provides the HTTP client so the integration can fetch policies from the server.
// Must be called before Collect().
func (cm *Integration) SetClient(c *client.Client) {
	cm.httpClient = c
}

// Name returns the integration name.
func (cm *Integration) Name() string {
	return integrationName
}

// Priority returns the collection priority (lower = higher priority).
// Config management runs after Docker (10) and before Compliance (20).
func (cm *Integration) Priority() int {
	return 15
}

// SupportsRealtime indicates this integration does NOT support real-time monitoring.
// Policies are evaluated on a schedule (during each report cycle).
func (cm *Integration) SupportsRealtime() bool {
	return false
}

// IsAvailable checks whether config management is available.
// It is always available as long as the agent can reach the server —
// the techniques are all implemented inside the agent binary.
func (cm *Integration) IsAvailable() bool {
	return true
}

// Collect fetches the latest policy from the server, evaluates it, and returns a compliance report.
func (cm *Integration) Collect(ctx context.Context) (*models.IntegrationData, error) {
	startTime := time.Now()
	cm.logger.Info("Starting configuration management evaluation...")

	// Step 1: Fetch the latest policy from the server
	if cm.httpClient != nil {
		cm.logger.Debug("Fetching latest policy from server...")
		currentHash := cm.GetPolicyHash()
		policyResp, err := cm.httpClient.FetchConfigPolicy(ctx, currentHash)
		if err != nil {
			cm.logger.WithError(err).Warn("Failed to fetch policy from server, falling back to cached policy")
		} else if policyResp != nil && policyResp.Policy != nil && policyResp.Changed {
			cm.logger.WithFields(logrus.Fields{
				"policy_id":  policyResp.Policy.PolicyID,
				"directives": len(policyResp.Policy.Directives),
			}).Info("Received updated policy from server")
			if err := cm.SetPolicy(policyResp.Policy); err != nil {
				cm.logger.WithError(err).Warn("Failed to save updated policy to disk")
			}
		} else if policyResp != nil && !policyResp.Changed {
			cm.logger.Debug("Policy unchanged (hash match), using cached version")
		}
	} else {
		cm.logger.Debug("No HTTP client set, using cached policy only")
	}

	// Step 2: Load cached policy if we don't have one in memory
	cm.policyMu.RLock()
	currentPolicy := cm.policy
	cm.policyMu.RUnlock()

	if currentPolicy == nil {
		if err := cm.loadCachedPolicy(); err != nil {
			cm.logger.WithError(err).Debug("No cached policy available")
			return &models.IntegrationData{
				Name:          integrationName,
				Enabled:       true,
				Data:          &models.ConfigManagementData{CurrentHash: ""},
				CollectedAt:   utils.GetCurrentTimeUTC(),
				ExecutionTime: time.Since(startTime).Seconds(),
			}, nil
		}
		cm.policyMu.RLock()
		currentPolicy = cm.policy
		cm.policyMu.RUnlock()
	}

	if currentPolicy == nil || len(currentPolicy.Directives) == 0 {
		cm.logger.Debug("No directives in current policy, skipping evaluation")
		return &models.IntegrationData{
			Name:          integrationName,
			Enabled:       true,
			Data:          &models.ConfigManagementData{CurrentHash: cm.policyHash},
			CollectedAt:   utils.GetCurrentTimeUTC(),
			ExecutionTime: time.Since(startTime).Seconds(),
		}, nil
	}

	// Evaluate all directives
	report := cm.executor.Evaluate(ctx, currentPolicy)

	data := &models.ConfigManagementData{
		Report:      report,
		CurrentHash: cm.policyHash,
	}

	cm.logger.WithFields(logrus.Fields{
		"directives":    report.TotalDirectives,
		"compliant":     report.Compliant,
		"non_compliant": report.NonCompliant,
		"repaired":      report.Repaired,
		"errors":        report.Errors,
		"score":         fmt.Sprintf("%.1f%%", report.Score),
	}).Info("Configuration management evaluation completed")

	return &models.IntegrationData{
		Name:          integrationName,
		Enabled:       true,
		Data:          data,
		CollectedAt:   utils.GetCurrentTimeUTC(),
		ExecutionTime: time.Since(startTime).Seconds(),
	}, nil
}

// SetPolicy replaces the current policy and persists it to disk.
func (cm *Integration) SetPolicy(policy *models.ConfigPolicy) error {
	cm.policyMu.Lock()
	defer cm.policyMu.Unlock()

	cm.policy = policy

	// Compute hash
	raw, err := json.Marshal(policy)
	if err != nil {
		return fmt.Errorf("failed to marshal policy for hashing: %w", err)
	}
	h := sha256.Sum256(raw)
	cm.policyHash = fmt.Sprintf("%x", h)

	// Persist to disk
	return cm.savePolicyCache(raw)
}

// GetPolicyHash returns the SHA-256 hash of the last-applied policy.
func (cm *Integration) GetPolicyHash() string {
	cm.policyMu.RLock()
	defer cm.policyMu.RUnlock()
	return cm.policyHash
}

// loadCachedPolicy reads the policy from the on-disk cache.
func (cm *Integration) loadCachedPolicy() error {
	path := filepath.Join(policyCacheDir, policyCacheFile)

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read cached policy: %w", err)
	}

	var policy models.ConfigPolicy
	if err := json.Unmarshal(data, &policy); err != nil {
		return fmt.Errorf("failed to unmarshal cached policy: %w", err)
	}

	h := sha256.Sum256(data)
	cm.policyMu.Lock()
	cm.policy = &policy
	cm.policyHash = fmt.Sprintf("%x", h)
	cm.policyMu.Unlock()

	cm.logger.WithFields(logrus.Fields{
		"policy_id":  policy.PolicyID,
		"directives": len(policy.Directives),
		"hash":       cm.policyHash[:12],
	}).Debug("Loaded cached policy from disk")

	return nil
}

// savePolicyCache writes the raw policy JSON to disk.
func (cm *Integration) savePolicyCache(raw []byte) error {
	if err := os.MkdirAll(policyCacheDir, 0750); err != nil {
		return fmt.Errorf("failed to create policy cache directory: %w", err)
	}

	path := filepath.Join(policyCacheDir, policyCacheFile)

	// Atomic write: temp file → rename
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0640); err != nil {
		return fmt.Errorf("failed to write policy cache temp file: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("failed to rename policy cache file: %w", err)
	}

	cm.logger.Debug("Policy cached to disk")
	return nil
}
