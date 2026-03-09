package configmanagement

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

const (
	scheduleStateFile = "schedule_state.json"
)

// ScheduleState tracks per-directive execution history for scheduling.
type ScheduleState struct {
	mu      sync.Mutex
	logger  *logrus.Logger
	entries map[string]*ScheduleEntry // keyed by directive ID
}

// ScheduleEntry records when a directive was last run and with what version.
type ScheduleEntry struct {
	DirectiveID      string    `json:"directive_id"`
	RuleID           string    `json:"rule_id,omitempty"`           // Track per rule+directive pair
	DirectiveVersion string    `json:"directive_version"`           // For "once" mode: re-run when version changes
	TechniqueVersion string    `json:"technique_version,omitempty"` // Re-run when pinned technique version changes
	LastStatus       string    `json:"last_status,omitempty"`       // Last run outcome ("compliant", "error", etc.)
	LastRunAt        time.Time `json:"last_run_at"`
	RunCount         int       `json:"run_count"`
}

// NewScheduleState creates a new schedule state manager and loads persisted state.
func NewScheduleState(logger *logrus.Logger) *ScheduleState {
	ss := &ScheduleState{
		logger:  logger,
		entries: make(map[string]*ScheduleEntry),
	}
	ss.load()
	return ss
}

// entryKey builds the schedule state key for a policy item.
// We key on ruleID:directiveID so the same directive in different rules
// (with different schedules) is tracked independently.
func entryKey(item models.ConfigPolicyItem) string {
	if item.RuleID != "" {
		return item.RuleID + ":" + item.Directive.ID
	}
	return item.Directive.ID // Fallback for legacy state
}

// isSuccessStatus returns true for statuses that count as a successful completion.
func isSuccessStatus(status string) bool {
	switch status {
	case "compliant", "success", "repaired", "audit_compliant":
		return true
	}
	return false
}

// ShouldRun determines whether a directive should be evaluated now based on its schedule.
func (ss *ScheduleState) ShouldRun(item models.ConfigPolicyItem) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	sched := item.Schedule
	key := entryKey(item)
	dirVersion := item.Directive.Version
	techVersion := item.Directive.TechniqueVersion

	switch sched.RunSchedule {
	case "always", "":
		return true

	case "once":
		entry, exists := ss.entries[key]
		if !exists {
			return true // Never run before
		}
		// Re-run if directive version or technique version changed
		if entry.DirectiveVersion != dirVersion {
			return true
		}
		if entry.TechniqueVersion != techVersion {
			return true
		}
		// Re-run if the last attempt was not successful
		if !isSuccessStatus(entry.LastStatus) {
			ss.logger.WithFields(logrus.Fields{
				"directive": item.Directive.Name,
				"last_status": entry.LastStatus,
			}).Debug("Once-scheduled directive re-running after non-success")
			return true
		}
		return false // Successfully completed for this version

	case "interval":
		interval := sched.ScheduleInterval
		if interval <= 0 {
			return true // Misconfigured, run anyway
		}
		entry, exists := ss.entries[key]
		if !exists {
			return true // Never run before
		}
		elapsed := time.Since(entry.LastRunAt)
		return elapsed >= time.Duration(interval)*time.Minute

	case "cron":
		if sched.ScheduleCron == "" {
			return true // Misconfigured, run anyway
		}
		entry, exists := ss.entries[key]
		if !exists {
			return true // Never run before
		}
		return ss.cronShouldRun(sched.ScheduleCron, sched.ScheduleTimezone, entry.LastRunAt)

	default:
		ss.logger.WithField("schedule", sched.RunSchedule).Warn("Unknown run_schedule, defaulting to always")
		return true
	}
}

// RecordRun records that a directive was just evaluated, including its outcome status.
func (ss *ScheduleState) RecordRun(item models.ConfigPolicyItem, status string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	key := entryKey(item)
	entry, exists := ss.entries[key]
	if !exists {
		entry = &ScheduleEntry{
			DirectiveID: item.Directive.ID,
			RuleID:      item.RuleID,
		}
		ss.entries[key] = entry
	}

	entry.DirectiveVersion = item.Directive.Version
	entry.TechniqueVersion = item.Directive.TechniqueVersion
	entry.LastStatus = status
	entry.LastRunAt = time.Now().UTC()
	entry.RunCount++

	ss.save()
}

// cronShouldRun does a simplified check: has a cron window passed since lastRun?
// Supports standard 5-field cron: minute hour day-of-month month day-of-week
// This is a best-effort evaluation — for complex cron, we check if the current
// time matches (within a 10-minute window) and we haven't run since the last match.
func (ss *ScheduleState) cronShouldRun(cronExpr, tz string, lastRun time.Time) bool {
	loc := time.UTC
	if tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}

	now := time.Now().In(loc)

	// Parse the 5 fields
	fields := strings.Fields(cronExpr)
	if len(fields) != 5 {
		ss.logger.WithField("cron", cronExpr).Warn("Invalid cron expression (need 5 fields), running anyway")
		return true
	}

	// Check if current time matches the cron pattern
	if !cronFieldMatches(fields[0], now.Minute()) {
		return false
	}
	if !cronFieldMatches(fields[1], now.Hour()) {
		return false
	}
	if !cronFieldMatches(fields[2], now.Day()) {
		return false
	}
	if !cronFieldMatches(fields[3], int(now.Month())) {
		return false
	}
	if !cronFieldMatches(fields[4], int(now.Weekday())) {
		return false
	}

	// Current time matches — but have we already run in this window?
	// Consider a 10-minute window to avoid re-running during the same cron slot
	if lastRun.In(loc).After(now.Add(-10 * time.Minute)) {
		return false
	}

	return true
}

// cronFieldMatches checks if a value matches a cron field expression.
// Supports: * (any), exact numbers, comma-separated lists, ranges (1-5), step (*/5).
func cronFieldMatches(field string, value int) bool {
	if field == "*" {
		return true
	}

	// Handle step: */N or N-M/S
	if strings.Contains(field, "/") {
		parts := strings.SplitN(field, "/", 2)
		step, err := strconv.Atoi(parts[1])
		if err != nil || step <= 0 {
			return false
		}
		if parts[0] == "*" {
			return value%step == 0
		}
		// Range with step
		rangeParts := strings.SplitN(parts[0], "-", 2)
		if len(rangeParts) == 2 {
			low, _ := strconv.Atoi(rangeParts[0])
			high, _ := strconv.Atoi(rangeParts[1])
			if value < low || value > high {
				return false
			}
			return (value-low)%step == 0
		}
		return false
	}

	// Handle comma-separated values and ranges
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "-") {
			rangeParts := strings.SplitN(part, "-", 2)
			low, _ := strconv.Atoi(rangeParts[0])
			high, _ := strconv.Atoi(rangeParts[1])
			if value >= low && value <= high {
				return true
			}
		} else {
			num, err := strconv.Atoi(part)
			if err == nil && num == value {
				return true
			}
		}
	}

	return false
}

// load reads persisted schedule state from disk.
func (ss *ScheduleState) load() {
	path := filepath.Join(policyCacheDir, scheduleStateFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return // No state file yet; that's fine
	}

	var entries map[string]*ScheduleEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		ss.logger.WithError(err).Warn("Failed to parse schedule state file, starting fresh")
		return
	}

	ss.entries = entries
	ss.logger.WithField("directives_tracked", len(entries)).Debug("Loaded schedule state from disk")
}

// save writes schedule state to disk.
func (ss *ScheduleState) save() {
	path := filepath.Join(policyCacheDir, scheduleStateFile)

	data, err := json.MarshalIndent(ss.entries, "", "  ")
	if err != nil {
		ss.logger.WithError(err).Warn("Failed to marshal schedule state")
		return
	}

	if err := os.MkdirAll(policyCacheDir, 0750); err != nil {
		ss.logger.WithError(err).Warn("Failed to create schedule state directory")
		return
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0640); err != nil {
		ss.logger.WithError(err).Warn("Failed to write schedule state temp file")
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		ss.logger.WithError(err).Warn("Failed to rename schedule state file")
		return
	}

	ss.logger.Debug(fmt.Sprintf("Schedule state saved (%d directives tracked)", len(ss.entries)))
}
