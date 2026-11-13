package methods

import (
	"errors"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// uninstall removes Dawnline's state from the router (the package is removed by the page afterwards): a
// backup first, then the settings emptied but for the settings section, then everything Dawnline made on
// the router taken away, then the service stopped.
//
// The settings go first: whatever applies in between (the agent's tick) then works from settings with
// nothing in them, and puts nothing back. The service stops last, once the answer is out: this process is
// part of it.
func uninstall(d Deps, confirm string) (map[string]any, error) {
	if confirm != "remove" {
		return nil, errors.New(`Type "remove" to confirm.`)
	}
	// not in the middle of an update (the package manager may be installing Dawnline itself)
	if updating(d.RunDir) {
		return nil, errors.New("An update is running: wait for it to finish, then remove Dawnline.")
	}
	if d.Teardown == nil || d.Store == nil {
		return nil, errors.New("Dawnline cannot be removed from here.")
	}
	backupCreate(d, "pre-remove")
	var was *model.Model
	err := d.Store.Transact(func(c *uci.Config, m *model.Model) error {
		was = m
		var rm []string
		for _, s := range c.Sections {
			if s.Type != "settings" {
				rm = append(rm, s.Name)
			}
		}
		for _, n := range rm {
			c.DeleteSection(n)
		}
		if c.Section("settings") == nil {
			c.Add("settings", "settings")
		}
		c.Set("settings", "portal_enabled", "0")
		return nil
	})
	if err != nil {
		return nil, err
	}
	d.Teardown(was)
	if d.Stop != nil {
		d.Stop()
	}
	return map[string]any{"ok": true}, nil
}
