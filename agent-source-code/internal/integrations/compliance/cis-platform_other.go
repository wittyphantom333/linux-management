//go:build !windows

package compliance

import "fmt"

// cisRegistryValue and cisServiceState are no-ops off Windows. The Windows CIS
// scanner reports unavailable (IsAvailable()==false) on other platforms, so
// these are never reached, but they must exist so the package builds on
// Linux/macOS.

func cisRegistryValue(path, name string) (string, bool, error) {
	return "", false, fmt.Errorf("registry access not supported on this platform")
}

func cisServiceState(name string) (string, bool, error) {
	return "", false, fmt.Errorf("service control manager not supported on this platform")
}
