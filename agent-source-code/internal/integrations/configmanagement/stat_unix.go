//go:build !windows

package configmanagement

import (
	"os"
	"syscall"
)

// fileOwnerUID extracts the owning user's UID from a file's stat info.
// POSIX-only: Windows has no POSIX uid, so the owner check is skipped there.
func fileOwnerUID(info os.FileInfo) (int, bool) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, false
	}
	return int(stat.Uid), true
}