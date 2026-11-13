package methods

import (
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

var olderDays = regexp.MustCompile(`^[1-9][0-9]{0,3}$`)

// logsClear removes activity by person, device, category and/or age; nothing given clears it all
// (dawnline.rpc.status logs_clear). What went is written in the service log.
func logsClear(w *view.World, d Deps, person, device, category, older string) (map[string]any, error) {
	f := journal.Filter{Device: device}
	if person != "" {
		if w.M.People[person] == nil {
			return nil, errors.New("Unknown person.")
		}
		f.Person = person
	}
	if category != "" {
		known := false
		for _, c := range journal.Categories {
			known = known || c == category
		}
		if !known {
			return nil, errors.New("Unknown category.")
		}
		f.Category = category
	}
	if older != "" {
		if !olderDays.MatchString(older) {
			return nil, errors.New("Older than must be a number of days.")
		}
		days, _ := strconv.ParseInt(older, 10, 64)
		f.Before = time.Now().Unix() - days*86400
	}
	removed := journal.Log{Run: d.RunDir, Data: d.DataDir}.Clear(f)
	if removed > 0 && d.Log != nil {
		note := []string{strconv.Itoa(removed) + " event"}
		if removed != 1 {
			note[0] += "s"
		}
		if f.Category != "" {
			note = append(note, f.Category)
		}
		if f.Person != "" {
			note = append(note, w.M.People[f.Person].Name)
		}
		if older != "" {
			note = append(note, "older than "+older+" days")
		}
		d.Log.Admin("dawnline", "cleared", "", "the activity log", strings.Join(note, " · "))
	}
	return map[string]any{"ok": true, "removed": removed}, nil
}

// serviceLogClear removes the service log's entries, all of them or those older than a number of days.
func serviceLogClear(d Deps, older string) map[string]any {
	// as ucode reads the number: anything that is not one clears it all
	days, _ := strconv.ParseInt(strings.TrimSpace(older), 10, 64)
	if days < 0 {
		days = 0
	}
	removed := 0
	if d.Log != nil {
		removed = d.Log.Clear(d.DataDir, days)
		if removed > 0 {
			note := strconv.Itoa(removed) + " entries"
			if removed == 1 {
				note = "1 entry"
			}
			if days > 0 {
				note += " older than " + older + " days"
			}
			d.Log.Admin("dawnline", "cleared", "", "the service log", note)
		}
	}
	return map[string]any{"removed": removed}
}

// usageClear forgets traffic history: everyone's, a person's (with their devices and their limit), a
// device's, or a person's limit month alone (dawnline.rpc.status usage_clear).
func usageClear(w *view.World, d Deps, scope, id string) (map[string]any, error) {
	m := w.M
	who := "for everyone"
	switch scope {
	case "all":
	case "person", "limit":
		if m.People[id] == nil {
			return nil, errors.New("Unknown person.")
		}
		who = "for " + m.People[id].Name
	case "device":
		dev := m.Devices[id]
		if dev == nil {
			return nil, errors.New("Unknown device.")
		}
		owner := ""
		if p := m.People[dev.Person]; p != nil {
			owner = p.Name
		}
		who = "for " + dev.Name + " (" + owner + ")"
	default:
		return nil, errors.New("Unknown scope.")
	}
	if d.ResetUsage == nil || !d.ResetUsage(scope, id) {
		return nil, errors.New("The router is still starting. Try again in a moment.")
	}
	if d.Log != nil {
		msg := "reset traffic history"
		if scope == "limit" {
			msg = "reset the data limit's usage"
		}
		d.Log.Admin("dawnline", msg, "", who, "")
	}
	return map[string]any{"ok": true}, nil
}

// geoClear forgets the places found for addresses, in the live copy and on flash.
func geoClear(d Deps) map[string]any {
	empty := map[string]any{"ips": map[string]any{}, "home": nil}
	os.MkdirAll(d.RunDir, 0o755)
	files.WriteJSON(d.RunDir+"/geo.json", empty, 0o600)
	os.MkdirAll(d.DataDir, 0o700)
	files.WriteJSON(d.DataDir+"/geo.json", empty, 0o600)
	return map[string]any{"ok": true}
}

// backupDelete removes a backup by its name.
func backupDelete(dir, name string) (map[string]any, error) {
	if !backupFile.MatchString(name) {
		return nil, errors.New("Invalid backup name.")
	}
	if !exists(dir + "/" + name) {
		return nil, errors.New("Backup not found.")
	}
	os.Remove(dir + "/" + name)
	return map[string]any{"ok": true}, nil
}
