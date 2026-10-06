// Package hashing provides canonical hash functions for agent report sections.
// These hashes are used to detect changes between check-ins so the server can
// tell the agent which sections are stale and need re-uploading.
package hashing

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

// PackagesHash returns a hex SHA-256 digest of the canonical JSON encoding
// of the package list. The encoding is deterministic: sorted keys, no extra
// whitespace, and only the fields that matter for change detection are kept.
func PackagesHash(packages any) (string, error) {
	if packages == nil {
		return hashString("[]"), nil
	}
	pkgs, ok := packages.([]any)
	if !ok {
		// Fallback: marshal directly
		data, err := json.Marshal(packages)
		if err != nil {
			return "", fmt.Errorf("marshal packages: %w", err)
		}
		return hashBytes(data), nil
	}
	if len(pkgs) == 0 {
		return hashString("[]"), nil
	}
	data, err := json.Marshal(pkgs)
	if err != nil {
		return "", fmt.Errorf("marshal packages: %w", err)
	}
	return hashBytes(data), nil
}

// ReposHash returns a hex SHA-256 digest of the canonical JSON encoding of
// the repository list.
func ReposHash(repos []interface{}) (string, error) {
	if len(repos) == 0 {
		return hashString("[]"), nil
	}
	data, err := json.Marshal(repos)
	if err != nil {
		return "", fmt.Errorf("marshal repos: %w", err)
	}
	return hashBytes(data), nil
}

// InterfacesHash returns a hex SHA-256 digest of the canonical JSON encoding
// of the network interface list.
func InterfacesHash(ifaces []interface{}) (string, error) {
	if len(ifaces) == 0 {
		return hashString("[]"), nil
	}
	data, err := json.Marshal(ifaces)
	if err != nil {
		return "", fmt.Errorf("marshal interfaces: %w", err)
	}
	return hashBytes(data), nil
}

// HostnameHash returns a hex SHA-256 digest of the hostname string.
func HostnameHash(hostname string) string {
	return hashString(hostname)
}

// DockerHash returns a hex SHA-256 digest of the docker data payload.
func DockerHash(data interface{}) (string, error) {
	if data == nil {
		return hashString("null"), nil
	}
	jsonData, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("marshal docker data: %w", err)
	}
	return hashBytes(jsonData), nil
}

// hashString returns the hex SHA-256 digest of the given string.
func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h[:])
}

// hashBytes returns the hex SHA-256 digest of the given bytes.
func hashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return fmt.Sprintf("%x", h[:])
}
