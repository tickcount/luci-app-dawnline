// Package store is changes to /etc/config/dawnline, the one way, as dawnline.store: under the config lock
// (the same lock file the ucode backend takes, so neither writes on the other's stale model), against the
// settings read inside that lock, written whole and kept readable by root only. A change that fails, or
// did not reach flash, never happened: nothing is written and the caller is told why.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Store is where the settings are.
type Store struct {
	// Config is the settings file; RunDir holds the lock and which servers are kept down.
	Config, RunDir string
}

// Unsaved is a change that could not be written: the flash is full or read-only.
type Unsaved struct{ Why error }

func (u Unsaved) Error() string {
	return fmt.Sprintf("Couldn't save /etc/config/dawnline: %s. Is the flash full?", u.Why)
}

// Read is the settings as they stand now, parsed and as a model.
func (s Store) Read() (*uci.Config, *model.Model, error) {
	text, err := os.ReadFile(s.Config)
	if err != nil && !os.IsNotExist(err) {
		return nil, nil, err
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		return nil, nil, err
	}
	var blocked map[string]any
	files.ReadJSON(s.RunDir+"/netifd-blocked.json", &blocked)
	return c, model.Load(c, blocked), nil
}

// Transact runs fn on the settings with the config lock held and writes them when fn returns nil. Whatever
// fn returns as an error aborts: nothing is written, and the error is passed on. fn changes c; m is the
// model of the settings before the change.
func (s Store) Transact(fn func(c *uci.Config, m *model.Model) error) error {
	defer files.Lock(s.RunDir, "config")()
	c, m, err := s.Read()
	if err != nil {
		return err
	}
	if err := fn(c, m); err != nil {
		return err
	}
	return s.write(c.Format())
}

// write puts the file in place whole: beside it under a hidden name (never a name `uci` would list as a
// configuration), on disk, then renamed over it.
func (s Store) write(text string) error {
	var r [4]byte
	rand.Read(r[:])
	tmp := filepath.Join(filepath.Dir(s.Config), "."+filepath.Base(s.Config)+".dl-"+hex.EncodeToString(r[:]))
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return Unsaved{err}
	}
	_, err = f.WriteString(text)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, 0o600)
	}
	if err == nil {
		err = os.Rename(tmp, s.Config)
	}
	if err != nil {
		os.Remove(tmp)
		return Unsaved{err}
	}
	return nil
}
