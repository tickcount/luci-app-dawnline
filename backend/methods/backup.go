package methods

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// How many backups of each kind stay (the newest): the nightly ones must not push out what the admin made
// by hand or what a removal left behind. A kind not named keeps three.
var backupKeep = map[string]int{"manual": 10, "auto": 7, "pre-delete": 5, "pre-remove": 3, "pre-update": 3, "pre-restore": 3, "pre-import": 3}

// Kinds that hold the settings alone: made often, and never to bring history back.
var configOnly = map[string]bool{"auto": true, "pre-delete": true, "pre-remove": true, "pre-update": true}

var backupKind = regexp.MustCompile(`^[a-z0-9-]{1,24}$`)

// backupCreate makes a backup now and returns its name (dawnline.backup backup_create): the settings, and
// for the kinds that protect data about to be replaced the traffic history and the activity log too, as a
// tar.gz with the paths ucode's restore unpacks at /. Written whole or not at all. Of each kind the oldest
// beyond its number are removed.
func backupCreate(d Deps, reason string, keep ...string) (string, error) {
	kind := "manual"
	if backupKind.MatchString(reason) {
		kind = reason
	}
	// the live counters and log first, so the backup has them as they are now
	if !configOnly[kind] {
		if raw, err := os.ReadFile(d.RunDir + "/usage.json"); err == nil {
			files.Write(d.DataDir+"/usage.json", raw, 0o600)
		}
		if d.Store != nil {
			if _, m, err := d.Store.Read(); err == nil {
				journal.Log{Run: d.RunDir, Data: d.DataDir}.Persist(journal.PolicyOf(m.Settings.Retention), clock())
			}
		}
	}
	dir := d.DataDir + "/backups"
	os.MkdirAll(dir, 0o700)
	name := "dawnline-" + time.Unix(clock(), 0).In(zone.Local()).Format("20060102-150405")
	if kind != "manual" {
		name += "-" + kind
	}
	name += ".tar.gz"
	want := [][2]string{{"etc/config/dawnline", d.Config}}
	if !configOnly[kind] {
		want = append(want, [2]string{"etc/dawnline/usage.json", d.DataDir + "/usage.json"}, [2]string{"etc/dawnline/events.json", d.DataDir + "/events.json"})
	}
	// not a backup's name until it is complete
	tmp := dir + "/." + name + ".tmp"
	err := func() error {
		f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		zw := gzip.NewWriter(f)
		tw := tar.NewWriter(zw)
		for _, w := range want {
			raw, err := os.ReadFile(w[1])
			if err != nil {
				continue
			}
			st, _ := os.Stat(w[1])
			if err := tw.WriteHeader(&tar.Header{Name: w[0], Mode: 0o600, Size: int64(len(raw)), ModTime: st.ModTime(), Typeflag: tar.TypeReg, Uname: "root", Gname: "root"}); err != nil {
				return err
			}
			if _, err := tw.Write(raw); err != nil {
				return err
			}
		}
		if err := tw.Close(); err != nil {
			return err
		}
		if err := zw.Close(); err != nil {
			return err
		}
		return f.Sync()
	}()
	if err == nil {
		err = os.Rename(tmp, dir+"/"+name)
	}
	if err != nil {
		os.Remove(tmp)
		return "", errors.New("Backup failed: the archive could not be written (is the flash full?)")
	}
	os.Chmod(dir+"/"+name, 0o600)
	seen := map[string]int{}
	for _, b := range backups(dir) {
		// the new one, and the backup being restored: it must outlive the backup made just before restoring it
		if b["name"] == name || (len(keep) > 0 && b["name"] == keep[0]) {
			continue
		}
		k := b["reason"].(string)
		keep, known := backupKeep[k]
		if !known {
			keep = 3
		}
		if seen[k]++; seen[k] > keep {
			os.Remove(dir + "/" + b["name"].(string))
		}
	}
	return name, nil
}

// what a backup may hold, by its path in the archive
var backupFiles = []string{"etc/config/dawnline", "etc/dawnline/usage.json", "etc/dawnline/events.json"}

// The unpacked size a backup may have (an upload itself is limited to 4 MB).
const maxUnpacked = 16 * 1024 * 1024

// unpack reads a backup archive after checking it as dawnline.backup check_archive does: only Dawnline's own
// files, all of them regular files (no links, devices or directories), within a sane unpacked size, the
// settings among them.
func unpack(raw []byte) (map[string][]byte, error) {
	invalid := errors.New("Not a valid backup archive.")
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, invalid
	}
	tr := tar.NewReader(zr)
	out := map[string][]byte{}
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, invalid
		}
		name := strings.TrimPrefix(strings.TrimPrefix(h.Name, "."), "/")
		if h.Typeflag != tar.TypeReg {
			return nil, said{"Unexpected entry in backup: %s", []any{name}}
		}
		known := false
		for _, f := range backupFiles {
			known = known || f == name
		}
		if !known {
			return nil, said{"Unexpected file in backup: %s", []any{name}}
		}
		if total += h.Size; total > maxUnpacked {
			return nil, errors.New("Backup is too large.")
		}
		data, err := io.ReadAll(io.LimitReader(tr, maxUnpacked+1))
		if err != nil {
			return nil, invalid
		}
		out[name] = data
	}
	if out["etc/config/dawnline"] == nil {
		return nil, errors.New("Backup does not contain /etc/config/dawnline.")
	}
	return out, nil
}

// usable refuses settings that cannot replace the current ones, listing what is wrong with them.
func usable(d Deps, t *i18n.Catalog, text string) error {
	c, err := uci.Parse(text)
	if err != nil || len(c.Sections) == 0 {
		return errors.New("The configuration in this file cannot be read.")
	}
	// the router's networks that are not Dawnline's own tunnels' (the current settings say which those are)
	var foreign []string
	if d.Addresses != nil && d.Store != nil {
		ours := map[string]bool{}
		if _, now, err := d.Store.Read(); err == nil {
			for _, s := range now.Servers {
				ours[s.Ifname] = true
			}
		}
		for _, a := range d.Addresses() {
			if !ours[a.Iface] {
				foreign = append(foreign, a.CIDR)
			}
		}
	}
	if errs := health.ConfigErrors(model.Load(c, nil), t, parseFile("/etc/config/network"), foreign); len(errs) > 0 {
		return said{"This configuration can't be used: %s", []any{strings.Join(errs, " ")}}
	}
	return nil
}

// restore puts a backup's files in place: checked first, a backup of what is there made before, the
// settings written first under the config lock (when they cannot be, nothing else is touched), then the
// counters and the log, which the watcher takes up from flash; then ucode's full apply.
func restore(d Deps, lang string, raw []byte, name string) (map[string]any, error) {
	parts, err := unpack(raw)
	if err != nil {
		return nil, err
	}
	if err := usable(d, i18n.Use(d.Catalogs, lang), string(parts["etc/config/dawnline"])); err != nil {
		return nil, err
	}
	if _, err := backupCreate(d, "pre-restore", name); err != nil {
		return nil, err
	}
	os.MkdirAll(d.DataDir, 0o700)
	err = func() error {
		defer files.Lock(d.RunDir, "config")()
		for _, f := range [][2]string{{"etc/config/dawnline", d.Config}, {"etc/dawnline/usage.json", d.DataDir + "/usage.json"}, {"etc/dawnline/events.json", d.DataDir + "/events.json"}} {
			if data, has := parts[f[0]]; has {
				if files.Write(f[1], data, 0o600) != nil {
					return said{"Couldn't write %s. Is the flash full?", []any{"/" + f[0]}}
				}
			}
		}
		return nil
	}()
	if err != nil {
		return nil, err
	}
	// the live counters and log must follow the restored files: the watcher loads them from flash anew
	os.Remove(d.RunDir + "/usage.json")
	os.Remove(d.RunDir + "/events.json")
	files.Write(d.RunDir+"/usage.reload", []byte(strconv.FormatInt(clock(), 10)), 0o600)
	applied := map[string]any{}
	if d.Apply != nil {
		applied = d.Apply(lang)
	}
	if d.Told != nil {
		d.Told()
	}
	return applied, nil
}

// backupRestore brings a kept backup back.
func backupRestore(d Deps, name, lang string) (map[string]any, error) {
	if !backupFile.MatchString(name) {
		return nil, errors.New("Invalid backup name.")
	}
	raw, err := os.ReadFile(d.DataDir + "/backups/" + name)
	if err != nil {
		return nil, errors.New("Backup not found.")
	}
	out, err := restore(d, lang, raw, name)
	if err == nil && d.Log != nil {
		d.Log.Admin("dawnline", "restored", "backup", name, "")
	}
	return out, err
}

// backupUpload brings back a backup the admin sends (base64, 4 MB at most).
func backupUpload(d Deps, data, lang string) (map[string]any, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.Trim(data, blank))
	if err != nil || len(raw) == 0 || len(raw) > 4*1024*1024 {
		return nil, errors.New("Upload is empty or too large.")
	}
	out, err := restore(d, lang, raw, "")
	if err == nil && d.Log != nil {
		d.Log.Admin("dawnline", "restored", "backup", "from a file", "")
	}
	return out, err
}

var (
	sectionName = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)
	optionName  = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)
)

// importAll replaces the settings with an export (dawnline.backup import_json): only Dawnline's kinds of
// section, options that are strings or lists of them; checked as a restore's, a backup made before. A
// section's options are written in the order of their names (the bus hands them over as a map).
func importAll(d Deps, data any, lang string) (map[string]any, error) {
	o, _ := data.(map[string]any)
	sections, isList := o["sections"].([]any)
	if o == nil || o["format"] != "dawnline" || !isList {
		return nil, errors.New("Not a Dawnline export.")
	}
	kinds := map[string]bool{"settings": true, "server": true, "person": true, "device": true, "service": true, "circle": true}
	c := &uci.Config{}
	for _, x := range sections {
		s, _ := x.(map[string]any)
		name, _ := s[".name"].(string)
		kind, _ := s[".type"].(string)
		if s == nil || !kinds[kind] || !sectionName.MatchString(name) {
			return nil, said{"Invalid section %s.", []any{name}}
		}
		c.Add(kind, name)
		keys := make([]string, 0, len(s))
		for k := range s {
			if !strings.HasPrefix(k, ".") {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			if !optionName.MatchString(k) {
				return nil, said{"Invalid option %s.", []any{k}}
			}
			switch v := s[k].(type) {
			case string:
				// an empty value is written as it is: a cursor would drop it, a file keeps it
				sec := c.Section(name)
				sec.Values[k] = uci.Value{Str: v}
				sec.Order = append(sec.Order, k)
			case []any:
				var list []string
				for _, e := range v {
					str, isString := e.(string)
					if !isString {
						return nil, said{"Invalid option %s.", []any{k}}
					}
					list = append(list, str)
				}
				if len(list) > 0 {
					sec := c.Section(name)
					sec.Values[k] = uci.Value{IsList: true, List: list}
					sec.Order = append(sec.Order, k)
				}
			default:
				return nil, said{"Invalid option %s.", []any{k}}
			}
		}
	}
	text := c.Format()
	if err := usable(d, i18n.Use(d.Catalogs, lang), text); err != nil {
		return nil, err
	}
	if _, err := backupCreate(d, "pre-import"); err != nil {
		return nil, err
	}
	err := func() error {
		defer files.Lock(d.RunDir, "config")()
		if files.Write(d.Config, []byte(text), 0o600) != nil {
			return said{"Couldn't write %s. Is the flash full?", []any{"/etc/config/dawnline"}}
		}
		return nil
	}()
	if err != nil {
		return nil, err
	}
	applied := map[string]any{}
	if d.Apply != nil {
		applied = d.Apply(lang)
	}
	if d.Log != nil {
		d.Log.Admin("dawnline", "imported", "", "settings from a file", "")
	}
	if d.Told != nil {
		d.Told()
	}
	return applied, nil
}

// BackupCreate saves a backup of a kind ("auto": the nightly one) for who keeps the router on its own.
func BackupCreate(d Deps, kind string) (string, error) { return backupCreate(d, kind) }
