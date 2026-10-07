// Package pkgversion provides version information for the agent
package pkgversion

// Version represents the current version of the patchmon-agent.
// This is a var (not const) so that -ldflags "-X ..." can override it at build time.
var Version = "1.6.8"

// VersionBanner is a single contiguous literal ("Monux Agent v1.6.3").
//
// The server extracts an agent's version by running `strings` over the binary
// in its agents/ folder, because it cannot execute a cross-compiled Windows
// .exe on Linux. That requires the banner to appear as one unbroken string in
// the binary. Building it at runtime from Version (a var) makes the compiler
// emit "Monux Agent v" and "1.6.3" as two separate literals, which the server's
// regex cannot match — leaving Windows auto-update permanently broken.
//
// Keep in sync with Version; both are overridden via -ldflags at release time.
var VersionBanner = "Monux Agent v1.6.8"
