// Package client provides HTTP client functionality for communicating with the Monux server
package client

import (
	"context"
	"crypto/tls"
	"fmt"
	"time"

	"patchmon-agent/internal/config"
	"patchmon-agent/internal/logbuffer"
	"patchmon-agent/internal/utils"
	"patchmon-agent/pkg/models"

	"github.com/go-resty/resty/v2"
	"github.com/sirupsen/logrus"
)

// Client handles HTTP communications with the Monux server
type Client struct {
	client      *resty.Client
	config      *models.Config
	credentials *models.Credentials
	logger      *logrus.Logger
}

// truncateResponse truncates a response string to prevent leaking sensitive data in logs
// SECURITY: Error messages should not include full response bodies which may contain
// sensitive information like tokens, internal paths, or system details
func truncateResponse(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "... (truncated)"
}

// New creates a new HTTP client
func New(configMgr *config.Manager, logger *logrus.Logger) *Client {
	client := resty.New()
	client.SetTimeout(30 * time.Second)
	client.SetRetryCount(3)
	client.SetRetryWaitTime(2 * time.Second)

	// Configure Resty to use our logger
	client.SetLogger(logger)

	// Configure TLS based on skip_ssl_verify setting
	// SECURITY WARNING: Disabling TLS verification exposes the agent to MITM attacks
	cfg := configMgr.GetConfig()
	if cfg.SkipSSLVerify {
		// SECURITY: Block skip_ssl_verify in production environments
		if utils.IsProductionEnvironment() {
			logger.Error("╔══════════════════════════════════════════════════════════════════╗")
			logger.Error("║  SECURITY ERROR: skip_ssl_verify is BLOCKED in production!       ║")
			logger.Error("║  Set PATCHMON_ENV to 'development' to enable insecure mode.      ║")
			logger.Error("║  This setting cannot be used when PATCHMON_ENV=production        ║")
			logger.Error("╚══════════════════════════════════════════════════════════════════╝")
			logger.Fatal("Refusing to start with skip_ssl_verify=true in production environment")
		}

		logger.Error("╔══════════════════════════════════════════════════════════════════╗")
		logger.Error("║  SECURITY WARNING: TLS certificate verification is DISABLED!     ║")
		logger.Error("║  This exposes the agent to man-in-the-middle attacks.            ║")
		logger.Error("║  An attacker could intercept and modify communications.          ║")
		logger.Error("║  Do NOT use skip_ssl_verify=true in production environments!     ║")
		logger.Error("╚══════════════════════════════════════════════════════════════════╝")
		client.SetTLSClientConfig(&tls.Config{
			InsecureSkipVerify: true,
		})
	}

	return &Client{
		client:      client,
		config:      cfg,
		credentials: configMgr.GetCredentials(),
		logger:      logger,
	}
}

// Ping sends a ping request to the server
func (c *Client) Ping(ctx context.Context) (*models.PingResponse, error) {
	url := fmt.Sprintf("%s/api/%s/hosts/ping", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"method": "POST",
	}).Debug("Sending ping request to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetResult(&models.PingResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("ping request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from ping request")
		return nil, fmt.Errorf("ping request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.PingResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendUpdate sends package update information to the server
func (c *Client) SendUpdate(ctx context.Context, payload *models.ReportPayload) (*models.UpdateResponse, error) {
	url := fmt.Sprintf("%s/api/%s/hosts/update", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"method": "POST",
	}).Debug("Sending update to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(payload).
		SetResult(&models.UpdateResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("update request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from update request")
		return nil, fmt.Errorf("update request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.UpdateResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// GetUpdateInterval gets the current update interval from server
func (c *Client) GetUpdateInterval(ctx context.Context) (*models.UpdateIntervalResponse, error) {
	url := fmt.Sprintf("%s/api/%s/settings/update-interval", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.Debug("Getting update interval from server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetResult(&models.UpdateIntervalResponse{}).
		Get(url)

	if err != nil {
		return nil, fmt.Errorf("update interval request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from update interval request")
		return nil, fmt.Errorf("update interval request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.UpdateIntervalResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendDockerData sends Docker integration data to the server
func (c *Client) SendDockerData(ctx context.Context, payload *models.DockerPayload) (*models.DockerResponse, error) {
	url := fmt.Sprintf("%s/api/%s/integrations/docker", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"method": "POST",
	}).Debug("Sending Docker data to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(payload).
		SetResult(&models.DockerResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("docker data request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from docker data request")
		return nil, fmt.Errorf("docker data request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.DockerResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// GetIntegrationStatus gets the current integration status from server
func (c *Client) GetIntegrationStatus(ctx context.Context) (*models.IntegrationStatusResponse, error) {
	url := fmt.Sprintf("%s/api/%s/hosts/integrations", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.Debug("Getting integration status from server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetResult(&models.IntegrationStatusResponse{}).
		Get(url)

	if err != nil {
		return nil, fmt.Errorf("integration status request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from integration status request")
		return nil, fmt.Errorf("integration status request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.IntegrationStatusResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendIntegrationSetupStatus sends the setup status of an integration to the server
func (c *Client) SendIntegrationSetupStatus(ctx context.Context, status *models.IntegrationSetupStatus) error {
	url := fmt.Sprintf("%s/api/%s/hosts/integration-status", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"integration": status.Integration,
		"enabled":     status.Enabled,
		"status":      status.Status,
	}).Info("Sending integration setup status to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(status).
		Post(url)

	if err != nil {
		return fmt.Errorf("integration setup status request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		return fmt.Errorf("integration setup status request failed with status %d", resp.StatusCode())
	}

	c.logger.Info("Integration setup status sent successfully")
	return nil
}

// SendDockerStatusEvent sends a real-time Docker container status event via WebSocket
func (c *Client) SendDockerStatusEvent(event *models.DockerStatusEvent) error {
	// This will be called by the WebSocket connection in the serve command
	// For now, we'll just log it
	c.logger.WithFields(logrus.Fields{
		"type":         event.Type,
		"container_id": event.ContainerID,
		"name":         event.Name,
		"status":       event.Status,
	}).Debug("Docker status event")
	return nil
}

// SendConfigManagementData sends configuration management compliance data to the server
func (c *Client) SendConfigManagementData(ctx context.Context, payload *models.ConfigManagementPayload) (*models.ConfigManagementResponse, error) {
	url := fmt.Sprintf("%s/api/%s/configmanagement/agent/report", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"method": "POST",
	}).Debug("Sending config management data to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(payload).
		SetResult(&models.ConfigManagementResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("config management data request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from config management data request")
		return nil, fmt.Errorf("config management data request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.ConfigManagementResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// FetchConfigPolicy fetches the computed configuration policy for this agent from the server
func (c *Client) FetchConfigPolicy(ctx context.Context, currentHash string) (*models.ConfigPolicyResponse, error) {
	url := fmt.Sprintf("%s/api/%s/configmanagement/agent/policy", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.Debug("Fetching config management policy from server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetQueryParam("hash", currentHash).
		SetResult(&models.ConfigPolicyResponse{}).
		Get(url)

	if err != nil {
		return nil, fmt.Errorf("config policy fetch failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from config policy request")
		return nil, fmt.Errorf("config policy fetch failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.ConfigPolicyResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendComplianceData sends compliance scan data to the server
func (c *Client) SendComplianceData(ctx context.Context, payload *models.CompliancePayload) (*models.ComplianceResponse, error) {
	url := fmt.Sprintf("%s/api/%s/compliance/scans", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"method": "POST",
		"scans":  len(payload.Scans),
	}).Debug("Sending compliance data to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(payload).
		SetResult(&models.ComplianceResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("compliance data request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		c.logger.WithField("response", resp.String()).Debug("Full error response from compliance data request")
		return nil, fmt.Errorf("compliance data request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.ComplianceResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// FetchPendingPatchJob checks with the server for any pending patch job for this agent.
func (c *Client) FetchPendingPatchJob(ctx context.Context) (*models.PatchPendingResponse, error) {
	url := fmt.Sprintf("%s/api/%s/patch-management/agent/pending", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.Debug("Checking for pending patch jobs")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetResult(&models.PatchPendingResponse{}).
		Get(url)

	if err != nil {
		return nil, fmt.Errorf("fetch pending patch job failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("fetch pending patch job failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.PatchPendingResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendPatchReport sends the patch execution results to the server.
func (c *Client) SendPatchReport(ctx context.Context, report *models.PatchReport) (*models.PatchReportResponse, error) {
	url := fmt.Sprintf("%s/api/%s/patch-management/agent/report", c.config.PatchmonServer, c.config.APIVersion)

	c.logger.WithFields(logrus.Fields{
		"url":    url,
		"job_id": report.JobID,
		"status": report.Status,
	}).Debug("Sending patch report to server")

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(report).
		SetResult(&models.PatchReportResponse{}).
		Post(url)

	if err != nil {
		return nil, fmt.Errorf("patch report request failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("patch report request failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.PatchReportResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendPatchStatus sends a status update for a patch job.
func (c *Client) SendPatchStatus(ctx context.Context, update *models.PatchStatusUpdate) (*models.PatchStatusResponse, error) {
	url := fmt.Sprintf("%s/api/%s/patch-management/agent/status", c.config.PatchmonServer, c.config.APIVersion)

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(update).
		SetResult(&models.PatchStatusResponse{}).
		Put(url)

	if err != nil {
		return nil, fmt.Errorf("patch status update failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		return nil, fmt.Errorf("patch status update failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	result, ok := resp.Result().(*models.PatchStatusResponse)
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return result, nil
}

// SendAgentLogs ships buffered log entries to the server for remote viewing.
func (c *Client) SendAgentLogs(ctx context.Context, entries []logbuffer.Entry) error {
	if len(entries) == 0 {
		return nil
	}

	url := fmt.Sprintf("%s/api/%s/agent-logs/ingest", c.config.PatchmonServer, c.config.APIVersion)

	body := map[string]interface{}{
		"entries": entries,
	}

	resp, err := c.client.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetHeader("X-API-ID", c.credentials.APIID).
		SetHeader("X-API-KEY", c.credentials.APIKey).
		SetBody(body).
		Post(url)

	if err != nil {
		return fmt.Errorf("agent log shipping failed: %w", err)
	}

	if resp.StatusCode() != 200 {
		return fmt.Errorf("agent log shipping failed with status %d: %s", resp.StatusCode(), truncateResponse(resp.String(), 200))
	}

	c.logger.WithField("entries", len(entries)).Debug("Agent logs shipped to server")
	return nil
}
