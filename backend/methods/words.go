package methods

import (
	"unicode"
	"unicode/utf8"

	"github.com/tickcount/luci-app-dawnline/backend/i18n"
)

// Unworded is what a person is told for a failure that has no sentence of its own.
const Unworded = "Something went wrong on the router. Try again; if it goes on, look at the Log."

// Worded tells whether a failure's text is a sentence for a person: one of ours begins with a capital letter, an
// error Go wrote for programmers never does (Go's own convention: "open /etc/config/dawnline: no such file").
func Worded(msg string) bool {
	r, _ := utf8.DecodeRuneInString(msg)
	return unicode.IsUpper(r)
}

// wordsOf is what a failure says to a person, in their language: its own sentence, or, for an error that is not
// one, the plain sentence, the error itself going to the system log (`say`, nil: nowhere).
func wordsOf(t *i18n.Catalog, err error, say func(line string)) string {
	msg := err.Error()
	if Worded(msg) {
		return t.T(msg)
	}
	if say != nil {
		say(msg)
	}
	return t.T(Unworded)
}
