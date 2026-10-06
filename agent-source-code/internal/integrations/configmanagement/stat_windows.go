//go:build windows

package configmanagement

import "os"

// fileOwnerUID is a no-op on Windows: there is no POSIX uid to compare, so
// the owner check in methodFilePermissions is skipped.
func fileOwnerUID(_ os.FileInfo) (int, bool) {
	return 0, false
}