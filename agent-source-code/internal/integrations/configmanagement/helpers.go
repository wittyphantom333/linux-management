package configmanagement

import (
	"os"
	"os/exec"
	"runtime"
	"strings"

	"patchmon-agent/pkg/models"
)

// ============================================================================
// System helper functions used by technique methods.
// These are OS-aware and work across Debian/RHEL/SUSE/FreeBSD families.
// ============================================================================

// detectOSFamily returns the broad OS family: "debian", "rhel", "suse", "freebsd", "alpine", or "".
func detectOSFamily() string {
	if runtime.GOOS == "freebsd" {
		return "freebsd"
	}

	// Check /etc/os-release
	content, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return ""
	}
	lower := strings.ToLower(string(content))

	switch {
	case strings.Contains(lower, "id=ubuntu") || strings.Contains(lower, "id=debian") || strings.Contains(lower, "id=linuxmint") || strings.Contains(lower, "id=pop"):
		return "debian"
	case strings.Contains(lower, "id=rhel") || strings.Contains(lower, "id=centos") || strings.Contains(lower, "id=rocky") || strings.Contains(lower, "id=alma") || strings.Contains(lower, "id=fedora") || strings.Contains(lower, "id=oracle"):
		return "rhel"
	case strings.Contains(lower, "id=sles") || strings.Contains(lower, "id=opensuse"):
		return "suse"
	case strings.Contains(lower, "id=alpine"):
		return "alpine"
	}

	return "linux"
}

// detectPackageManager returns the package manager binary name for this system.
func detectPackageManager() string {
	family := detectOSFamily()
	switch family {
	case "debian":
		return "apt-get"
	case "rhel":
		if _, err := exec.LookPath("dnf"); err == nil {
			return "dnf"
		}
		return "yum"
	case "suse":
		return "zypper"
	case "alpine":
		return "apk"
	case "freebsd":
		return "pkg"
	}
	// Fallback: try to detect
	for _, pm := range []string{"apt-get", "dnf", "yum", "zypper", "apk", "pkg"} {
		if _, err := exec.LookPath(pm); err == nil {
			return pm
		}
	}
	return ""
}

// isPackageInstalled checks whether a package is installed and returns (installed, version).
func isPackageInstalled(name string) (bool, string) {
	pm := detectPackageManager()
	switch pm {
	case "apt-get":
		cmd := exec.Command("dpkg-query", "-W", "-f=${Status} ${Version}", name)
		out, err := cmd.Output()
		if err != nil {
			return false, ""
		}
		s := string(out)
		if strings.Contains(s, "install ok installed") {
			parts := strings.Fields(s)
			if len(parts) >= 4 {
				return true, parts[3]
			}
			return true, ""
		}
		return false, ""

	case "dnf", "yum":
		cmd := exec.Command("rpm", "-q", "--queryformat", "%{VERSION}-%{RELEASE}", name)
		out, err := cmd.Output()
		if err != nil {
			return false, ""
		}
		return true, strings.TrimSpace(string(out))

	case "zypper":
		cmd := exec.Command("rpm", "-q", "--queryformat", "%{VERSION}-%{RELEASE}", name)
		out, err := cmd.Output()
		if err != nil {
			return false, ""
		}
		return true, strings.TrimSpace(string(out))

	case "apk":
		cmd := exec.Command("apk", "info", "-e", name)
		err := cmd.Run()
		return err == nil, ""

	case "pkg":
		cmd := exec.Command("pkg", "info", name)
		out, err := cmd.Output()
		if err != nil {
			return false, ""
		}
		// pkg info output starts with "name-version"
		s := strings.TrimSpace(string(out))
		if s != "" {
			return true, s
		}
		return false, ""
	}

	return false, ""
}

// installPackage installs a package (optionally at a specific version).
func installPackage(name, version string) error {
	pm := detectPackageManager()
	var args []string

	switch pm {
	case "apt-get":
		pkg := name
		if version != "" {
			pkg = name + "=" + version
		}
		args = []string{"-y", "-q", "install", pkg}
	case "dnf", "yum":
		pkg := name
		if version != "" {
			pkg = name + "-" + version
		}
		args = []string{"-y", "install", pkg}
	case "zypper":
		pkg := name
		if version != "" {
			pkg = name + "=" + version
		}
		args = []string{"--non-interactive", "install", pkg}
	case "apk":
		pkg := name
		if version != "" {
			pkg = name + "=" + version
		}
		args = []string{"add", "--no-cache", pkg}
	case "pkg":
		args = []string{"install", "-y", name}
	default:
		return exec.ErrNotFound
	}

	cmd := exec.Command(pm, args...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	return cmd.Run()
}

// removePackage removes a package.
func removePackage(name string) error {
	pm := detectPackageManager()
	var args []string

	switch pm {
	case "apt-get":
		args = []string{"-y", "-q", "remove", name}
	case "dnf", "yum":
		args = []string{"-y", "remove", name}
	case "zypper":
		args = []string{"--non-interactive", "remove", name}
	case "apk":
		args = []string{"del", name}
	case "pkg":
		args = []string{"delete", "-y", name}
	default:
		return exec.ErrNotFound
	}

	cmd := exec.Command(pm, args...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	return cmd.Run()
}

// detectServiceManager returns the init system: "systemd", "openrc", "freebsd", or "".
func detectServiceManager() string {
	if runtime.GOOS == "freebsd" {
		return "freebsd"
	}
	// Check for systemd
	if _, err := exec.LookPath("systemctl"); err == nil {
		if _, err := os.Stat("/run/systemd/system"); err == nil {
			return "systemd"
		}
	}
	// Check for OpenRC
	if _, err := exec.LookPath("rc-service"); err == nil {
		return "openrc"
	}
	return ""
}

// isServiceRunning checks whether a service is active/running.
func isServiceRunning(name string) bool {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		cmd := exec.Command("systemctl", "is-active", "--quiet", name)
		return cmd.Run() == nil
	case "openrc":
		cmd := exec.Command("rc-service", name, "status")
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		return strings.Contains(strings.ToLower(string(out)), "started")
	case "freebsd":
		cmd := exec.Command("service", name, "status")
		return cmd.Run() == nil
	}
	return false
}

// startService starts a service.
func startService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		// Enable + start
		_ = exec.Command("systemctl", "enable", name).Run()
		return exec.Command("systemctl", "start", name).Run()
	case "openrc":
		_ = exec.Command("rc-update", "add", name, "default").Run()
		return exec.Command("rc-service", name, "start").Run()
	case "freebsd":
		return exec.Command("service", name, "start").Run()
	}
	return exec.ErrNotFound
}

// stopService stops a service.
func stopService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		return exec.Command("systemctl", "stop", name).Run()
	case "openrc":
		return exec.Command("rc-service", name, "stop").Run()
	case "freebsd":
		return exec.Command("service", name, "stop").Run()
	}
	return exec.ErrNotFound
}

// restartService restarts a service.
func restartService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		return exec.Command("systemctl", "restart", name).Run()
	case "openrc":
		return exec.Command("rc-service", name, "restart").Run()
	case "freebsd":
		return exec.Command("service", name, "restart").Run()
	}
	return exec.ErrNotFound
}

// isServiceEnabled checks whether a service is configured to start at boot.
func isServiceEnabled(name string) bool {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		cmd := exec.Command("systemctl", "is-enabled", "--quiet", name)
		return cmd.Run() == nil
	case "openrc":
		// rc-update show lists enabled services; check if our service is in the default runlevel
		cmd := exec.Command("rc-update", "show", "default")
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(strings.TrimSpace(line), name) {
				return true
			}
		}
		return false
	case "freebsd":
		// Check if service_enable="YES" in /etc/rc.conf
		content, err := os.ReadFile("/etc/rc.conf")
		if err != nil {
			return false
		}
		// Look for: servicename_enable="YES" (case-insensitive for YES)
		enableKey := strings.ReplaceAll(name, "-", "_") + "_enable"
		for _, line := range strings.Split(string(content), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, enableKey) {
				upper := strings.ToUpper(trimmed)
				if strings.Contains(upper, "YES") {
					return true
				}
			}
		}
		return false
	}
	return false
}

// enableService enables a service to start at boot.
func enableService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		return exec.Command("systemctl", "enable", name).Run()
	case "openrc":
		return exec.Command("rc-update", "add", name, "default").Run()
	case "freebsd":
		enableKey := strings.ReplaceAll(name, "-", "_") + "_enable"
		cmd := exec.Command("sysrc", enableKey+"=YES")
		return cmd.Run()
	}
	return exec.ErrNotFound
}

// disableService disables a service from starting at boot.
func disableService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		return exec.Command("systemctl", "disable", name).Run()
	case "openrc":
		return exec.Command("rc-update", "del", name, "default").Run()
	case "freebsd":
		enableKey := strings.ReplaceAll(name, "-", "_") + "_enable"
		cmd := exec.Command("sysrc", enableKey+"=NO")
		return cmd.Run()
	}
	return exec.ErrNotFound
}

// reloadService reloads a service configuration.
func reloadService(name string) error {
	sm := detectServiceManager()
	switch sm {
	case "systemd":
		return exec.Command("systemctl", "reload", name).Run()
	case "openrc":
		return exec.Command("rc-service", name, "reload").Run()
	case "freebsd":
		return exec.Command("service", name, "reload").Run()
	}
	return exec.ErrNotFound
}

// isSysctlPersisted checks whether a key=value is present in /etc/sysctl.d/99-patchmon.conf.
func isSysctlPersisted(key, value string) bool {
	content, err := os.ReadFile("/etc/sysctl.d/99-patchmon.conf")
	if err != nil {
		return false
	}
	expected := key + " = " + value
	expectedAlt := key + "=" + value
	for _, line := range strings.Split(string(content), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == expected || trimmed == expectedAlt {
			return true
		}
	}
	return false
}

// persistSysctl writes/updates a sysctl key=value in /etc/sysctl.d/99-patchmon.conf.
func persistSysctl(key, value string) error {
	confPath := "/etc/sysctl.d/99-patchmon.conf"
	expected := key + " = " + value

	// Read existing content
	content, err := os.ReadFile(confPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Match lines starting with the key (possibly with different value)
		if strings.HasPrefix(trimmed, key+" ") || strings.HasPrefix(trimmed, key+"=") || strings.HasPrefix(trimmed, key+"\t") {
			lines[i] = expected
			found = true
			break
		}
	}

	if !found {
		// Add a header comment if file is empty/new
		if len(strings.TrimSpace(string(content))) == 0 {
			lines = []string{"# Managed by Monux - do not edit", expected, ""}
		} else {
			lines = append(lines, expected)
		}
	}

	// Ensure /etc/sysctl.d exists
	if err := os.MkdirAll("/etc/sysctl.d", 0755); err != nil {
		return err
	}

	newContent := strings.Join(lines, "\n")
	return os.WriteFile(confPath, []byte(newContent), 0644)
}

// substituteParams replaces ${param_name} placeholders with values from the map.
func substituteParams(template string, params models.ParamMap) string {
	result := template
	for k, v := range params {
		result = strings.ReplaceAll(result, "${"+k+"}", v)
		result = strings.ReplaceAll(result, "{{"+k+"}}", v)
	}
	return result
}

// statusCompliant returns the correct "compliant" status depending on policy mode.
func statusCompliant(mode string) string {
	if mode == "audit" {
		return "audit_compliant"
	}
	return "success"
}

// truncate limits a string to maxLen characters.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
