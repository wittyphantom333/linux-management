// Package pkgversion provides version information for the agent
package pkgversion

// Version represents the current version of the patchmon-agent.
// This is a var (not const) so that -ldflags "-X ..." can override it at build time.
var Version = "1.6.3"
