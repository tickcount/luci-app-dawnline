package uci

import "strings"

// Writing a file as libuci commits it, and changing one as a cursor does, so that what the Go backend
// saves is byte for byte what the ucode backend would have (testdata/write.uc, scripts/ucode-golden.sh):
//
//	config <type> '<name>'
//		option <name> '<value>'
//		list <name> '<entry>'
//
// each section after an empty line, a single quote inside a value as '\''.

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// Format is the file's text.
func (c *Config) Format() string {
	var b strings.Builder
	for _, s := range c.Sections {
		b.WriteString("\nconfig " + s.Type)
		if !s.Anonymous {
			b.WriteString(" " + quote(s.Name))
		}
		b.WriteString("\n")
		for _, name := range s.Order {
			v, ok := s.Values[name]
			if !ok {
				continue
			}
			if !v.IsList {
				b.WriteString("\toption " + name + " " + quote(v.Str) + "\n")
				continue
			}
			for _, e := range v.List {
				b.WriteString("\tlist " + name + " " + quote(e) + "\n")
			}
		}
	}
	// the file ends with an empty line
	if len(c.Sections) > 0 {
		b.WriteString("\n")
	}
	return b.String()
}

// Add makes a section, or gives the one of that name another type (its options stay). It returns the section.
func (c *Config) Add(kind, name string) *Section {
	return c.open(kind, name)
}

// Set gives an option a value; it keeps its place when it was there, else goes last. An empty value
// removes the option, as a cursor does. False when there is no such section.
func (c *Config) Set(section, option, value string) bool {
	s := c.Section(section)
	if s == nil {
		return false
	}
	if value == "" {
		s.remove(option)
		return true
	}
	if _, had := s.Values[option]; !had {
		s.Order = append(s.Order, option)
	}
	s.Values[option] = Value{Str: value}
	return true
}

// SetList gives an option a list of entries. An empty list changes nothing and is refused, as a cursor
// refuses it.
func (c *Config) SetList(section, option string, list []string) bool {
	s := c.Section(section)
	if s == nil || len(list) == 0 {
		return false
	}
	// The cursor's own ways, as the goldens have them: a list of one entry is taken out and added anew, so
	// it goes last whatever was there; a longer one is set in the place of what was there (its first entry
	// set, the others added to it), and goes last only when nothing was.
	if len(list) == 1 {
		s.remove(option)
	}
	if _, had := s.Values[option]; !had {
		s.Order = append(s.Order, option)
	}
	s.Values[option] = Value{IsList: true, List: append([]string{}, list...)}
	return true
}

func (s *Section) remove(option string) bool {
	if _, had := s.Values[option]; !had {
		return false
	}
	delete(s.Values, option)
	for i, n := range s.Order {
		if n == option {
			s.Order = append(s.Order[:i], s.Order[i+1:]...)
			break
		}
	}
	return true
}

// Delete removes an option; false when it was not there.
func (c *Config) Delete(section, option string) bool {
	s := c.Section(section)
	return s != nil && s.remove(option)
}

// DeleteSection removes a section; false when it was not there.
func (c *Config) DeleteSection(name string) bool {
	for i, s := range c.Sections {
		if s.Name == name {
			c.Sections = append(c.Sections[:i], c.Sections[i+1:]...)
			return true
		}
	}
	return false
}
