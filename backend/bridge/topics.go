// The ucode backend's `status` answer cut into the topics pages follow.
//
// `status` is one large document that every admin page used to fetch whole.
// As topics, a change in one place (a device came online) is a patch of a few
// bytes to one of them, and a page follows only those it shows. Lists of
// things that have an id (people, devices, servers) become keyed lists, so a
// change to one entry does not resend the list.
//
// Pure: a document in, documents out. bridge.go fetches and publishes.
package bridge

// A keyed list is how a list of things with ids is published:
//
//	{ "order": ["p1", "p2"], "items": { "p1": {…}, "p2": {…} } }
//
// A merge patch replaces an array whole, but reaches into an object: with
// the entries under their ids, one that changed is all that is sent, and
// `order` only when something came, went or moved. A daily series (traffic
// by the day) is keyed by its `day` the same way: every minute moves today's
// entry, and on the router that alone was most of what a refresh resent.
func keyed(list []any) (map[string]any, bool) {
	for _, key := range []string{"id", "day"} {
		if k, ok := keyedBy(list, key); ok {
			return k, true
		}
	}
	return nil, false
}

// keyedBy keys a list by one field, when every entry has it, as a string of
// its own.
func keyedBy(list []any, key string) (map[string]any, bool) {
	order := make([]any, 0, len(list))
	items := make(map[string]any, len(list))
	for _, e := range list {
		m, ok := e.(map[string]any)
		if !ok {
			return nil, false
		}
		id, ok := m[key].(string)
		if !ok || id == "" {
			return nil, false
		}
		if _, twice := items[id]; twice {
			return nil, false
		}
		order = append(order, id)
		items[id] = m
	}
	return map[string]any{"order": order, "items": items}, true
}

// Null stands for a null of the ucode answer: a topic holds none (a merge patch reads null as "remove this"),
// and the pages' code tells "no link trouble" (null) from "not told" (absent). A field that was null is
// published as { "$null": true } and read back as null (web/src/admin/state/join.ts). Only this bridge
// needs it: a producer written for the stream leaves out what it has nothing to say about.
const Null = "$null"

// rekey turns every list of things with ids (or days) inside v into a keyed
// list, at any depth (a person's devices inside the list of people). A list of
// anything else stays a list. An empty list stays one too: it cannot be told
// what it would hold.
func rekey(v any) any {
	switch x := v.(type) {
	case nil:
		return map[string]any{Null: true}
	case map[string]any:
		for k, e := range x {
			x[k] = rekey(e)
		}
	case []any:
		for i, e := range x {
			x[i] = rekey(e)
		}
		if len(x) > 0 {
			if k, ok := keyed(x); ok {
				return k
			}
		}
	}
	return v
}

// Where each field of `status` goes. A field not named here goes to "router",
// so one a later version adds is still published.
var topicOf = map[string]string{
	"servers":  "servers",
	"people":   "people",
	"circles":  "circles",
	"services": "services",
	"totals":   "traffic",
	"series":   "traffic",
	"hours":    "traffic",
	"geo":      "places",
	"events":   "recent",
	"now":      "clock",
	"tz":       "clock",
}

// Topics lists the topics Split fills, for hello and the tests.
var Topics = []string{"router", "servers", "people", "circles", "services", "traffic", "places", "recent", "clock"}

// whole names the topics that are one field of `status` as it is; the others
// are objects of several fields.
var whole = map[string]bool{"servers": true, "people": true, "circles": true, "services": true, "places": true, "recent": true}

// lists names the topics that are a keyed list even while empty, so a page
// reads one shape whether or not there is anyone yet.
var lists = map[string]bool{"servers": true, "people": true, "circles": true, "services": true}

// Split cuts a `status` answer into topics. The answer is taken apart, not
// copied: the caller gives it up.
func Split(status map[string]any) map[string]any {
	out := map[string]any{}
	for _, t := range Topics {
		if !whole[t] {
			out[t] = map[string]any{}
		}
	}
	for field, v := range status {
		topic, ok := topicOf[field]
		if !ok {
			topic = "router"
		}
		if whole[topic] {
			// The recent events have no ids and come as a window that moves:
			// they stay a list.
			if topic != "recent" {
				v = rekey(v)
			}
			if list, isList := v.([]any); isList && lists[topic] {
				if k, ok := keyed(list); ok {
					v = k
				}
			}
			out[topic] = v
			continue
		}
		out[topic].(map[string]any)[field] = rekey(v)
	}
	return out
}
