// Package api is the admin's door to the live state: the ubus object
// `dawnline`, which LuCI reaches through uhttpd with rpcd's access lists in
// between (acl.d/luci-app-dawnline.json names every method here; a test holds
// the two together).
//
//	hello                       where the stream is and how to follow it
//	sync  {epoch, seq, topics}  a snapshot, or the events since seq
//	wait  {epoch, seq, topics, timeout}
//	                            the same, held until there is an event (long poll)
//	watch {topics}              "these topics are on screen", renewed while they are
//
// and the notifications `event` (one change, hub.Event with the epoch) and
// `ping` to whoever subscribed (uhttpd: GET /ubus/subscribe/dawnline, an event
// stream). The two ways to follow give the same events with the same numbers;
// a page uses the stream where the web server can hold one and the long poll
// where it cannot (hello's `stream`).
//
// Arguments are checked here, once; the hub is trusted with what passes.
package api

import (
	"context"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
)

// ObjectName is the backend's object on ubus. The ucode backend's is
// luci.dawnline; methods move from there to here as they are ported.
const ObjectName = "dawnline"

// The limits of what a caller may send.
const (
	maxTopics   = 32
	maxTopicLen = 64
	maxEpochLen = 32
	// A held call must end before uhttpd gives up on it (script_timeout, 60 s).
	maxWait     = 50 * time.Second
	defaultWait = 25 * time.Second
)

// Info is what hello tells besides the stream's position.
type Info struct {
	// Version is the backend's.
	Version string
	// Stream is how a page should follow: "sse" (GET /ubus/subscribe/dawnline)
	// or "poll" (the wait method).
	Stream string
	// Refresh has the topics read from the router now (the bridge's Look); nil when nothing needs it.
	Refresh func(ctx context.Context)
	// More is the questions the backend answers besides the stream's (package methods): hello names them,
	// so a page asks them here and not of the ucode backend.
	More []ubus.Method
}

// Object builds the ubus object over a hub. Who looks is noted in audience.
func Object(h *hub.Hub, audience *Audience, info Info) *ubus.Object {
	more := []string{}
	for _, m := range info.More {
		more = append(more, m.Name)
	}
	return &ubus.Object{
		Name: ObjectName,
		Methods: append([]ubus.Method{
			{Name: "hello", Handle: func(context.Context, map[string]any) (map[string]any, error) {
				at := h.Sync(h.Epoch(), 0, func(string) bool { return false })
				return map[string]any{
					"version": info.Version, "stream": info.Stream,
					"epoch": at.Epoch, "seq": at.Seq, "lease": int(Lease / time.Second),
					"now": time.Now().Unix(), "methods": more,
				}, nil
			}},
			{Name: "sync", Params: map[string]ubus.Kind{"epoch": ubus.String, "seq": ubus.Int, "topics": ubus.Array},
				Handle: func(_ context.Context, args map[string]any) (map[string]any, error) {
					q, err := parse(args)
					if err != nil {
						return nil, err
					}
					audience.Touch(q.topics)
					return answer(h.Sync(q.epoch, q.seq, q.want())), nil
				}},
			{Name: "wait", Waits: true,
				Params: map[string]ubus.Kind{"epoch": ubus.String, "seq": ubus.Int, "topics": ubus.Array, "timeout": ubus.Int},
				Handle: func(ctx context.Context, args map[string]any) (map[string]any, error) {
					q, err := parse(args)
					if err != nil {
						return nil, err
					}
					audience.Touch(q.topics)
					ctx, cancel := context.WithTimeout(ctx, q.timeout)
					defer cancel()
					a := h.Wait(ctx, q.epoch, q.seq, q.want())
					// Still looking after the wait: the next call renews it again.
					audience.Touch(q.topics)
					return answer(a), nil
				}},
			// After its own edit a page reads what it wrote: the topics are brought to what is on disk, and
			// the answer is where the stream stands then. The page catches up to it (sync).
			{Name: "refresh", Waits: true, Handle: func(ctx context.Context, _ map[string]any) (map[string]any, error) {
				audience.Touch(nil)
				if info.Refresh != nil {
					ctx, cancel := context.WithTimeout(ctx, defaultWait)
					defer cancel()
					info.Refresh(ctx)
				}
				at := h.Sync(h.Epoch(), 0, func(string) bool { return false })
				return map[string]any{"epoch": at.Epoch, "seq": at.Seq}, nil
			}},
			{Name: "watch", Params: map[string]ubus.Kind{"topics": ubus.Array},
				Handle: func(_ context.Context, args map[string]any) (map[string]any, error) {
					q, err := parse(args)
					if err != nil {
						return nil, err
					}
					audience.Touch(q.topics)
					return map[string]any{"lease": int(Lease / time.Second)}, nil
				}},
		}, info.More...),
		Watched: audience.Streaming,
	}
}

// query is a caller's arguments, checked.
type query struct {
	epoch   string
	seq     uint64
	topics  []string
	timeout time.Duration
}

// want is the topics the caller named; none named means all of them.
func (q query) want() func(string) bool {
	if len(q.topics) == 0 {
		return nil
	}
	set := make(map[string]bool, len(q.topics))
	for _, t := range q.topics {
		set[t] = true
	}
	return func(topic string) bool { return set[topic] }
}

func parse(args map[string]any) (query, error) {
	q := query{timeout: defaultWait}
	if v, ok := args["epoch"]; ok {
		s, isString := v.(string)
		if !isString || len(s) > maxEpochLen {
			return q, ubus.StatusInvalidArgument
		}
		q.epoch = s
	}
	if v, ok := args["seq"]; ok {
		n, isInt := v.(int64)
		if !isInt || n < 0 {
			return q, ubus.StatusInvalidArgument
		}
		q.seq = uint64(n)
	}
	if v, ok := args["timeout"]; ok {
		n, isInt := v.(int64)
		if !isInt || n < 1 {
			return q, ubus.StatusInvalidArgument
		}
		q.timeout = min(time.Duration(n)*time.Second, maxWait)
	}
	if v, ok := args["topics"]; ok {
		list, isList := v.([]any)
		if !isList || len(list) > maxTopics {
			return q, ubus.StatusInvalidArgument
		}
		for _, e := range list {
			s, isString := e.(string)
			if !isString || s == "" || len(s) > maxTopicLen {
				return q, ubus.StatusInvalidArgument
			}
			q.topics = append(q.topics, s)
		}
	}
	return q, nil
}

// answer is a hub.Answer as a ubus table.
func answer(a hub.Answer) map[string]any {
	out := map[string]any{"epoch": a.Epoch, "seq": a.Seq}
	if a.Docs != nil {
		out["docs"] = a.Docs
	}
	if a.Events != nil {
		events := make([]any, len(a.Events))
		for i, e := range a.Events {
			events[i] = eventTable(e)
		}
		out["events"] = events
	}
	return out
}

func eventTable(e hub.Event) map[string]any {
	t := map[string]any{"seq": e.Seq, "topic": e.Topic, "op": e.Op}
	if e.Data != nil {
		t["data"] = e.Data
	}
	return t
}
