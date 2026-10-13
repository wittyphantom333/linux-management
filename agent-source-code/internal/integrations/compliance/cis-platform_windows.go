//go:build windows

package compliance

import (
	"fmt"
	"strconv"
	"strings"

	windows "golang.org/x/sys/windows"
	wregistry "golang.org/x/sys/windows/registry"
	svc "golang.org/x/sys/windows/svc"
	mgr "golang.org/x/sys/windows/svc/mgr"
)

// cisRegistryPathToHive maps a registry path root (e.g. "HKLM") to the
// corresponding windows/registry root key and returns the remaining subkey.
func cisRegistryPathToHive(path string) (subkey string, hive wregistry.Key, ok bool) {
	p := strings.ReplaceAll(path, "/", "\\")
	parts := strings.SplitN(p, `\`, 2)
	root := strings.ToUpper(strings.TrimSpace(parts[0]))
	sub := ""
	if len(parts) == 2 {
		sub = parts[1]
	}
	switch root {
	case "HKLM", "HKEY_LOCAL_MACHINE":
		hive = wregistry.LOCAL_MACHINE
	case "HKCU", "HKEY_CURRENT_USER":
		hive = wregistry.CURRENT_USER
	case "HKCC", "HKEY_CURRENT_CONFIG":
		hive = wregistry.CURRENT_CONFIG
	case "HKCR", "HKEY_CLASSES_ROOT":
		hive = wregistry.CLASSES_ROOT
	case "HKU", "HKEY_USERS":
		hive = wregistry.USERS
	default:
		return "", 0, false
	}
	return strings.TrimSuffix(sub, `\`), hive, true
}

// cisRegistryValue reads a registry value using the native Windows API.
// It returns the value as a string (DWORDs as their decimal value), whether
// the key/value was found, and any hard error (e.g. access denied). A missing
// key or value is returned as found=false with err==nil, so callers can
// distinguish "not set" from "failed to read".
func cisRegistryValue(path, name string) (value string, found bool, err error) {
	sub, hive, ok := cisRegistryPathToHive(path)
	if !ok {
		return "", false, fmt.Errorf("invalid registry path: %q", path)
	}

	k, oerr := wregistry.OpenKey(hive, sub, wregistry.QUERY_VALUE)
	if oerr != nil {
		if oerr == wregistry.ErrNotExist {
			return "", false, nil // key not present
		}
		return "", false, oerr
	}
	defer k.Close()

	if name == "" {
		return "", true, nil // key exists (existence check)
	}

	v, gerr := cisRegistryValueToString(k, name)
	if gerr != nil {
		if gerr == wregistry.ErrNotExist {
			return "", false, nil // value not set
		}
		return "", false, gerr
	}
	return v, true, nil
}

// cisRegistryValueToString converts a registry value to a string, trying the
// numeric, string, and multi-string value types in turn.
func cisRegistryValueToString(k wregistry.Key, name string) (string, error) {
	// Numeric value (DWORD/QWORD) — most CIS checks compare numeric policy values.
	if n, _, err := k.GetIntegerValue(name); err == nil {
		return strconv.FormatUint(n, 10), nil
	}
	// Plain string (REG_SZ / REG_EXPAND_SZ).
	if s, _, err := k.GetStringValue(name); err == nil {
		return s, nil
	}
	// Multi-string (REG_MULTI_SZ), e.g. allowed-software lists.
	if ss, _, err := k.GetStringsValue(name); err == nil {
		return strings.Join(ss, ","), nil
	}
	return "", wregistry.ErrNotExist
}

// cisServiceState returns the current state of a service ("running",
// "stopped", "paused", "pending") using the native Service Control Manager
// API. A service that is not installed returns found=false with err==nil.
func cisServiceState(name string) (state string, found bool, err error) {
	m, cerr := mgr.Connect()
	if cerr != nil {
		return "", false, cerr
	}
	defer m.Disconnect()

	s, lerr := m.OpenService(name)
	if lerr != nil {
		if lerr == windows.ERROR_SERVICE_DOES_NOT_EXIST {
			return "", false, nil
		}
		return "", false, lerr
	}
	defer s.Close()

	st, qerr := s.Query()
	if qerr != nil {
		return "", false, qerr
	}
	return cisStateString(st.State), true, nil
}

// cisStateString renders a service state as a lowercase token suitable for
// comparison against the rule data ("running", "stopped", ...).
func cisStateString(st svc.State) string {
	switch st {
	case svc.Running:
		return "running"
	case svc.Paused:
		return "paused"
	case svc.Stopped:
		return "stopped"
	case svc.StartPending, svc.StopPending, svc.ContinuePending, svc.PausePending:
		return "pending"
	default:
		return "unknown"
	}
}
