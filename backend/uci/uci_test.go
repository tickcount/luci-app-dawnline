package uci

import (
	"os"
	"reflect"
	"testing"
)

func TestParse(t *testing.T) {
	c, err := Parse(`# a comment
package dawnline

config settings 'settings'
	option portal_enabled '1'   # after a value
	option quoted "a \"b\" c"
	option glued 'one'"two"three
	option bare vpn.example.com
	list update_targets 'app'
	list update_targets 'packages'
	option twice 'old'
	option twice 'new'
	option then_list 'first'
	list then_list 'second'
	option lines 'two
lines'

config server main; option name Main
config device
	option name 'no name of its own'
config settings 'settings'
	option later 'merged'
`)
	if err != nil {
		t.Fatal(err)
	}
	s := c.Section("settings")
	want := map[string]Value{
		"portal_enabled": {Str: "1"},
		"quoted":         {Str: `a "b" c`},
		"glued":          {Str: "onetwothree"},
		"bare":           {Str: "vpn.example.com"},
		"update_targets": {IsList: true, List: []string{"app", "packages"}},
		"twice":          {Str: "new"},
		"then_list":      {IsList: true, List: []string{"first", "second"}},
		"lines":          {Str: "two\nlines"},
		"later":          {Str: "merged"},
	}
	if !reflect.DeepEqual(s.Values, want) {
		t.Fatalf("settings: %#v", s.Values)
	}
	if len(c.Sections) != 3 || c.Sections[1].Name != "main" || c.Sections[1].Values["name"].Str != "Main" {
		t.Fatalf("sections: %+v", c.Sections)
	}
	if d := c.OfType("device"); len(d) != 1 || !d[0].Anonymous || d[0].Name == "" {
		t.Fatalf("the anonymous section: %+v", d)
	}
	if _, ok := s.Get("update_targets"); ok {
		t.Fatal("a list read as one string")
	}
}

func TestParseErrors(t *testing.T) {
	for _, text := range []string{"option a b", "config", "config s 'x'\noption a", "config s x\noption a 'open", "frobnicate x"} {
		if _, err := Parse(text); err == nil {
			t.Errorf("%q was accepted", text)
		}
	}
}

// The project's own fixture parses whole.
func TestFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/household.uci")
	if err != nil {
		t.Skip(err)
	}
	c, err := Parse(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.OfType("server")) != 1 || len(c.OfType("person")) != 2 || len(c.OfType("device")) != 1 {
		t.Fatalf("sections: %d servers, %d people, %d devices", len(c.OfType("server")), len(c.OfType("person")), len(c.OfType("device")))
	}
}
