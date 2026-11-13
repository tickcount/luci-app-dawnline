package ubus

import (
	"encoding/hex"
	"reflect"
	"testing"
)

// A table survives the wire: integers come back as int64, the rest as sent.
func TestTableRoundTrip(t *testing.T) {
	in := map[string]any{
		"name":  "Myata",
		"on":    true,
		"off":   false,
		"none":  nil,
		"small": 42,
		"neg":   -7,
		"big":   int64(5_000_000_000),
		"whole": float64(3),
		"frac":  1.5,
		"list":  []any{"a", int64(2), map[string]any{"k": "v"}},
		"deep":  map[string]any{"x": map[string]any{"y": []any{}}},
		"":      "an empty name",
	}
	b, err := encodeTable(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(b)%4 != 0 {
		t.Fatalf("%d bytes: not padded to 4", len(b))
	}
	got, err := decodeTable(b, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"name": "Myata", "on": true, "off": false, "none": nil,
		"small": int64(42), "neg": int64(-7), "big": int64(5_000_000_000), "whole": int64(3), "frac": 1.5,
		"list": []any{"a", int64(2), map[string]any{"k": "v"}},
		"deep": map[string]any{"x": map[string]any{"y": []any{}}},
		"":     "an empty name",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v\nwant %#v", got, want)
	}
}

// The bytes libubox writes for { "a": 1, "s": "hi" } (blobmsg_add_u32, blobmsg_add_string).
func TestKnownBytes(t *testing.T) {
	b, err := encodeTable(map[string]any{"a": 1, "s": "hi"})
	if err != nil {
		t.Fatal(err)
	}
	want := "8500000c" + "00016100" + "00000001" + // int32 "a" = 1
		"8300000b" + "00017300" + "68690000" // string "s" = "hi\0", 11 bytes padded to 12
	if got := hex.EncodeToString(b); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

// A struct goes the way encoding/json would write it.
func TestStructThroughJSON(t *testing.T) {
	type dev struct {
		ID     string `json:"id"`
		Online bool   `json:"online"`
		Rx     uint64 `json:"rx"`
	}
	b, err := encodeTable(map[string]any{"d": dev{"d1", true, 1 << 40}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeTable(b, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"d": map[string]any{"id": "d1", "online": true, "rx": int64(1 << 40)}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v", got)
	}
}

// Lengths that point past the end are an error, never a panic.
func TestTruncated(t *testing.T) {
	b, _ := encodeTable(map[string]any{"name": "Myata", "t": map[string]any{"k": []any{1, 2, 3}}})
	for n := 1; n < len(b); n++ {
		decodeTable(b[:n], 0)
	}
	bad := append([]byte{}, b...)
	bad[3] = 0xff
	if _, err := decodeTable(bad, 0); err == nil {
		t.Fatal("a length past the end was accepted")
	}
}
