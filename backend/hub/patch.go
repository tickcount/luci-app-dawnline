// The difference between two versions of a document as a JSON Merge Patch
// (RFC 7396): an object that holds only what changed, null where a field went.
// Documents are what encoding/json makes of JSON (map[string]any, []any,
// float64, string, bool); they hold no null, which a merge patch could not
// tell from "remove this" (plain() drops them on the way in).
//
// Pure: no state, no clock. hub.go keeps the versions.
package hub

import (
	"encoding/json"
	"reflect"
)

// plain turns any value into a document: through encoding/json, so a struct
// is seen the way a client will see it, and without nulls.
func plain(v any) (any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return dropNulls(out), nil
}

// dropNulls removes null fields of objects, at any depth. A null inside an
// array stays: an array is replaced whole by a patch, never merged.
func dropNulls(v any) any {
	switch x := v.(type) {
	case map[string]any:
		for k, e := range x {
			if e == nil {
				delete(x, k)
			} else {
				x[k] = dropNulls(e)
			}
		}
	case []any:
		for i, e := range x {
			x[i] = dropNulls(e)
		}
	}
	return v
}

// Diff returns the merge patch that turns document a into b, and whether they
// differ at all. Objects are compared field by field; anything else (an
// array, a number, a string) is replaced whole when it changed. The patch
// shares b's values: neither may be changed afterwards.
func Diff(a, b any) (any, bool) {
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if !aok || !bok {
		if reflect.DeepEqual(a, b) {
			return nil, false
		}
		return b, true
	}
	patch := map[string]any{}
	for k := range am {
		if _, still := bm[k]; !still {
			patch[k] = nil
		}
	}
	for k, bv := range bm {
		av, had := am[k]
		if !had {
			patch[k] = bv
			continue
		}
		if p, changed := Diff(av, bv); changed {
			patch[k] = p
		}
	}
	return patch, len(patch) > 0
}

// Merge applies a merge patch to a document and returns the result. The
// document is changed in place where it is an object; what a client does with
// a patch, kept here so a test can hold Diff to it.
func Merge(doc, patch any) any {
	pm, ok := patch.(map[string]any)
	if !ok {
		return patch
	}
	dm, ok := doc.(map[string]any)
	if !ok {
		dm = map[string]any{}
	}
	for k, pv := range pm {
		if pv == nil {
			delete(dm, k)
			continue
		}
		dm[k] = Merge(dm[k], pv)
	}
	return dm
}
