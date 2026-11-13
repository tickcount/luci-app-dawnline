// The stream side of the object: every event of the hub goes to the object's
// subscribers as a notification, in order, and a `ping` when nothing happened
// for a while (a page tells a dead connection from a quiet one by it; the
// ping carries the number the stream is at, so a page that missed the last
// event before a silence learns it).
package api

import (
	"context"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
)

// PingEvery is the longest a stream stays silent.
const PingEvery = 15 * time.Second

// Notifier is the bus as the broadcast needs it.
type Notifier interface {
	Notify(o *ubus.Object, kind string, data map[string]any) error
}

// Broadcast forwards the hub's events to the object's subscribers until ctx
// ends. A notification the bus did not take (ubusd away, an event over its
// size limit) is not retried: the next ping or event shows a page the gap,
// and it asks for what it missed with sync.
func Broadcast(ctx context.Context, h *hub.Hub, bus Notifier, o *ubus.Object) {
	ping := time.NewTicker(PingEvery)
	defer ping.Stop()
	for ctx.Err() == nil {
		sub := h.Follow()
		follow(ctx, h, sub, bus, o, ping)
		sub.Close()
	}
}

// follow forwards one subscription's events; it returns when the hub let the
// subscription go (this side fell behind) or ctx ended.
func follow(ctx context.Context, h *hub.Hub, sub *hub.Sub, bus Notifier, o *ubus.Object, ping *time.Ticker) {
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-sub.Events():
			if !ok {
				return
			}
			t := eventTable(e)
			t["epoch"] = h.Epoch()
			bus.Notify(o, "event", t)
			ping.Reset(PingEvery)
		case <-ping.C:
			at := h.Sync(h.Epoch(), 0, func(string) bool { return false })
			bus.Notify(o, "ping", map[string]any{"epoch": at.Epoch, "seq": at.Seq, "now": time.Now().Unix()})
		}
	}
}
