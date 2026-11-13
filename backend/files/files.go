// Package files is how the backend shares state on disk with the ucode that still runs: the same locks
// (flock on <run>/<name>.lock, dawnline.util lock()) and the same way of writing (a temporary file beside
// the real one, then a rename, so a reader never sees half a file and a full flash leaves the old one).
package files

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
)

// Lock takes the named lock of a state directory and returns its release. It waits for whoever holds it
// (the ucode holds these for the length of one read-change-write). A lock that cannot be taken at all (the
// directory is gone) is not an error to stop for: the release then does nothing.
func Lock(dir, name string) (unlock func()) {
	os.MkdirAll(dir, 0o755)
	f, err := os.OpenFile(filepath.Join(dir, name+".lock"), os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return func() {}
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return func() {}
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}
}

// Write puts data at path all at once: written beside it and renamed over it.
func Write(path string, data []byte, mode os.FileMode) error {
	var r [3]byte
	rand.Read(r[:])
	tmp := path + ".tmp" + hex.EncodeToString(r[:])
	if err := os.WriteFile(tmp, data, mode); err != nil {
		os.Remove(tmp)
		return err
	}
	// WriteFile's mode is cut by the umask: the mode asked for is the one a reader finds.
	if err := os.Chmod(tmp, mode); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// WriteJSON writes a value as JSON, all at once.
func WriteJSON(path string, v any, mode os.FileMode) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return Write(path, data, mode)
}

// ReadJSON reads a file into v; false when it is not there, empty or not JSON (v is then as it was).
func ReadJSON(path string, v any) bool {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return false
	}
	return json.Unmarshal(data, v) == nil
}
