// Package system — syslog.go parses system logs (journald / syslog / FreeBSD)
// for error-level entries since the last check-in and returns them as
// logbuffer.Entry values that the agent ships alongside its own logs.
package system

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"patchmon-agent/internal/logbuffer"
)

// DefaultSyslogLimit caps the number of entries returned per check-in so a
// noisy host doesn't swamp the server or the agent_logs table.
const DefaultSyslogLimit = 200

// syslogSeverityRe matches the common "<facility>.<severity>" token that
// rsyslog / syslog-ng write, e.g. "kern.err", "daemon.crit".
var syslogSeverityRe = regexp.MustCompile(`\.(emerg|alert|crit|err)\b`)

// journaldTimeFmt is the format used by `journalctl --output=short-iso`.
const journaldTimeFmt = "2006-01-02T15:04:05-0700"

// journaldTimeFmtMicro covers the microsecond variant some systemd versions emit.
const journaldTimeFmtMicro = "2006-01-02T15:04:05.000000-0700"

// CollectSystemErrors returns error / critical / alert / emergency log lines
// from journald (preferred) or traditional syslog files since `since`.
// If `since` is zero, defaults to the last 15 minutes.
func (d *Detector) CollectSystemErrors(ctx context.Context, since time.Time, limit int) []logbuffer.Entry {
	if limit <= 0 {
		limit = DefaultSyslogLimit
	}
	if since.IsZero() {
		since = time.Now().Add(-15 * time.Minute)
	}

	// Try journald first (most modern Linux distros)
	entries := d.collectFromJournald(ctx, since, limit)
	if entries != nil {
		return entries
	}

	// Fallback: traditional syslog files
	entries = d.collectFromSyslogFiles(ctx, since, limit)
	if entries != nil {
		return entries
	}

	// FreeBSD: /var/log/messages
	return d.collectFromFreeBSDLog(ctx, since, limit)
}

// ── journald ────────────────────────────────────────────────────────────────

func (d *Detector) collectFromJournald(ctx context.Context, since time.Time, limit int) []logbuffer.Entry {
	// Check if journalctl is available
	if _, err := exec.LookPath("journalctl"); err != nil {
		return nil
	}

	sinceStr := since.Format("2006-01-02 15:04:05")
	args := []string{
		"--no-pager",
		"--output=short-iso",
		"--priority=err",         // err and above (err, crit, alert, emerg)
		"--since", sinceStr,
		"--lines", fmt.Sprintf("%d", limit),
	}

	cmd := exec.CommandContext(ctx, "journalctl", args...)
	out, err := cmd.Output()
	if err != nil {
		d.logger.WithError(err).Debug("journalctl failed, will try syslog files")
		return nil
	}

	return d.parseJournaldOutput(string(out), limit)
}

func (d *Detector) parseJournaldOutput(output string, limit int) []logbuffer.Entry {
	scanner := bufio.NewScanner(strings.NewReader(output))
	var entries []logbuffer.Entry

	for scanner.Scan() && len(entries) < limit {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "-- ") {
			continue // skip journal header lines like "-- No entries --" or "-- Logs begin at ..."
		}

		ts, unit, msg := parseJournaldLine(line)
		if msg == "" {
			continue
		}

		entries = append(entries, logbuffer.Entry{
			Timestamp: ts,
			Level:     "error",
			Source:    "syslog",
			Message:   msg,
			Metadata:  map[string]string{"unit": unit},
		})
	}

	if len(entries) == 0 {
		return nil
	}
	return entries
}

// parseJournaldLine splits a short-iso journald line:
//
//	2024-06-15T10:23:01+0000 myhost kernel: some error message
func parseJournaldLine(line string) (ts time.Time, unit, msg string) {
	// Minimum viable: timestamp hostname unit[pid]: message
	// The timestamp ends at the first space.
	parts := strings.SplitN(line, " ", 4)
	if len(parts) < 4 {
		// Try 3-part (no hostname in some outputs)
		if len(parts) == 3 {
			ts = tryParseJournaldTime(parts[0])
			unit = strings.TrimSuffix(parts[1], ":")
			msg = parts[2]
			return
		}
		return time.Time{}, "", ""
	}

	ts = tryParseJournaldTime(parts[0])
	// parts[1] = hostname, parts[2] = unit/process, parts[3] = message
	unit = strings.TrimSuffix(parts[2], ":")
	// Strip trailing pid bracket e.g. "sshd[1234]:" → "sshd"
	if idx := strings.Index(unit, "["); idx > 0 {
		unit = unit[:idx]
	}
	msg = parts[3]
	return
}

func tryParseJournaldTime(s string) time.Time {
	if t, err := time.Parse(journaldTimeFmt, s); err == nil {
		return t.UTC()
	}
	if t, err := time.Parse(journaldTimeFmtMicro, s); err == nil {
		return t.UTC()
	}
	return time.Now().UTC()
}

// ── traditional syslog ──────────────────────────────────────────────────────

func (d *Detector) collectFromSyslogFiles(ctx context.Context, since time.Time, limit int) []logbuffer.Entry {
	// Common syslog paths
	paths := []string{"/var/log/syslog", "/var/log/messages"}
	for _, path := range paths {
		entries := d.parseSyslogFile(ctx, path, since, limit)
		if entries != nil {
			return entries
		}
	}
	return nil
}

func (d *Detector) parseSyslogFile(ctx context.Context, path string, since time.Time, limit int) []logbuffer.Entry {
	// Use grep to filter error-level lines efficiently (avoids reading entire log)
	// grep for common error-level keywords: error, err, crit, alert, emerg, panic, fatal
	args := []string{"-i", "-E", `\b(error|err\b|crit|critical|alert|emerg|emergency|panic|fatal)\b`, path}

	cmd := exec.CommandContext(ctx, "grep", args...)
	out, err := cmd.Output()
	if err != nil {
		// grep returns exit 1 when no matches (not a real error)
		return nil
	}

	return d.filterSyslogLines(string(out), since, limit)
}

func (d *Detector) filterSyslogLines(output string, since time.Time, limit int) []logbuffer.Entry {
	scanner := bufio.NewScanner(strings.NewReader(output))
	var entries []logbuffer.Entry
	year := time.Now().Year()

	for scanner.Scan() && len(entries) < limit {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		ts, unit, msg := parseSyslogLine(line, year)
		if msg == "" {
			continue
		}

		// Only include lines since the cutoff
		if !ts.IsZero() && ts.Before(since) {
			continue
		}

		entries = append(entries, logbuffer.Entry{
			Timestamp: ts,
			Level:     "error",
			Source:    "syslog",
			Message:   msg,
			Metadata:  map[string]string{"unit": unit},
		})
	}

	if len(entries) == 0 {
		return nil
	}
	return entries
}

// parseSyslogLine parses a traditional syslog line:
//
//	Jun 15 10:23:01 myhost kernel: some error message
func parseSyslogLine(line string, year int) (ts time.Time, unit, msg string) {
	// Traditional syslog format: "Mon DD HH:MM:SS hostname process[pid]: message"
	// Need at least 5 space-separated fields
	parts := strings.SplitN(line, " ", 6)
	if len(parts) < 6 {
		return time.Time{}, "", line
	}

	// Parse timestamp (first 3 fields: "Jun 15 10:23:01")
	tsStr := fmt.Sprintf("%d %s %s %s", year, parts[0], parts[1], parts[2])
	if t, err := time.Parse("2006 Jan 2 15:04:05", tsStr); err == nil {
		ts = t.UTC()
	}

	// parts[3] = hostname, parts[4] = process, parts[5] = message
	unit = strings.TrimSuffix(parts[4], ":")
	if idx := strings.Index(unit, "["); idx > 0 {
		unit = unit[:idx]
	}
	msg = parts[5]
	return
}

// ── FreeBSD ─────────────────────────────────────────────────────────────────

func (d *Detector) collectFromFreeBSDLog(ctx context.Context, since time.Time, limit int) []logbuffer.Entry {
	if !d.isFreeBSD() {
		return nil
	}
	return d.parseSyslogFile(ctx, "/var/log/messages", since, limit)
}
