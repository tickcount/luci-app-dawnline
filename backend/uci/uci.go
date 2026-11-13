// Package uci reads a configuration file of OpenWrt's UCI the way libuci does, without the uci program:
// the backend reads /etc/config/dawnline on every change, and a test reads fixtures on any system.
//
// Reading only. Whoever writes the file (the ucode backend's store, until the model's writer is ported)
// replaces it whole; this package never holds it open.
//
// The syntax, as libuci's parser takes it: one command a line (or several parted by `;`), `package`,
// `config <type> [<name>]`, `option <name> <value>`, `list <name> <value>`; a word is bare, in single
// quotes (taken as written) or in double quotes (a backslash takes the next character), and pieces that
// touch are one word; `#` begins a comment where a word could begin.
package uci

import (
	"fmt"
	"strings"
)

// Value is what an option holds: one string (`option`), or a list (`list`, one entry a line).
type Value struct {
	Str    string
	List   []string
	IsList bool
}

// Section is one `config` block.
type Section struct {
	Type string
	Name string
	// Anonymous: the file gave it no name. libuci names such a section by its place and a hash of its
	// content; here it gets its place only (Dawnline's own file names every section).
	Anonymous bool
	Values    map[string]Value
	// Order is the options' names in the order they stand in the file: what is written keeps it.
	Order []string
}

// Config is a parsed file: its sections in the order they stand.
type Config struct {
	Sections []*Section
}

// Get returns an option's string. A list has none (ok is false): its entries are List's.
func (s *Section) Get(name string) (string, bool) {
	v, ok := s.Values[name]
	if !ok || v.IsList {
		return "", false
	}
	return v.Str, true
}

// Section returns the section of that name, or nil.
func (c *Config) Section(name string) *Section {
	for _, s := range c.Sections {
		if s.Name == name {
			return s
		}
	}
	return nil
}

// OfType returns the sections of a type, in the file's order.
func (c *Config) OfType(kind string) []*Section {
	var out []*Section
	for _, s := range c.Sections {
		if s.Type == kind {
			out = append(out, s)
		}
	}
	return out
}

// Parse reads a file's text.
func Parse(text string) (*Config, error) {
	cmds, err := commands(text)
	if err != nil {
		return nil, err
	}
	c := &Config{}
	var cur *Section
	for _, cmd := range cmds {
		w := cmd.words
		switch w[0] {
		case "package":
			// one package a file; its name is the file's
		case "config":
			if len(w) < 2 {
				return nil, fmt.Errorf("uci: line %d: config without a type", cmd.line)
			}
			name := ""
			if len(w) > 2 {
				name = w[2]
			}
			cur = c.open(w[1], name)
		case "option", "list":
			if cur == nil {
				return nil, fmt.Errorf("uci: line %d: %s outside a section", cmd.line, w[0])
			}
			if len(w) < 3 {
				return nil, fmt.Errorf("uci: line %d: %s needs a name and a value", cmd.line, w[0])
			}
			cur.set(w[1], w[2], w[0] == "list")
		default:
			return nil, fmt.Errorf("uci: line %d: unknown command %q", cmd.line, w[0])
		}
	}
	return c, nil
}

// open starts a section. A name the file used before goes on with that section (its type becomes the new
// one), as libuci merges them.
func (c *Config) open(kind, name string) *Section {
	if name != "" {
		if s := c.Section(name); s != nil {
			s.Type = kind
			return s
		}
	}
	s := &Section{Type: kind, Name: name, Values: map[string]Value{}}
	if name == "" {
		s.Anonymous = true
		s.Name = fmt.Sprintf("cfg%02x", len(c.Sections)+1)
	}
	c.Sections = append(c.Sections, s)
	return s
}

// set stores a value: an option replaces what was there; a list entry is added to a list, and turns an
// option of that name into a list that begins with it.
func (s *Section) set(name, value string, list bool) {
	if _, had := s.Values[name]; !had {
		s.Order = append(s.Order, name)
	}
	if !list {
		s.Values[name] = Value{Str: value}
		return
	}
	old, had := s.Values[name]
	switch {
	case !had:
		s.Values[name] = Value{IsList: true, List: []string{value}}
	case old.IsList:
		old.List = append(old.List, value)
		s.Values[name] = old
	default:
		s.Values[name] = Value{IsList: true, List: []string{old.Str, value}}
	}
}

type command struct {
	words []string
	// line is where the command begins, for an error.
	line int
}

// commands cuts a file into commands: a line, or a part of one up to a `;`. A quoted word may run over
// several lines (a value with line breaks in it).
func commands(text string) ([]command, error) {
	var out []command
	var cur []string
	line, began := 1, 1
	flush := func() {
		if len(cur) > 0 {
			out = append(out, command{words: cur, line: began})
		}
		cur = nil
	}
	i := 0
	for i < len(text) {
		switch c := text[i]; {
		case c == '\n':
			flush()
			line++
			i++
		case c == ' ' || c == '\t' || c == '\r':
			i++
		case c == ';':
			flush()
			i++
		case c == '#':
			for i < len(text) && text[i] != '\n' {
				i++
			}
		default:
			if len(cur) == 0 {
				began = line
			}
			var b strings.Builder
		piece:
			for i < len(text) {
				switch c := text[i]; c {
				case ' ', '\t', '\r', '\n', ';':
					break piece
				case '\'':
					end := strings.IndexByte(text[i+1:], '\'')
					if end < 0 {
						return nil, fmt.Errorf("uci: line %d: a single quote is not closed", line)
					}
					quoted := text[i+1 : i+1+end]
					line += strings.Count(quoted, "\n")
					b.WriteString(quoted)
					i += end + 2
				case '"':
					i++
					closed := false
					for i < len(text) {
						if text[i] == '\\' && i+1 < len(text) {
							b.WriteByte(text[i+1])
							i += 2
							continue
						}
						if text[i] == '"' {
							i++
							closed = true
							break
						}
						if text[i] == '\n' {
							line++
						}
						b.WriteByte(text[i])
						i++
					}
					if !closed {
						return nil, fmt.Errorf("uci: line %d: a double quote is not closed", line)
					}
				case '\\':
					if i+1 < len(text) {
						b.WriteByte(text[i+1])
						i += 2
					} else {
						i++
					}
				default:
					b.WriteByte(c)
					i++
				}
			}
			cur = append(cur, b.String())
		}
	}
	flush()
	return out, nil
}
