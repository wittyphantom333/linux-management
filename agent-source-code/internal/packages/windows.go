package packages

import (
	"encoding/json"
	"regexp"
	"runtime"
	"strings"
	"unicode"

	"patchmon-agent/internal/logutil"
	"patchmon-agent/internal/winexec"
	"patchmon-agent/pkg/models"

	"github.com/sirupsen/logrus"
)

// WindowsManager handles Windows package information collection via WinGet and Windows Update
type WindowsManager struct {
	logger *logrus.Logger
}

// NewWindowsManager creates a new Windows package manager
func NewWindowsManager(logger *logrus.Logger) *WindowsManager {
	return &WindowsManager{
		logger: logger,
	}
}

// wingetEntry holds parsed fields from winget list table output
type wingetEntry struct {
	Name      string
	ID        string
	Version   string
	Available string
	Source    string
}

// GetPackages returns installed applications merged with Windows OS updates.
//
// Collection strategy (inspired by rmmagent):
//  1. Always collect from Windows Registry (reliable in Session 0 / SYSTEM context)
//  2. Try WinGet as supplementary source for update availability enrichment
//  3. Merge: registry provides the baseline, WinGet adds NeedsUpdate/AvailableVersion
//  4. Collect Windows OS updates (installed KBs + pending via WUA COM API)
func (m *WindowsManager) GetPackages() []models.Package {
	if runtime.GOOS != "windows" {
		return nil
	}

	// 1. Registry is the primary source — works reliably as SYSTEM in Session 0
	//    (same approach as rmmagent's go-win64api which reads Uninstall registry keys)
	regPackages := m.getPackagesFromRegistry()
	m.logger.WithField("count", len(regPackages)).Info("Collected packages via registry")

	// 2. Try WinGet for update availability enrichment
	//    WinGet may not be available in Session 0 (per-user UWP app); that's OK
	wingetPackages := m.getPackagesFromWinget()
	if len(wingetPackages) > 0 {
		m.logger.WithField("count", len(wingetPackages)).Info("Collected packages via WinGet (supplementary)")
	}

	// 3. Merge: start with registry baseline, enrich with WinGet update info
	appPackages := m.mergeRegistryAndWinget(regPackages, wingetPackages)
	m.logger.WithField("count", len(appPackages)).Info("Application packages after merge")

	// 4. Collect Windows OS updates (installed KBs + pending updates)
	winUpdates := m.getWindowsUpdates()
	m.logger.WithField("count", len(winUpdates)).Info("Collected Windows OS updates")

	// 5. Set SourceRepository for Windows Update entries based on WSUS config
	wsusActive := m.isWSUSActive()
	wuRepo := "Microsoft Update"
	if wsusActive {
		wuRepo = "WSUS"
	}
	for i := range winUpdates {
		winUpdates[i].SourceRepository = wuRepo
	}

	all := make([]models.Package, 0, len(appPackages)+len(winUpdates))
	all = append(all, appPackages...)
	all = append(all, winUpdates...)

	if len(all) == 0 {
		return []models.Package{}
	}
	return all
}

// mergeRegistryAndWinget merges registry-discovered packages with WinGet data.
// Registry provides the reliable baseline; WinGet enriches with update availability.
// Any WinGet-only entries (not in registry) are also included.
// SourceRepository is set to the WinGet source for matched packages, or "local" for registry-only.
func (m *WindowsManager) mergeRegistryAndWinget(regPkgs, wingetPkgs []models.Package) []models.Package {
	if len(wingetPkgs) == 0 {
		// No WinGet data: all registry packages are local
		for i := range regPkgs {
			regPkgs[i].SourceRepository = "local"
		}
		return regPkgs
	}

	// Build lookup from WinGet by normalized name for fuzzy matching
	type wingetInfo struct {
		AvailableVersion string
		NeedsUpdate      bool
		SourceRepository string
		// matched: enriched a registry entry, so it is already represented.
		matched bool
		// appended: already emitted as a winget-only entry.
		appended bool
	}
	// One record per normalised name. winget truncates names to its column
	// width, so distinct packages can collapse onto the same key here.
	wingetByName := make(map[string]*wingetInfo, len(wingetPkgs))
	for i := range wingetPkgs {
		key := normalizePackageName(wingetPkgs[i].Name)
		wingetByName[key] = &wingetInfo{
			AvailableVersion: wingetPkgs[i].AvailableVersion,
			NeedsUpdate:      wingetPkgs[i].NeedsUpdate,
			SourceRepository: wingetPkgs[i].SourceRepository,
		}
	}

	// Enrich registry entries with WinGet update info and source repo
	for i := range regPkgs {
		key := normalizePackageName(regPkgs[i].Name)
		if winfo, ok := wingetByName[key]; ok {
			if winfo.NeedsUpdate {
				regPkgs[i].NeedsUpdate = true
				if regPkgs[i].AvailableVersion == "" {
					regPkgs[i].AvailableVersion = winfo.AvailableVersion
				}
			}
			regPkgs[i].SourceRepository = winfo.SourceRepository
			winfo.matched = true
		} else {
			// Not found in WinGet: local/registry-only install
			regPkgs[i].SourceRepository = "local"
		}
	}

	// Add WinGet-only entries that weren't in registry.
	//
	// Guarded by appended as well as matched: the lookup holds one record per
	// normalised name, so two winget rows whose names truncate to the same
	// string both find the same unmatched record and would each be appended,
	// reaching the server as two identical packages. Observed on CI as two
	// copies of "Microsoft Visual C++ v14 Redistributabl" at the same version.
	for i := range wingetPkgs {
		key := normalizePackageName(wingetPkgs[i].Name)
		if winfo, ok := wingetByName[key]; ok && !winfo.matched && !winfo.appended {
			regPkgs = append(regPkgs, wingetPkgs[i])
			winfo.appended = true
		}
	}

	return regPkgs
}

// normalizePackageName lowercases and trims for fuzzy matching between registry and WinGet names
func normalizePackageName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// getPackagesFromRegistry uses registry Uninstall keys (HKLM + HKCU) to list installed programs.
// This is the primary collection method — works reliably as SYSTEM in Session 0.
// Inspired by rmmagent's use of go-win64api (which also reads these same registry keys).
// Collects: Name, Version, Publisher, InstallDate, EstimatedSize.
func (m *WindowsManager) getPackagesFromRegistry() []models.Package {
	// SilentlyContinue throughout — never let a single bad entry kill the whole collection.
	// rmmagent's go-win64api also silently skips entries with missing fields.
	psScript := `
$ErrorActionPreference = "SilentlyContinue"
$seen = @{}
$result = @()
$paths = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($path in $paths) {
  try {
    Get-ItemProperty $path -ErrorAction SilentlyContinue | ForEach-Object {
      $name = $_.DisplayName
      if (-not $name) { return }
      # SystemComponent=1 entries are hidden from Programs and Features (drivers, runtime deps)
      if ($_.SystemComponent -eq 1) { return }
      # Skip entries without a valid name or that are just GUIDs
      $trimmed = $name.Trim()
      if ($trimmed -eq "" -or $trimmed -match "^{[0-9a-fA-F-]+}$") { return }
      # Deduplicate by name (first seen wins — 64-bit path is first)
      if ($seen[$name]) { return }
      $seen[$name] = $true
      $ver = if ($_.DisplayVersion) { $_.DisplayVersion } else { "unknown" }
      $pub = if ($_.Publisher) { $_.Publisher } else { "" }
      $installDate = ""
      if ($_.InstallDate) {
        try {
          $d = $_.InstallDate
          if ($d -match "^\d{8}$") {
            $installDate = "$($d.Substring(0,4))-$($d.Substring(4,2))-$($d.Substring(6,2))"
          } else {
            $installDate = $d
          }
        } catch {}
      }
      $size = ""
      if ($_.EstimatedSize) {
        try {
          $kb = [int]$_.EstimatedSize
          if ($kb -gt 1048576) {
            $size = "{0:N1} GB" -f ($kb / 1048576)
          } elseif ($kb -gt 1024) {
            $size = "{0:N1} MB" -f ($kb / 1024)
          } else {
            $size = "$kb KB"
          }
        } catch {}
      }
      $result += @{
        Name        = $name
        Version     = $ver
        Publisher   = $pub
        InstallDate = $installDate
        Size        = $size
      }
    }
  } catch {}
}
if ($result.Count -gt 5000) { $result = $result[0..4999] }
$result | ConvertTo-Json -Compress -Depth 3
`
	cmd, cancel := boundedCommand(networkCollectorTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", winexec.Script(psScript))
	defer cancel()
	output, err := cmd.Output()
	if err != nil {
		m.logger.WithError(err).Warn("Registry Uninstall query failed")
		return nil
	}

	outputStr := strings.TrimSpace(string(winexec.TrimBOM(output)))
	if outputStr == "" || outputStr == "null" || outputStr == "[]" {
		return nil
	}

	// PowerShell outputs a single object (not array) when there is exactly one result
	if !strings.HasPrefix(outputStr, "[") {
		outputStr = "[" + outputStr + "]"
	}

	var raw []struct {
		Name        string `json:"Name"`
		Version     string `json:"Version"`
		Publisher   string `json:"Publisher"`
		InstallDate string `json:"InstallDate"`
		Size        string `json:"Size"`
	}
	if err := json.Unmarshal([]byte(outputStr), &raw); err != nil {
		m.logger.WithError(err).Warn("Failed to parse registry JSON")
		return nil
	}

	var packages []models.Package
	for _, p := range raw {
		if p.Name == "" {
			continue
		}
		version := p.Version
		if version == "" {
			version = "unknown"
		}
		// Build description from publisher + install date + size (like rmmagent's SoftwareList fields)
		desc := buildAppDescription(p.Publisher, p.InstallDate, p.Size)
		packages = append(packages, models.Package{
			Name:           p.Name,
			Description:    desc,
			Category:       "Application",
			CurrentVersion: version,
			NeedsUpdate:    false,
		})
	}
	return packages
}

// buildAppDescription creates a human-readable description from registry metadata
func buildAppDescription(publisher, installDate, size string) string {
	var parts []string
	if publisher != "" {
		parts = append(parts, publisher)
	}
	if installDate != "" {
		parts = append(parts, "installed "+installDate)
	}
	if size != "" {
		parts = append(parts, size)
	}
	return strings.Join(parts, " | ")
}

// getPackagesFromWinget runs winget list and parses the text-table output.
// Uses PowerShell wrapper for UTF-8 encoding to avoid U+FFFD mojibake.
// Resolves the actual winget.exe path to work in SYSTEM/Session 0 context
// where winget may not be on PATH (it's a per-user UWP app).
func (m *WindowsManager) getPackagesFromWinget() []models.Package {
	// Resolve winget.exe — it's installed as a UWP app (App Installer) and not always on SYSTEM PATH.
	// Try PATH first, then known WindowsApps locations.
	psScript := `
$ErrorActionPreference = "SilentlyContinue"
$env:TERM = 'dumb'

# Resolve winget.exe path — handle SYSTEM/Session 0 where it's not on PATH
$wingetPath = $null
$candidate = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($candidate) {
    $wingetPath = $candidate.Source
} else {
    # UWP package location (works for SYSTEM when App Installer is installed machine-wide)
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe",
        "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe",
        "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe"
    )
    foreach ($pattern in $candidates) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $wingetPath = $found.FullName
            break
        }
    }
}
if (-not $wingetPath) {
    Write-Output "WINGET_NOT_FOUND"
    exit 0
}
$out = & $wingetPath list --accept-source-agreements --disable-interactivity 2>&1
if ($out) { $out | Out-String }
`
	cmd, cancel := boundedCommand(networkCollectorTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", winexec.Script(psScript))
	defer cancel()
	output, err := cmd.Output()
	if err != nil {
		m.logger.WithError(err).Debug("winget list failed")
		return nil
	}

	outputStr := string(output)
	if strings.Contains(outputStr, "WINGET_NOT_FOUND") {
		m.logger.Debug("WinGet not available (not found on PATH or in WindowsApps)")
		return nil
	}

	entries := m.parseWingetTable(outputStr)
	if len(entries) == 0 {
		return nil
	}

	// Second pass: winget list --upgrade-available for accurate NeedsUpdate/AvailableVersion
	upgradeMap := m.getWingetUpgradeAvailable()

	var packages []models.Package
	for _, e := range entries {
		name := strings.TrimSpace(stripEllipsis(e.Name))
		if name == "" {
			name = strings.TrimSpace(stripEllipsis(e.ID))
		}
		if name == "" {
			continue
		}
		version := strings.TrimSpace(stripEllipsis(e.Version))
		if version == "" {
			version = "unknown"
		}
		avail := strings.TrimSpace(stripEllipsis(e.Available))
		needsUpdate := false
		id := strings.TrimSpace(stripEllipsis(e.ID))
		if up, ok := upgradeMap[id]; ok {
			needsUpdate = true
			if avail == "" {
				avail = up
			}
		} else if avail != "" && avail != version {
			needsUpdate = true
		}
		// Forward WinGet source as SourceRepository
		source := strings.TrimSpace(e.Source)
		if source == "" {
			source = "winget" // Default for WinGet-discovered packages
		}

		packages = append(packages, models.Package{
			Name:             name,
			Category:         "Application",
			CurrentVersion:   version,
			AvailableVersion: avail,
			NeedsUpdate:      needsUpdate,
			SourceRepository: source,
		})
	}
	return packages
}

// parseWingetTable parses winget list fixed-width text output.
// Uses header word positions to derive column boundaries; handles Name/Id/Version and optional Available/Source.
func (m *WindowsManager) parseWingetTable(output string) []wingetEntry {
	// Normalize line endings
	output = strings.ReplaceAll(output, "\r\n", "\n")
	output = strings.ReplaceAll(output, "\r", "\n")
	lines := strings.Split(output, "\n")

	var headerLine string
	var headerIdx int
	for i, line := range lines {
		lower := strings.ToLower(strings.TrimSpace(line))
		if len(lower) < 10 {
			continue
		}
		// Header must contain name, id, version (handles "Name", "SearchName", etc.)
		if strings.Contains(lower, "name") && strings.Contains(lower, "id") && strings.Contains(lower, "version") {
			headerLine = line
			headerIdx = i
			break
		}
	}
	if headerLine == "" {
		m.logger.Debug("parseWingetTable: no header line found")
		return nil
	}

	// Column boundaries are measured in characters, not bytes. winget pads the
	// table to a fixed display width, and it truncates a long name with a
	// single ellipsis character that is three bytes of UTF-8. Slicing a data
	// line at a byte offset taken from the ASCII header therefore cuts that
	// character in half, leaving "\xe2\x80" on the end of the name and "\xa6"
	// on the front of the version. Both fields are then invalid UTF-8,
	// stripEllipsis never matches because the ellipsis is in fragments, and
	// the mangled names defeat deduplication in mergeRegistryAndWinget so the
	// same package is reported twice.
	headerRunes := []rune(headerLine)
	type colSpan struct{ start, end int }
	var spans []colSpan
	for i := 0; i < len(headerRunes); {
		if unicode.IsSpace(headerRunes[i]) {
			i++
			continue
		}
		start := i
		for i < len(headerRunes) && !unicode.IsSpace(headerRunes[i]) {
			i++
		}
		spans = append(spans, colSpan{start: start, end: i})
	}
	if len(spans) < 3 {
		m.logger.WithField("header", headerLine).Debug("parseWingetTable: header has fewer than 3 columns")
		return nil
	}

	// colStarts[i] = start of column i; colEnd for column i = colStarts[i+1] or end of line
	colStarts := make([]int, len(spans))
	for i, s := range spans {
		colStarts[i] = s.start
	}

	extractCol := func(lineRunes []rune, col int) string {
		if col < 0 || col >= len(colStarts) {
			return ""
		}
		start := colStarts[col]
		end := len(lineRunes)
		if col+1 < len(colStarts) {
			end = colStarts[col+1]
		}
		if start >= len(lineRunes) {
			return ""
		}
		if end > len(lineRunes) {
			end = len(lineRunes)
		}
		return strings.TrimSpace(string(lineRunes[start:end]))
	}

	// Map column index to field (handles "Name"/"SearchName", "Id"/"SearchId", etc.)
	nameCol, idCol, versionCol := 0, 1, 2
	availCol, sourceCol := -1, -1
	for i := 0; i < len(spans) && i < 5; i++ {
		word := strings.ToLower(strings.TrimSpace(string(headerRunes[spans[i].start:spans[i].end])))
		switch {
		case word == "name" || strings.HasSuffix(word, "name"):
			nameCol = i
		case word == "id" || strings.HasSuffix(word, "id"):
			idCol = i
		case word == "version" || strings.HasSuffix(word, "version"):
			versionCol = i
		case word == "available" || strings.HasSuffix(word, "available"):
			availCol = i
		case word == "source" || strings.HasSuffix(word, "source"):
			sourceCol = i
		}
	}

	separatorRe := regexp.MustCompile(`^[-_\s]+$`)
	progressRe := regexp.MustCompile(`[█▒░]`)

	var entries []wingetEntry
	for i := headerIdx + 1; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if separatorRe.MatchString(trimmed) {
			continue
		}
		if progressRe.MatchString(line) {
			continue
		}
		if strings.Contains(strings.ToLower(line), "package(s)") {
			continue
		}

		lineRunes := []rune(line)
		name := extractCol(lineRunes, nameCol)
		id := extractCol(lineRunes, idCol)
		version := extractCol(lineRunes, versionCol)
		if name == "" && id == "" {
			continue
		}
		e := wingetEntry{Name: name, ID: id, Version: version}
		if availCol >= 0 {
			e.Available = extractCol(lineRunes, availCol)
		}
		if sourceCol >= 0 && sourceCol < len(colStarts) {
			e.Source = extractCol(lineRunes, sourceCol)
		}
		entries = append(entries, e)
	}
	return entries
}

// getWingetUpgradeAvailable runs winget list --upgrade-available and returns Id -> AvailableVersion map
func (m *WindowsManager) getWingetUpgradeAvailable() map[string]string {
	psScript := `
$ErrorActionPreference = "SilentlyContinue"
$env:TERM = 'dumb'

# Resolve winget.exe path (same logic as main list)
$wingetPath = $null
$candidate = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($candidate) {
    $wingetPath = $candidate.Source
} else {
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe",
        "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe",
        "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe"
    )
    foreach ($pattern in $candidates) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $wingetPath = $found.FullName
            break
        }
    }
}
if (-not $wingetPath) { exit 0 }
$out = & $wingetPath list --upgrade-available --accept-source-agreements --disable-interactivity 2>&1
if ($out) { $out | Out-String }
`
	cmd, cancel := boundedCommand(networkCollectorTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", winexec.Script(psScript))
	defer cancel()
	output, err := cmd.Output()
	if err != nil {
		m.logger.WithError(err).Debug("winget list --upgrade-available failed")
		return nil
	}
	entries := m.parseWingetTable(string(output))
	upgradeMap := make(map[string]string)
	for _, e := range entries {
		id := strings.TrimSpace(stripEllipsis(e.ID))
		if id == "" {
			continue
		}
		avail := strings.TrimSpace(stripEllipsis(e.Available))
		if avail == "" {
			avail = strings.TrimSpace(stripEllipsis(e.Version))
		}
		if avail != "" {
			upgradeMap[id] = avail
		}
	}
	return upgradeMap
}

func stripEllipsis(s string) string {
	s = strings.TrimSpace(s)
	// Winget truncates with U+2026 HORIZONTAL ELLIPSIS.
	const ellipsis = "\u2026"
	if strings.HasSuffix(s, ellipsis) {
		return strings.TrimSuffix(s, ellipsis)
	}
	// The same character written as UTF-8 (E2 80 A6) and read back through a
	// single-byte code page lands as ÔÇª under CP850 or â€¦ under CP1252.
	// The constant here used to spell ÔÂÉ, so it never matched anything.
	for _, mangled := range []string{"\u00d4\u00c7\u00aa", "\u00e2\u20ac\u00a6"} {
		if strings.HasSuffix(s, mangled) {
			return strings.TrimSuffix(s, mangled)
		}
	}
	return s
}

// isWSUSActive checks if WSUS is configured and active by reading the Windows registry.
func (m *WindowsManager) isWSUSActive() bool {
	if runtime.GOOS != "windows" {
		return false
	}

	psScript := `
$ErrorActionPreference = "SilentlyContinue"
$wuKey = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
$server = (Get-ItemProperty -Path $wuKey -Name WUServer -ErrorAction SilentlyContinue).WUServer
$useWU = (Get-ItemProperty -Path "$wuKey\AU" -Name UseWUServer -ErrorAction SilentlyContinue).UseWUServer
if ($server -and $useWU -eq 1) { "WSUS_ACTIVE" } else { "WSUS_INACTIVE" }
`
	cmd, cancel := boundedCommand(networkCollectorTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", winexec.Script(psScript))
	defer cancel()
	output, err := cmd.Output()
	if err != nil {
		m.logger.WithError(err).Debug("Failed to check WSUS status")
		return false
	}

	return strings.Contains(strings.TrimSpace(string(output)), "WSUS_ACTIVE")
}

// wuaErrorHint returns a human-readable hint for common WUA HRESULTs (per UsoClient/WUA docs)
func wuaErrorHint(msg string) string {
	switch {
	case strings.Contains(msg, "0x80070005"):
		return "E_ACCESSDENIED: agent may be running as service in Session 0; COM requires interactive context"
	case strings.Contains(msg, "0x80240440"):
		return "WUA service unavailable; ensure wuauserv is running"
	case strings.Contains(msg, "0x8024402f"):
		return "Connection to update server failed; check network, proxy, firewall"
	case strings.Contains(msg, "0x80244007"):
		return "Update server not found; verify WSUS config or internet access"
	case strings.Contains(msg, "0x80070002"):
		return "File not found; try clearing SoftwareDistribution cache"
	default:
		return ""
	}
}

// getWindowsUpdates queries installed KB patches and pending Windows updates.
// Uses Get-HotFix for installed; Microsoft.Update.Session for pending (may fail in Session 0).
func (m *WindowsManager) getWindowsUpdates() []models.Package {
	psScript := `
$ErrorActionPreference = "SilentlyContinue"
$result = @()

# Build a display name without duplicating KB IDs already present in the title.
# WUA titles frequently already contain "(KB5122871)", so naive appending yields
# "2026-09 Security Update (KB5122871) (26100.33438) (KB5122871)".
function Get-WuDisplayName([string]$title, [string]$kbStr) {
  if (-not $kbStr) { return $title }
  $missing = @()
  foreach ($kb in ($kbStr -split ',\s*')) {
    if ($kb -and ($title -notmatch [regex]::Escape($kb))) { $missing += $kb }
  }
  if ($missing.Count -eq 0) { return $title }
  return "$title ($($missing -join ', '))"
}

# Security classification. MsrcSeverity is authoritative when present, but
# cumulative updates routinely leave it blank while the title or category still
# identifies the update as a security update.
function Test-WuSecurity([string]$severity, [string]$title, $categories) {
  if ($severity -eq "Critical" -or $severity -eq "Important") { return $true }
  if ($title -match "Security Update") { return $true }
  if ($categories -contains "Security Updates") { return $true }
  return $false
}

# --- Best-effort: build KB -> {severity, categories} map from WUA history ---
# Gives accurate security classification for installed KBs. COM may fail in
# Session 0; on failure we degrade to the Win32_QuickFixEngineering Description.
$kbMeta = @{}
try {
  $histSession = New-Object -ComObject Microsoft.Update.Session
  $histSearcher = $histSession.CreateUpdateSearcher()
  $histCount = $histSearcher.GetTotalHistoryCount()
  if ($histCount -gt 0) {
    $hist = $histSearcher.QueryHistory(0, $histCount)
    foreach ($h in $hist) {
      if (-not $h.Title) { continue }
      $sev = ""
      try { $sev = "$($h.MsrcSeverity)" } catch {}
      $cats = @()
      try { $cats = @($h.Categories | ForEach-Object { "$($_.Name)" }) } catch {}
      $isSec = ($sev -eq "Critical" -or $sev -eq "Important") -or ($cats -contains "Security Updates")
      foreach ($m in [regex]::Matches($h.Title, "KB\d{6,8}")) {
        $kbMeta[$m.Value] = @{ Security = $isSec; Severity = $sev; Categories = $cats }
      }
    }
  }
} catch {}

# --- Installed KBs from WMI (fast, reliable) ---
$hotfixes = Get-HotFix -ErrorAction SilentlyContinue
foreach ($hf in $hotfixes) {
  $id = $hf.HotFixID
  if (-not $id) { continue }
  $installedOn = ""
  try {
    if ($hf.InstalledOn -ne $null) {
      $installedOn = $hf.InstalledOn.ToString("yyyy-MM-dd")
    }
  } catch {}
  if (-not $installedOn) { $installedOn = "installed" }
  $desc = if ($installedOn -and $installedOn -ne "installed") { "Installed $installedOn" } else { "Installed" }
  # Prefer WUA history classification; fall back to the QFE Description string.
  $meta = $kbMeta[$id]
  $sev = if ($meta) { $meta.Severity } else { "" }
  $cats = if ($meta) { $meta.Categories } else { @() }
  $isSec = if ($meta) { $meta.Security } else { Test-WuSecurity $sev $hf.Description $cats }
  $result += @{
    Name             = $id
    Description      = $desc
    CurrentVersion   = "installed"
    AvailableVersion = ""
    NeedsUpdate      = $false
    IsSecurityUpdate = $isSec
    WUAGuid          = ""
    WUAKb            = $id
    WUASeverity      = $sev
    WUACategories    = $cats
    WUASupportURL    = ""
    WUARevisionNumber = 0
    WUADateInstalled = $installedOn
  }
}

# --- Pending updates via Windows Update COM API (fails in Session 0 / service context) ---
$comFailed = $false
try {
  $session   = New-Object -ComObject Microsoft.Update.Session
  $searcher  = $session.CreateUpdateSearcher()
  $results   = $searcher.Search("IsInstalled=0 AND IsHidden=0")
  foreach ($u in $results.Updates) {
    $kbs = @($u.KBArticleIDs | ForEach-Object { "KB$_" })
    $kbStr = ($kbs -join ", ")
    $cats = @($u.Categories | ForEach-Object { $_.Name })
    $sev = if ($u.MsrcSeverity) { "$($u.MsrcSeverity)" } else { "" }
    $displayName = Get-WuDisplayName $u.Title $kbStr
    $guid = ""
    try { $guid = $u.Identity.UpdateID } catch {}
    $supportUrl = ""
    try { $supportUrl = $u.SupportURL } catch {}
    $revNum = 0
    try { $revNum = [int]$u.Identity.RevisionNumber } catch {}
    $result += @{
      Name             = $displayName
      CurrentVersion   = "pending"
      AvailableVersion = ""
      NeedsUpdate      = $true
      IsSecurityUpdate = (Test-WuSecurity $sev $u.Title $cats)
      WUAGuid          = $guid
      WUAKb            = $kbStr
      WUASeverity      = $sev
      WUACategories    = $cats
      WUASupportURL    = $supportUrl
      WUARevisionNumber = $revNum
    }
  }
} catch {
  $comFailed = $true
  $hresult = if ($_.Exception.HResult) { [Convert]::ToString([uint32]$_.Exception.HResult, 16) } else { "" }
  Write-Host "WUA_COM_ERROR:$($_.Exception.Message) (HRESULT: 0x$hresult)"
}

# --- Fallback 1: CIM-based Windows Update API (works in Session 0 / SYSTEM context) ---
# MSFT_WUOperations lives in root/Microsoft/Windows/WindowsUpdate and does not
# require an interactive session, unlike the Microsoft.Update.Session COM object.
if ($comFailed) {
  try {
    $scan = Invoke-CimMethod -Namespace "root/Microsoft/Windows/WindowsUpdate" -ClassName "MSFT_WUOperations" -MethodName "ScanForUpdates" -Arguments @{ SearchCriteria = "IsInstalled=0 AND IsHidden=0" } -ErrorAction Stop
    # ReturnValue 0 == S_OK. Anything else means the scan did not run; leave
    # $comFailed set so the PSWindowsUpdate fallback still gets a chance.
    if ($scan.ReturnValue -ne 0) { throw "MSFT_WUOperations.ScanForUpdates returned $($scan.ReturnValue)" }
    # The result property name varies by build: MSFT_WUOperationsResult.Result
    # on some, .Updates on others. Accept whichever is populated.
    $updates = @()
    if ($scan.Updates) { $updates = @($scan.Updates) }
    elseif ($scan.Result) { $updates = @($scan.Result) }
    foreach ($u in $updates) {
      $kbs = @($u.KBArticleIDs | ForEach-Object { "KB$_" })
      $kbStr = ($kbs -join ", ")
      $cats = @()
      try { $cats = @($u.Categories | ForEach-Object { if ($_.Name) { $_.Name } else { "$_" } }) } catch {}
      $sev = ""
      try { $sev = "$($u.MsrcSeverity)" } catch {}
      $displayName = Get-WuDisplayName $u.Title $kbStr
      $guid = ""
      try { $guid = $u.Identity.UpdateID } catch {}
      if (-not $guid) { try { $guid = $u.UpdateID } catch {} }
      $supportUrl = ""
      try { $supportUrl = $u.SupportUrl } catch {}
      $revNum = 0
      try { $revNum = [int]$u.Identity.RevisionNumber } catch {}
      if (-not $revNum) { try { $revNum = [int]$u.RevisionNumber } catch {} }
      $result += @{
        Name             = $displayName
        CurrentVersion   = "pending"
        AvailableVersion = ""
        NeedsUpdate      = $true
        IsSecurityUpdate = (Test-WuSecurity $sev $u.Title $cats)
        WUAGuid          = $guid
        WUAKb            = $kbStr
        WUASeverity      = $sev
        WUACategories    = $cats
        WUASupportURL    = $supportUrl
        WUARevisionNumber = $revNum
      }
    }
    $comFailed = $false
  } catch {}
}

# --- Fallback 2: PSWindowsUpdate module (requires manual install; last resort) ---
if ($comFailed) {
  try {
    if (Get-Module -ListAvailable -Name PSWindowsUpdate) {
      Import-Module PSWindowsUpdate -ErrorAction Stop
      $wuList = Get-WUList -MicrosoftUpdate -ErrorAction Stop
      foreach ($u in $wuList) {
        $sev = if ($u.MsrcSeverity) { "$($u.MsrcSeverity)" } else { "" }
        $result += @{
          Name             = Get-WuDisplayName $u.Title $u.KB
          CurrentVersion   = "pending"
          AvailableVersion = ""
          NeedsUpdate      = $true
          IsSecurityUpdate = (Test-WuSecurity $sev $u.Title @())
          WUAGuid          = $u.UpdateID
          WUAKb            = $u.KB
          WUASeverity      = $sev
          WUACategories    = @()
          WUASupportURL    = ""
          WUARevisionNumber = 0
        }
      }
    }
  } catch {}
}

$result | ConvertTo-Json -Compress -Depth 4
`
	cmd, cancel := boundedCommand(networkCollectorTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", winexec.Script(psScript))
	defer cancel()
	output, err := cmd.Output()
	if err != nil {
		m.logger.WithError(err).Warn("Failed to query Windows updates")
		return nil
	}

	outputStr := strings.TrimSpace(string(winexec.TrimBOM(output)))
	// Check for COM error message (e.g. E_ACCESSDENIED in Session 0)
	if strings.Contains(outputStr, "WUA_COM_ERROR:") {
		idx := strings.Index(outputStr, "WUA_COM_ERROR:")
		end := idx + 120
		if end > len(outputStr) {
			end = len(outputStr)
		}
		msg := outputStr[idx:end]
		hint := wuaErrorHint(msg)
		m.logger.WithFields(logutil.SanitizeMap(map[string]interface{}{
			"detail": msg,
			"hint":   hint,
		})).Warn("Windows Update COM API failed")
		// Extract JSON array (Get-HotFix results) - it starts with [
		if jsonStart := strings.Index(outputStr, "["); jsonStart >= 0 {
			outputStr = outputStr[jsonStart:]
		} else {
			outputStr = ""
		}
	}

	if outputStr == "" || outputStr == "null" || outputStr == "[]" {
		return nil
	}

	// PowerShell may output a single object (not array) when there is exactly one result
	if !strings.HasPrefix(outputStr, "[") {
		outputStr = "[" + outputStr + "]"
	}

	var raw []struct {
		Name              string   `json:"Name"`
		CurrentVersion    string   `json:"CurrentVersion"`
		AvailableVersion  string   `json:"AvailableVersion"`
		NeedsUpdate       bool     `json:"NeedsUpdate"`
		IsSecurityUpdate  bool     `json:"IsSecurityUpdate"`
		WUAGuid           string   `json:"WUAGuid"`
		WUAKb             string   `json:"WUAKb"`
		WUASeverity       string   `json:"WUASeverity"`
		WUACategories     []string `json:"WUACategories"`
		WUASupportURL     string   `json:"WUASupportURL"`
		WUARevisionNumber int32    `json:"WUARevisionNumber"`
	}
	if err := json.Unmarshal([]byte(outputStr), &raw); err != nil {
		m.logger.WithError(err).Warn("Failed to parse Windows updates JSON")
		return nil
	}

	var packages []models.Package
	for _, u := range raw {
		if u.Name == "" {
			continue
		}
		cv := u.CurrentVersion
		if cv == "" {
			cv = "pending"
		}
		packages = append(packages, models.Package{
			Name:              u.Name,
			Category:          "Windows Update",
			CurrentVersion:    cv,
			AvailableVersion:  u.AvailableVersion,
			NeedsUpdate:       u.NeedsUpdate,
			IsSecurityUpdate:  u.IsSecurityUpdate,
			WUAGuid:           u.WUAGuid,
			WUAKb:             u.WUAKb,
			WUASeverity:       u.WUASeverity,
			WUACategories:     u.WUACategories,
			WUASupportURL:     u.WUASupportURL,
			WUARevisionNumber: u.WUARevisionNumber,
		})
	}
	return packages
}
