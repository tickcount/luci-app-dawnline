// Package i18n puts the backend's messages into the admin's language, as dawnline.i18n does through LuCI's
// catalog reader: text is English in the code and looked up in the luci-i18n-dawnline-<lang> catalog
// (/usr/lib/lua/luci/i18n/dawnline.<lang>.lmo), placeholders filled after the lookup.
//
// A catalog: the translations, then an index entry per string sorted by key (key hash, number of forms,
// offset, length: big-endian uint32s), then the index's offset. A key is the msgid, "ctx\x01" before it and
// "\x02<n>" after it for plural form n; its hash is Paul Hsieh's SuperFastHash seeded with the length. The
// Plural-Forms formula sits under key 0. Held to LuCI's own reader on testdata (scripts/ucode-golden.sh).
package i18n

import (
	"encoding/binary"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Dir is where LuCI keeps its catalogs.
const Dir = "/usr/lib/lua/luci/i18n"

// A Catalog is one language's translations. A nil one speaks English.
type Catalog struct {
	data  []byte
	index []byte
	// plural is the Plural-Forms expression ("" when the catalog has none)
	plural string
}

var tag = regexp.MustCompile(`^[a-z][a-z][a-z]?([_-][A-Za-z][A-Za-z][A-Za-z]?[A-Za-z]?)?$`)

// Use is the catalog for a language as a page names it ("ru", "pt_BR"), or nil for English, a language
// with no Dawnline catalog, or anything that is no language.
func Use(dir, lang string) *Catalog {
	if lang == "en" || !tag.MatchString(lang) {
		return nil
	}
	c, _ := Load(dir + "/dawnline." + strings.ToLower(strings.ReplaceAll(lang, "_", "-")) + ".lmo")
	return c
}

// Load reads a catalog file.
func Load(path string) (*Catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(raw) < 4 {
		return nil, os.ErrInvalid
	}
	at := int(binary.BigEndian.Uint32(raw[len(raw)-4:]))
	if at > len(raw)-4 || (len(raw)-4-at)%16 != 0 {
		return nil, os.ErrInvalid
	}
	c := &Catalog{data: raw[:at], index: raw[at : len(raw)-4]}
	if formula, ok := c.find(0); ok {
		if i := strings.Index(formula, "plural="); i >= 0 {
			c.plural = strings.TrimSpace(strings.SplitN(formula[i+len("plural="):], ";", 2)[0])
		}
	}
	return c, nil
}

func (c *Catalog) find(key uint32) (string, bool) {
	n := len(c.index) / 16
	i := sort.Search(n, func(i int) bool { return binary.BigEndian.Uint32(c.index[i*16:]) >= key })
	if i == n || binary.BigEndian.Uint32(c.index[i*16:]) != key {
		return "", false
	}
	off, size := int(binary.BigEndian.Uint32(c.index[i*16+8:])), int(binary.BigEndian.Uint32(c.index[i*16+12:]))
	if off+size > len(c.data) {
		return "", false
	}
	return string(c.data[off : off+size]), true
}

// canon is a key as the reader looks it up: runs of white space are one space, none at either end.
func canon(s string) string {
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\v' || r == '\f' || r == '\r'
	}), " ")
}

// T is msg in the catalog's language: the English when it has no translation.
func (c *Catalog) T(msg string) string {
	if c != nil {
		if k := canon(msg); k != "" {
			if s, ok := c.find(hash([]byte(k))); ok {
				return s
			}
		}
	}
	return msg
}

// N is one or many for n, by the language's plural rules (Russian has three forms).
func (c *Catalog) N(n int64, one, many string) string {
	if c != nil && c.plural != "" {
		if form, ok := eval(c.plural, n); ok {
			if s, found := c.find(hash([]byte(canon(one) + "\x02" + strconv.FormatInt(form, 10)))); found {
				return s
			}
		}
	}
	if n == 1 {
		return one
	}
	return many
}

// hash is SuperFastHash of the bytes, seeded with their length (lmo.c sfh_hash).
func hash(data []byte) uint32 {
	if len(data) == 0 {
		return 0
	}
	get16 := func(i int) uint32 { return uint32(data[i]) | uint32(data[i+1])<<8 }
	s8 := func(i int) uint32 { return uint32(int32(int8(data[i]))) }
	h := uint32(len(data))
	i := 0
	for n := len(data) >> 2; n > 0; n, i = n-1, i+4 {
		h += get16(i)
		tmp := get16(i+2)<<11 ^ h
		h = h<<16 ^ tmp
		h += h >> 11
	}
	switch len(data) & 3 {
	case 3:
		h += get16(i)
		h ^= h << 16
		h ^= s8(i+2) << 18
		h += h >> 11
	case 2:
		h += get16(i)
		h ^= h << 11
		h += h >> 17
	case 1:
		h += s8(i)
		h ^= h << 10
		h += h >> 1
	}
	h ^= h << 3
	h += h >> 5
	h ^= h << 4
	h += h >> 17
	h ^= h << 25
	h += h >> 6
	return h
}

// eval works a Plural-Forms expression out for n: C's operators on whole numbers.
func eval(expr string, n int64) (v int64, ok bool) {
	p := &parser{s: expr, n: n}
	defer func() {
		if recover() != nil {
			v, ok = 0, false
		}
	}()
	v = p.ternary()
	p.space()
	return v, p.i == len(p.s)
}

type parser struct {
	s string
	i int
	n int64
}

func (p *parser) space() {
	for p.i < len(p.s) && (p.s[p.i] == ' ' || p.s[p.i] == '\t') {
		p.i++
	}
}

// take eats op when it is next (and not the start of a longer operator).
func (p *parser) take(op string) bool {
	p.space()
	if !strings.HasPrefix(p.s[p.i:], op) {
		return false
	}
	if rest := p.s[p.i+len(op):]; len(op) == 1 && rest != "" && strings.ContainsRune("<>!=", rune(op[0])) && rest[0] == '=' {
		return false
	}
	p.i += len(op)
	return true
}

func truth(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func (p *parser) ternary() int64 {
	c := p.or()
	if !p.take("?") {
		return c
	}
	a := p.ternary()
	if !p.take(":") {
		panic("no :")
	}
	b := p.ternary()
	if c != 0 {
		return a
	}
	return b
}

func (p *parser) or() int64 {
	v := p.and()
	for p.take("||") {
		r := p.and()
		v = truth(v != 0 || r != 0)
	}
	return v
}

func (p *parser) and() int64 {
	v := p.equal()
	for p.take("&&") {
		r := p.equal()
		v = truth(v != 0 && r != 0)
	}
	return v
}

func (p *parser) equal() int64 {
	v := p.compare()
	for {
		switch {
		case p.take("=="):
			v = truth(v == p.compare())
		case p.take("!="):
			v = truth(v != p.compare())
		default:
			return v
		}
	}
}

func (p *parser) compare() int64 {
	v := p.sum()
	for {
		switch {
		case p.take("<="):
			v = truth(v <= p.sum())
		case p.take(">="):
			v = truth(v >= p.sum())
		case p.take("<"):
			v = truth(v < p.sum())
		case p.take(">"):
			v = truth(v > p.sum())
		default:
			return v
		}
	}
}

func (p *parser) sum() int64 {
	v := p.product()
	for {
		switch {
		case p.take("+"):
			v += p.product()
		case p.take("-"):
			v -= p.product()
		default:
			return v
		}
	}
}

func (p *parser) product() int64 {
	v := p.unary()
	for {
		switch {
		case p.take("*"):
			v *= p.unary()
		case p.take("/"):
			v /= p.unary()
		case p.take("%"):
			v %= p.unary()
		default:
			return v
		}
	}
}

func (p *parser) unary() int64 {
	if p.take("!") {
		return truth(p.unary() == 0)
	}
	if p.take("(") {
		v := p.ternary()
		if !p.take(")") {
			panic("no )")
		}
		return v
	}
	if p.take("n") {
		return p.n
	}
	p.space()
	j := p.i
	for j < len(p.s) && p.s[j] >= '0' && p.s[j] <= '9' {
		j++
	}
	v, err := strconv.ParseInt(p.s[p.i:j], 10, 64)
	if err != nil {
		panic(err)
	}
	p.i = j
	return v
}
