package hub

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func doc(s string) any {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		panic(err)
	}
	return v
}

// A patch holds only what changed, and applying it gives the new document.
func TestDiffAndMerge(t *testing.T) {
	cases := []struct{ a, b, patch string }{
		{`{"a":1,"b":2}`, `{"a":1,"b":3}`, `{"b":3}`},
		{`{"a":1,"b":2}`, `{"a":1}`, `{"b":null}`},
		{`{"a":1}`, `{"a":1,"c":{"d":true}}`, `{"c":{"d":true}}`},
		{`{"p":{"d1":{"online":false,"rx":1},"d2":{"online":true}}}`, `{"p":{"d1":{"online":true,"rx":1},"d2":{"online":true}}}`, `{"p":{"d1":{"online":true}}}`},
		{`{"l":[1,2,3]}`, `{"l":[1,2]}`, `{"l":[1,2]}`},
		{`{"a":{"b":1}}`, `{"a":"text"}`, `{"a":"text"}`},
		{`{"a":"text"}`, `{"a":{"b":1}}`, `{"a":{"b":1}}`},
	}
	for _, c := range cases {
		patch, changed := Diff(doc(c.a), doc(c.b))
		if !changed {
			t.Fatalf("%s → %s: no change seen", c.a, c.b)
		}
		if !reflect.DeepEqual(patch, doc(c.patch)) {
			got, _ := json.Marshal(patch)
			t.Fatalf("%s → %s: patch %s, want %s", c.a, c.b, got, c.patch)
		}
		if got := Merge(doc(c.a), patch); !reflect.DeepEqual(got, doc(c.b)) {
			t.Fatalf("%s + %s did not give %s", c.a, c.patch, c.b)
		}
	}
	if _, changed := Diff(doc(`{"a":[1,{"b":2}]}`), doc(`{"a":[1,{"b":2}]}`)); changed {
		t.Fatal("equal documents differ")
	}
}

// Nulls never reach a document: a patch could not tell one from a removal.
func TestPlainDropsNulls(t *testing.T) {
	got, err := plain(map[string]any{"a": nil, "b": map[string]any{"c": nil, "d": 1}, "l": []any{nil, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, doc(`{"b":{"d":1},"l":[null,1]}`)) {
		t.Fatalf("got %v", got)
	}
}

func TestPutPublishesOnlyChanges(t *testing.T) {
	h := New()
	sub := h.Follow()
	defer sub.Close()
	h.Put("people", doc(`{"p1":{"name":"Myata","online":false}}`))
	h.Put("people", doc(`{"p1":{"name":"Myata","online":false}}`)) // the same: nothing
	h.Put("people", doc(`{"p1":{"name":"Myata","online":true}}`))
	first, second := <-sub.Events(), <-sub.Events()
	if first.Seq != 1 || first.Op != OpPut || second.Seq != 2 || second.Op != OpPatch {
		t.Fatalf("events: %+v %+v", first, second)
	}
	if !reflect.DeepEqual(second.Data, doc(`{"p1":{"online":true}}`)) {
		t.Fatalf("patch: %v", second.Data)
	}
	select {
	case e := <-sub.Events():
		t.Fatalf("an event for nothing: %+v", e)
	default:
	}
}

// A reader gets a snapshot first, then what it missed; from another run or
// too far behind, a snapshot again.
func TestSync(t *testing.T) {
	h := New()
	h.Put("a", doc(`{"x":1}`))
	h.Put("b", doc(`{"y":1}`))
	snap := h.Sync("", 0, nil)
	if snap.Seq != 2 || len(snap.Docs) != 2 || snap.Events != nil {
		t.Fatalf("snapshot: %+v", snap)
	}
	h.Put("a", doc(`{"x":2}`))
	h.Put("b", doc(`{"y":2}`))
	only := func(topic string) bool { return topic == "a" }
	got := h.Sync(snap.Epoch, snap.Seq, only)
	if got.Docs != nil || len(got.Events) != 1 || got.Events[0].Topic != "a" || got.Seq != 4 {
		t.Fatalf("catch-up: %+v", got)
	}
	// A snapshot taken before anything was published is followed from the first event.
	if early := h.Sync(snap.Epoch, 0, nil); early.Docs != nil || len(early.Events) != 4 {
		t.Fatalf("from zero: %+v", early)
	}
	if up := h.Sync(snap.Epoch, 4, nil); up.Docs != nil || len(up.Events) != 0 {
		t.Fatalf("up to date: %+v", up)
	}
	if other := h.Sync("another-run", 3, nil); other.Docs == nil {
		t.Fatal("a number of another run was taken for ours")
	}
	if ahead := h.Sync(snap.Epoch, 99, nil); ahead.Docs == nil {
		t.Fatal("a number ahead of the hub was accepted")
	}
	for i := 0; i < journalSize+10; i++ {
		h.Put("a", map[string]any{"x": i + 10})
	}
	if far := h.Sync(snap.Epoch, 4, nil); far.Docs == nil {
		t.Fatal("events no longer kept were promised")
	}
}

func TestAppendKeepsNewest(t *testing.T) {
	h := New()
	h.Append("meter", 3, 1, 2)
	h.Append("meter", 3, 3, 4)
	snap := h.Sync("", 0, nil)
	if !reflect.DeepEqual(snap.Docs["meter"], doc(`[2,3,4]`)) {
		t.Fatalf("list: %v", snap.Docs["meter"])
	}
	ev := h.Sync(snap.Epoch, 1, nil).Events
	if len(ev) != 1 || ev[0].Op != OpAppend || !reflect.DeepEqual(ev[0].Data, doc(`{"items":[3,4],"keep":3}`)) {
		t.Fatalf("event: %+v", ev)
	}
}

// Wait holds until something the reader wants happens, and gives up with its context.
func TestWait(t *testing.T) {
	h := New()
	h.Put("a", doc(`{"x":1}`))
	at := h.Sync("", 0, nil)
	only := func(topic string) bool { return topic == "a" }
	got := make(chan Answer, 1)
	go func() { got <- h.Wait(context.Background(), at.Epoch, at.Seq, only) }()
	h.Put("b", doc(`{"y":1}`)) // not wanted: the wait goes on
	select {
	case a := <-got:
		t.Fatalf("answered for another topic: %+v", a)
	case <-time.After(50 * time.Millisecond):
	}
	h.Put("a", doc(`{"x":2}`))
	select {
	case a := <-got:
		if len(a.Events) != 1 || a.Seq != 3 {
			t.Fatalf("answer: %+v", a)
		}
	case <-time.After(time.Second):
		t.Fatal("never answered")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if a := h.Wait(ctx, at.Epoch, 3, only); len(a.Events) != 0 || a.Docs != nil || a.Seq != 3 {
		t.Fatalf("timed out with: %+v", a)
	}
}

// A follower that does not read is let go, not waited for.
func TestSlowFollowerIsDropped(t *testing.T) {
	h := New()
	sub := h.Follow()
	for i := 0; i < 300; i++ {
		h.Put("a", map[string]any{"x": i})
	}
	n := 0
	for range sub.Events() {
		n++
	}
	if n != 256 {
		t.Fatalf("read %d events before the channel closed", n)
	}
	sub.Close() // closing again is harmless
}
