package configmanagement

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"patchmon-agent/pkg/models"
)

// ============================================================================
// Built-in technique method implementations
// ============================================================================

// methodFileContent ensures a file has the expected content.
// Parameters: "path" (required), "content" (required), "enforce_content" (optional, "true"|"false")
func (pe *PolicyExecutor) methodFileContent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	path := params["path"]
	expected := params["content"]
	if path == "" || expected == "" {
		return nil, fmt.Errorf("file_content requires 'path' and 'content' parameters")
	}

	actual, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to read %s: %v", path, err)}, nil
	}

	if string(actual) == expected {
		return &models.ConfigMethodResult{
			Status:   statusCompliant(mode),
			Message:  fmt.Sprintf("File %s has expected content", path),
			Actual:   truncate(string(actual), 200),
			Expected: truncate(expected, 200),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:   "audit_non_compliant",
			Message:  fmt.Sprintf("File %s content differs from expected", path),
			Actual:   truncate(string(actual), 200),
			Expected: truncate(expected, 200),
		}, nil
	}

	// Enforce: write the expected content
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to create directory %s: %v", dir, err)}, nil
	}
	if err := os.WriteFile(path, []byte(expected), 0644); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to write %s: %v", path, err)}, nil
	}

	return &models.ConfigMethodResult{
		Status:  "repaired",
		Message: fmt.Sprintf("File %s content updated", path),
	}, nil
}

// methodFileKeyValue ensures a file contains a key=value entry.
// Parameters: "path", "key", "value", "separator" (default "=")
func (pe *PolicyExecutor) methodFileKeyValue(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	path := params["path"]
	key := params["key"]
	value := params["value"]
	sep := params["separator"]
	if sep == "" {
		sep = "="
	}
	if path == "" || key == "" {
		return nil, fmt.Errorf("file_key_value requires 'path' and 'key' parameters")
	}

	expected := key + sep + value

	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to read %s: %v", path, err)}, nil
	}

	lines := strings.Split(string(content), "\n")
	found := false
	correctValue := false
	lineIndex := -1

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+sep) || strings.HasPrefix(trimmed, key+" "+sep) || strings.HasPrefix(trimmed, key+"\t"+sep) {
			found = true
			lineIndex = i
			// Check if value matches
			parts := strings.SplitN(trimmed, sep, 2)
			if len(parts) == 2 && strings.TrimSpace(parts[1]) == value {
				correctValue = true
			}
			break
		}
	}

	if found && correctValue {
		return &models.ConfigMethodResult{
			Status:   statusCompliant(mode),
			Message:  fmt.Sprintf("File %s has %s%s%s", path, key, sep, value),
			Actual:   expected,
			Expected: expected,
		}, nil
	}

	if mode == "audit" {
		status := "audit_non_compliant"
		msg := fmt.Sprintf("File %s: key %s ", path, key)
		if !found {
			msg += "not found"
		} else {
			msg += "has wrong value"
		}
		return &models.ConfigMethodResult{
			Status:   status,
			Message:  msg,
			Expected: expected,
		}, nil
	}

	// Enforce: update or append
	if found && lineIndex >= 0 {
		lines[lineIndex] = expected
	} else {
		lines = append(lines, expected)
	}

	newContent := strings.Join(lines, "\n")
	if err := os.WriteFile(path, []byte(newContent), 0644); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to write %s: %v", path, err)}, nil
	}

	return &models.ConfigMethodResult{
		Status:  "repaired",
		Message: fmt.Sprintf("File %s: set %s%s%s", path, key, sep, value),
	}, nil
}

// methodFilePermissions ensures a file has the correct ownership and permissions.
// Parameters: "path", "mode" (octal, e.g. "0644"), "owner" (optional), "group" (optional)
func (pe *PolicyExecutor) methodFilePermissions(ctx context.Context, params map[string]string, policyMode string) (*models.ConfigMethodResult, error) {
	path := params["path"]
	if path == "" {
		return nil, fmt.Errorf("file_permissions requires 'path' parameter")
	}

	info, err := os.Stat(path)
	if err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to stat %s: %v", path, err)}, nil
	}

	needsRepair := false
	details := make([]string, 0)

	// Check permissions
	if modeStr, ok := params["mode"]; ok && modeStr != "" {
		expected, err := strconv.ParseUint(modeStr, 8, 32)
		if err != nil {
			return nil, fmt.Errorf("invalid mode %q: %v", modeStr, err)
		}
		actual := uint64(info.Mode().Perm())
		if actual != expected {
			needsRepair = true
			details = append(details, fmt.Sprintf("mode: %04o → %04o", actual, expected))
		}
	}

	// Check owner
	if ownerStr, ok := params["owner"]; ok && ownerStr != "" {
		stat := info.Sys().(*syscall.Stat_t)
		u, err := user.Lookup(ownerStr)
		if err != nil {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("user %s not found: %v", ownerStr, err)}, nil
		}
		uid, _ := strconv.Atoi(u.Uid)
		if int(stat.Uid) != uid {
			needsRepair = true
			details = append(details, fmt.Sprintf("owner: %d → %s(%s)", stat.Uid, ownerStr, u.Uid))
		}
	}

	if !needsRepair {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(policyMode),
			Message: fmt.Sprintf("File %s permissions are correct", path),
		}, nil
	}

	if policyMode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("File %s needs permission changes: %s", path, strings.Join(details, ", ")),
		}, nil
	}

	// Enforce
	if modeStr, ok := params["mode"]; ok && modeStr != "" {
		m, _ := strconv.ParseUint(modeStr, 8, 32)
		if err := os.Chmod(path, os.FileMode(m)); err != nil {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("chmod failed: %v", err)}, nil
		}
	}

	if ownerStr, ok := params["owner"]; ok && ownerStr != "" {
		u, _ := user.Lookup(ownerStr)
		uid, _ := strconv.Atoi(u.Uid)
		gid := -1
		if groupStr, ok2 := params["group"]; ok2 && groupStr != "" {
			g, err := user.LookupGroup(groupStr)
			if err == nil {
				gid, _ = strconv.Atoi(g.Gid)
			}
		}
		if err := os.Chown(path, uid, gid); err != nil {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("chown failed: %v", err)}, nil
		}
	}

	return &models.ConfigMethodResult{
		Status:  "repaired",
		Message: fmt.Sprintf("File %s permissions fixed: %s", path, strings.Join(details, ", ")),
	}, nil
}

// methodPackagePresent ensures a package is installed.
// Parameters: "name" (required), "version" (optional)
func (pe *PolicyExecutor) methodPackagePresent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	name := params["name"]
	if name == "" {
		return nil, fmt.Errorf("package_present requires 'name' parameter")
	}

	installed, currentVersion := isPackageInstalled(name)

	if installed {
		// If version is specified, check it
		if wantVersion, ok := params["version"]; ok && wantVersion != "" && currentVersion != wantVersion {
			if mode == "audit" {
				return &models.ConfigMethodResult{
					Status:   "audit_non_compliant",
					Message:  fmt.Sprintf("Package %s is version %s, expected %s", name, currentVersion, wantVersion),
					Actual:   currentVersion,
					Expected: wantVersion,
				}, nil
			}
			// Enforce: install specific version
			if err := installPackage(name, wantVersion); err != nil {
				return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to install %s=%s: %v", name, wantVersion, err)}, nil
			}
			return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Package %s updated to %s", name, wantVersion)}, nil
		}
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("Package %s is installed (v%s)", name, currentVersion),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("Package %s is not installed", name),
		}, nil
	}

	// Enforce: install
	version := params["version"]
	if err := installPackage(name, version); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to install %s: %v", name, err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Package %s installed", name)}, nil
}

// methodPackageAbsent ensures a package is NOT installed.
// Parameters: "name" (required)
func (pe *PolicyExecutor) methodPackageAbsent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	name := params["name"]
	if name == "" {
		return nil, fmt.Errorf("package_absent requires 'name' parameter")
	}

	installed, _ := isPackageInstalled(name)
	if !installed {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("Package %s is not installed", name),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("Package %s is installed but should not be", name),
		}, nil
	}

	if err := removePackage(name); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to remove %s: %v", name, err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Package %s removed", name)}, nil
}

// methodServiceRunning ensures a service is enabled and running.
// Parameters: "name" (required)
func (pe *PolicyExecutor) methodServiceRunning(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	name := params["name"]
	if name == "" {
		return nil, fmt.Errorf("service_running requires 'name' parameter")
	}

	running := isServiceRunning(name)
	if running {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("Service %s is running", name),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("Service %s is not running", name),
		}, nil
	}

	if err := startService(name); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to start %s: %v", name, err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Service %s started", name)}, nil
}

// methodServiceStopped ensures a service is stopped.
// Parameters: "name" (required)
func (pe *PolicyExecutor) methodServiceStopped(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	name := params["name"]
	if name == "" {
		return nil, fmt.Errorf("service_stopped requires 'name' parameter")
	}

	running := isServiceRunning(name)
	if !running {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("Service %s is stopped", name),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("Service %s is running but should be stopped", name),
		}, nil
	}

	if err := stopService(name); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to stop %s: %v", name, err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Service %s stopped", name)}, nil
}

// methodServiceRestart restarts a service (typically used after a config change).
// Parameters: "name" (required)
// NOTE: This is an action, not a desired state. It should usually be conditioned
// on a previous method being "repaired".
func (pe *PolicyExecutor) methodServiceRestart(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	name := params["name"]
	if name == "" {
		return nil, fmt.Errorf("service_restart requires 'name' parameter")
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_compliant",
			Message: fmt.Sprintf("Service %s restart would be triggered (audit mode)", name),
		}, nil
	}

	if err := restartService(name); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to restart %s: %v", name, err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Service %s restarted", name)}, nil
}

// methodCommandAudit runs a command and checks its exit code (audit only, never modifies).
// Parameters: "command" (required), "expected_code" (default "0", also accepts legacy "compliant_code")
func (pe *PolicyExecutor) methodCommandAudit(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	command := params["command"]
	if command == "" {
		return nil, fmt.Errorf("command_audit requires 'command' parameter")
	}

	compliantCode := 0
	codeStr := params["expected_code"]
	if codeStr == "" {
		codeStr = params["compliant_code"] // legacy fallback
	}
	if codeStr != "" {
		if v, err := strconv.Atoi(codeStr); err == nil {
			compliantCode = v
		}
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	output, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return &models.ConfigMethodResult{
				Status:  "error",
				Message: fmt.Sprintf("command execution failed: %v", err),
			}, nil
		}
	}

	status := statusCompliant(mode)
	if exitCode != compliantCode {
		if mode == "audit" {
			status = "audit_non_compliant"
		} else {
			status = "non_compliant"
		}
	}

	return &models.ConfigMethodResult{
		Status:   status,
		Message:  fmt.Sprintf("Command exited with code %d", exitCode),
		Actual:   truncate(string(output), 4000),
		Expected: fmt.Sprintf("exit code %d", compliantCode),
	}, nil
}

// methodCommandExec runs a command to enforce a desired state.
// Parameters: "command" (required), "expected_code" (default "0")
func (pe *PolicyExecutor) methodCommandExec(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	command := params["command"]
	if command == "" {
		return nil, fmt.Errorf("command_exec requires 'command' parameter")
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	output, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("command execution failed: %v", err)}, nil
		}
	}

	expectedCode := 0
	if codeStr, ok := params["expected_code"]; ok && codeStr != "" {
		if v, err := strconv.Atoi(codeStr); err == nil {
			expectedCode = v
		}
	}

	// In audit mode, run the command and capture output but report as informational
	if mode == "audit" {
		status := "audit_compliant"
		if exitCode != expectedCode {
			status = "audit_non_compliant"
		}
		return &models.ConfigMethodResult{
			Status:  status,
			Message: fmt.Sprintf("Command exited with code %d (audit mode)", exitCode),
			Actual:  truncate(string(output), 4000),
		}, nil
	}

	if exitCode != expectedCode {
		return &models.ConfigMethodResult{
			Status:  "error",
			Message: fmt.Sprintf("Command exited with code %d (expected %d)", exitCode, expectedCode),
			Actual:  truncate(string(output), 4000),
		}, nil
	}

	return &models.ConfigMethodResult{
		Status:  "repaired",
		Message: fmt.Sprintf("Command executed successfully"),
		Actual:  truncate(string(output), 4000),
	}, nil
}

// methodCommandRun always executes a command and captures its output.
// Unlike command_exec it runs in ALL modes (including audit) and never
// reports a compliance failure – the result is purely informational so
// operators can inspect the output in the run details.
// Parameters: "command" (required)
func (pe *PolicyExecutor) methodCommandRun(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	command := params["command"]
	if command == "" {
		return nil, fmt.Errorf("command_run requires 'command' parameter")
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	output, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return &models.ConfigMethodResult{
				Status:  "error",
				Message: fmt.Sprintf("command execution failed: %v", err),
			}, nil
		}
	}

	return &models.ConfigMethodResult{
		Status:  statusCompliant(mode),
		Message: fmt.Sprintf("Command exited with code %d", exitCode),
		Actual:  truncate(string(output), 4000),
	}, nil
}

// methodUserPresent ensures a user account exists.
// Parameters: "name" (required, also accepts legacy "username"), "uid" (optional), "shell" (optional), "home" (optional)
func (pe *PolicyExecutor) methodUserPresent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	username := params["name"]
	if username == "" {
		username = params["username"] // legacy fallback
	}
	if username == "" {
		return nil, fmt.Errorf("user_present requires 'name' parameter")
	}

	u, err := user.Lookup(username)
	if err == nil {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("User %s exists (uid=%s)", username, u.Uid),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("User %s does not exist", username),
		}, nil
	}

	// Enforce: create user
	args := []string{username}
	if shell, ok := params["shell"]; ok && shell != "" {
		args = append([]string{"-s", shell}, args...)
	}
	if home, ok := params["home"]; ok && home != "" {
		args = append([]string{"-d", home, "-m"}, args...)
	}
	if uid, ok := params["uid"]; ok && uid != "" {
		args = append([]string{"-u", uid}, args...)
	}

	cmd := exec.CommandContext(ctx, "useradd", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("useradd failed: %v (%s)", err, truncate(string(output), 200))}, nil
	}

	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("User %s created", username)}, nil
}

// methodUserAbsent ensures a user account does NOT exist.
// Parameters: "name" (required, also accepts legacy "username")
func (pe *PolicyExecutor) methodUserAbsent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	username := params["name"]
	if username == "" {
		username = params["username"] // legacy fallback
	}
	if username == "" {
		return nil, fmt.Errorf("user_absent requires 'name' parameter")
	}

	_, err := user.Lookup(username)
	if err != nil {
		// User doesn't exist — compliant
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("User %s does not exist", username),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("User %s exists but should not", username),
		}, nil
	}

	cmd := exec.CommandContext(ctx, "userdel", "-r", username)
	if output, err := cmd.CombinedOutput(); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("userdel failed: %v (%s)", err, truncate(string(output), 200))}, nil
	}

	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("User %s removed", username)}, nil
}

// methodDirectoryPresent ensures a directory exists.
// Parameters: "path" (required), "mode" (optional, octal)
func (pe *PolicyExecutor) methodDirectoryPresent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	path := params["path"]
	if path == "" {
		return nil, fmt.Errorf("directory_present requires 'path' parameter")
	}

	info, err := os.Stat(path)
	if err == nil && info.IsDir() {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("Directory %s exists", path),
		}, nil
	}

	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("Directory %s does not exist", path),
		}, nil
	}

	perm := os.FileMode(0755)
	if modeStr, ok := params["mode"]; ok && modeStr != "" {
		if v, err := strconv.ParseUint(modeStr, 8, 32); err == nil {
			perm = os.FileMode(v)
		}
	}

	if err := os.MkdirAll(path, perm); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("mkdir failed: %v", err)}, nil
	}
	return &models.ConfigMethodResult{Status: "repaired", Message: fmt.Sprintf("Directory %s created", path)}, nil
}

// methodSSHKeyPresent ensures an SSH public key is in a user's authorized_keys.
// Parameters: "user" (required), "key" (required — full public key line),
//
//	"label" (optional — friendly label for log messages)
//
// Works for both root and normal users. In enforce mode it will create the
// ~/.ssh directory (0700) and authorized_keys file (0600) if they don't exist,
// with ownership set to the target user.
func (pe *PolicyExecutor) methodSSHKeyPresent(ctx context.Context, params map[string]string, mode string) (*models.ConfigMethodResult, error) {
	username := params["user"]
	if username == "" {
		return nil, fmt.Errorf("ssh_key_present requires 'user' parameter")
	}
	key := strings.TrimSpace(params["key"])
	if key == "" {
		return nil, fmt.Errorf("ssh_key_present requires 'key' parameter")
	}
	label := params["label"]
	if label == "" {
		// Use first 40 chars of key as label fallback
		label = truncate(key, 40)
	}

	// Look up the target user
	u, err := user.Lookup(username)
	if err != nil {
		return &models.ConfigMethodResult{
			Status:  "error",
			Message: fmt.Sprintf("User %s not found: %v", username, err),
		}, nil
	}

	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	sshDir := filepath.Join(u.HomeDir, ".ssh")
	authKeysPath := filepath.Join(sshDir, "authorized_keys")

	// --- Check if key already present ---
	keyPresent := false
	existingContent := ""
	if data, err := os.ReadFile(authKeysPath); err == nil {
		existingContent = string(data)
		// Compare by the key body (type + base64) to avoid comment/whitespace mismatches.
		// A key line typically looks like: ssh-rsa AAAA...== comment
		keyFields := strings.Fields(key)
		var keyBody string
		if len(keyFields) >= 2 {
			keyBody = keyFields[0] + " " + keyFields[1]
		} else {
			keyBody = key
		}
		for _, line := range strings.Split(existingContent, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				continue
			}
			if strings.Contains(trimmed, keyBody) {
				keyPresent = true
				break
			}
		}
	}

	if keyPresent {
		return &models.ConfigMethodResult{
			Status:  statusCompliant(mode),
			Message: fmt.Sprintf("SSH key already present for %s (%s)", username, label),
		}, nil
	}

	// Key is missing
	if mode == "audit" {
		return &models.ConfigMethodResult{
			Status:  "audit_non_compliant",
			Message: fmt.Sprintf("SSH key not found in %s for %s (%s)", authKeysPath, username, label),
		}, nil
	}

	// --- Enforce: ensure .ssh directory exists with correct ownership ---
	if _, err := os.Stat(sshDir); os.IsNotExist(err) {
		if err := os.MkdirAll(sshDir, 0700); err != nil {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to create %s: %v", sshDir, err)}, nil
		}
		if err := os.Chown(sshDir, uid, gid); err != nil {
			return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to chown %s: %v", sshDir, err)}, nil
		}
	}

	// Ensure correct perms on .ssh dir
	if err := os.Chmod(sshDir, 0700); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to chmod %s: %v", sshDir, err)}, nil
	}

	// --- Append key to authorized_keys ---
	// Ensure trailing newline before appending
	appendContent := key + "\n"
	if existingContent != "" && !strings.HasSuffix(existingContent, "\n") {
		appendContent = "\n" + appendContent
	}

	f, err := os.OpenFile(authKeysPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to open %s: %v", authKeysPath, err)}, nil
	}
	defer f.Close()

	if _, err := f.WriteString(appendContent); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to write key to %s: %v", authKeysPath, err)}, nil
	}

	// Set correct ownership and permissions on authorized_keys
	if err := os.Chown(authKeysPath, uid, gid); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to chown %s: %v", authKeysPath, err)}, nil
	}
	if err := os.Chmod(authKeysPath, 0600); err != nil {
		return &models.ConfigMethodResult{Status: "error", Message: fmt.Sprintf("failed to chmod %s: %v", authKeysPath, err)}, nil
	}

	return &models.ConfigMethodResult{
		Status:  "repaired",
		Message: fmt.Sprintf("SSH key added to %s for %s (%s)", authKeysPath, username, label),
	}, nil
}
