// Package logbuffer provides a logrus hook that captures log entries into
// a bounded ring buffer. The buffered entries can be drained and shipped
// to the PatchMon server for remote viewing in the UI.
package logbuffer

import (
	"fmt"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// Entry is a single captured log entry ready for serialisation.
type Entry struct {
	Timestamp time.Time         `json:"timestamp"`
	Level     string            `json:"level"`
	Source    string            `json:"source,omitempty"`
	Message   string            `json:"message"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// Hook implements logrus.Hook, storing entries in a bounded ring buffer.
type Hook struct {
	mu      sync.Mutex
	entries []Entry
	maxSize int
	// minLevel controls the minimum severity captured (e.g. logrus.DebugLevel captures everything).
	minLevel logrus.Level
}

// New creates a Hook that buffers up to maxSize entries at or above minLevel.
func New(maxSize int, minLevel logrus.Level) *Hook {
	if maxSize <= 0 {
		maxSize = 2000
	}
	return &Hook{
		entries:  make([]Entry, 0, maxSize),
		maxSize:  maxSize,
		minLevel: minLevel,
	}
}

// Levels returns the logrus levels this hook should fire for.
func (h *Hook) Levels() []logrus.Level {
	levels := make([]logrus.Level, 0)
	for _, l := range logrus.AllLevels {
		if l <= h.minLevel {
			levels = append(levels, l)
		}
	}
	return levels
}

// Fire is called by logrus for each log entry matching the hook's levels.
func (h *Hook) Fire(entry *logrus.Entry) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Derive a "source" from known field names (integration, component, module)
	source := ""
	for _, key := range []string{"integration", "component", "module", "source"} {
		if v, ok := entry.Data[key]; ok {
			source = toString(v)
			break
		}
	}

	// Collect remaining fields as metadata (skip the source key)
	var metadata map[string]string
	if len(entry.Data) > 0 {
		metadata = make(map[string]string, len(entry.Data))
		for k, v := range entry.Data {
			if k == "source" || k == "integration" || k == "component" || k == "module" {
				continue
			}
			metadata[k] = toString(v)
		}
		if len(metadata) == 0 {
			metadata = nil
		}
	}

	e := Entry{
		Timestamp: entry.Time.UTC(),
		Level:     entry.Level.String(),
		Source:    source,
		Message:   entry.Message,
		Metadata:  metadata,
	}

	if len(h.entries) >= h.maxSize {
		// Drop oldest entry (ring buffer behaviour)
		h.entries = append(h.entries[1:], e)
	} else {
		h.entries = append(h.entries, e)
	}

	return nil
}

// Drain returns all buffered entries and clears the buffer.
// The caller owns the returned slice.
func (h *Hook) Drain() []Entry {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.entries) == 0 {
		return nil
	}

	out := h.entries
	h.entries = make([]Entry, 0, h.maxSize)
	return out
}

// Len returns the current number of buffered entries.
func (h *Hook) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.entries)
}

func toString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case error:
		return val.Error()
	default:
		return fmt.Sprintf("%v", val)
	}
}
