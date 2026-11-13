//go:build unix

package bridge

import (
	"os"
	"syscall"
)

// inode is the file's inode number (0 when the system does not tell).
func inode(st os.FileInfo) uint64 {
	if s, ok := st.Sys().(*syscall.Stat_t); ok {
		return uint64(s.Ino)
	}
	return 0
}
