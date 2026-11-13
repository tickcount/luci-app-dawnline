package methods

import (
	"errors"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/i18n"
)

func TestWordsOf(t *testing.T) {
	none := i18n.Use("", "")
	var logged []string
	say := func(line string) { logged = append(logged, line) }
	if got := wordsOf(none, errors.New("Port 51820 is already taken."), say); got != "Port 51820 is already taken." || len(logged) != 0 {
		t.Fatalf("a sentence is said as it is: %q, logged %v", got, logged)
	}
	if got := wordsOf(none, errors.New("Порт занят."), say); got != "Порт занят." {
		t.Fatalf("a sentence in another script too: %q", got)
	}
	raw := "open /etc/config/dawnline: no such file or directory"
	if got := wordsOf(none, errors.New(raw), say); got != Unworded || len(logged) != 1 || logged[0] != raw {
		t.Fatalf("Go's own error is not said, it is logged: %q, logged %v", got, logged)
	}
	if got := wordsOf(none, errors.New(""), nil); got != Unworded {
		t.Fatalf("nothing to say is not a sentence: %q", got)
	}
}
