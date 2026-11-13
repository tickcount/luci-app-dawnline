package methods

import (
	"errors"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// What a person asks of the admin about a router, and the admin's answer.
//
// On their own page a person may add a router and name the networks behind it. Where the server's rule
// says "ask", neither takes effect: the router waits (`waiting`: no device of the tunnel, no
// configuration) and the networks are only asked for (`ask_net`), until the admin takes them or turns
// them down with a reason the person then reads (`declined`, and `declined_net` for networks). Taking a
// network away is the person's own to do, at once.

// asksNothing is the refusal for an answer to a device that asks for nothing.
var asksNothing = errors.New("This device asks for nothing.")

// applied puts a change of the settings into effect by what it moved: the routes (everything is applied),
// who is in a tunnel (the sync), or nothing on the router. The pages are told either way.
func applied(d Deps, lang string, routes, loads bool) (warning any) {
	switch {
	case routes:
		return rerouted(d, lang)
	case loads && d.Sync != nil:
		warning = d.Sync(lang)
	}
	if d.Told != nil {
		d.Told()
	}
	return warning
}

// netsGiven reads networks a page names again (ones the router has or was asked for), each as kept.
func netsGiven(given any) ([]string, error) {
	list, _ := given.([]any)
	out := []string{}
	for _, v := range list {
		s := trimmed(v)
		if s == "" {
			continue
		}
		n, why := model.BehindNet(s)
		if why != "" {
			return nil, said{"Network %s is not written like 192.168.2.0/24.", []any{s}}
		}
		out = append(out, n.String())
	}
	return out, nil
}

// deviceAnswer is the admin's answer to what a router's owner asked for on their own page:
//
//	accept  the router is a device of the tunnel from now on, and the networks asked for are its own
//	        (checked now against everything they must not share addresses with: refused in a sentence
//	        when they cannot be taken as they are)
//	decline neither; `reason` is one of model.Declined, which the owner reads
//	reopen  the question is put back (the undo of either answer): `router` the router waits again,
//	        `networks` are asked for again and not its own
//
// `networks` with accept or decline names the ones answered, of a router that does not wait (each asked
// network has its own two answers on the page); without it the answer is to all that is asked.
func deviceAnswer(d Deps, a map[string]any) (map[string]any, error) {
	id, answer := text(a["id"]), text(a["answer"])
	reason := text(a["reason"])
	known := false
	for _, r := range model.Declined {
		known = known || r == reason
	}
	if !known {
		reason = "plain"
	}
	again, err := netsGiven(a["networks"])
	if err != nil {
		return nil, err
	}
	var was model.Device
	var detail []string
	routes, loads := false, false
	err = write(d, func(c *uci.Config, m *model.Model) error {
		dev, err := admin.own(m, id)
		if err != nil {
			return err
		}
		was = *dev
		if dev.Kind != "router" {
			return asksNothing
		}
		// the router itself is asked for while it waits and is not turned down yet
		router := dev.Waiting && dev.Declined == ""
		// the networks this answer is about: all that is asked, or the ones named
		asked := dev.Ask
		if len(again) > 0 && !dev.Waiting && answer != "reopen" {
			asked = without(dev.Ask, without(dev.Ask, again))
			if len(asked) == 0 {
				return asksNothing
			}
		}
		left := without(dev.Ask, asked)
		switch answer {
		case "accept":
			// a router turned down asks for nothing until the question is put back, its networks neither
			if (!router && len(asked) == 0) || (dev.Waiting && !router) {
				return asksNothing
			}
			if len(asked) > 0 {
				all := []any{}
				for _, n := range append(append([]string{}, dev.Behind...), asked...) {
					all = append(all, n)
				}
				nets, err := behindNets(m, id, all, ownNets(d, m), admin, false)
				if err != nil {
					return err
				}
				setBehind(c, id, nets)
				detail = append(detail, "accepted="+strings.Join(asked, " "))
				routes = true
			}
			if router {
				c.Delete(id, "waiting")
				detail = append([]string{"accepted=router"}, detail...)
				loads = true
			}
			setList(c, id, "ask_net", left)
			if len(left) == 0 {
				c.Delete(id, "asked")
			}
			// what was turned down before is answered anew for the networks taken now
			if rest := without(dev.DeclinedNets, asked); len(rest) != len(dev.DeclinedNets) {
				setList(c, id, "declined_net", rest)
				if len(rest) == 0 && !dev.Waiting {
					c.Delete(id, "declined")
				}
			}
		case "decline":
			switch {
			case router:
				// it stays as it is, waiting, for its owner to read why and remove
				c.Set(id, "declined", reason)
				c.Delete(id, "declined_net")
				detail = append(detail, "declined=router", "reason="+reason)
			case len(asked) > 0 && !dev.Waiting:
				setList(c, id, "declined_net", append(without(dev.DeclinedNets, asked), asked...))
				c.Set(id, "declined", reason)
				setList(c, id, "ask_net", left)
				if len(left) == 0 {
					c.Delete(id, "asked")
				}
				detail = append(detail, "declined="+strings.Join(asked, " "), "reason="+reason)
			default:
				return asksNothing
			}
		case "reopen":
			back := a["router"] == true
			if !back && len(again) == 0 {
				return asksNothing
			}
			if back {
				if !dev.Waiting {
					c.Set(id, "waiting", "1")
					loads = true
				}
				detail = append(detail, "reopened=router")
			}
			if len(again) > 0 {
				if rest := without(dev.Behind, again); len(rest) != len(dev.Behind) {
					setBehind(c, id, rest)
					routes = !dev.Waiting
				}
				setList(c, id, "ask_net", append(without(dev.Ask, again), again...))
				detail = append(detail, "reopened="+strings.Join(again, " "))
			}
			rest := without(dev.DeclinedNets, again)
			setList(c, id, "declined_net", rest)
			if len(rest) == 0 {
				c.Delete(id, "declined")
			}
			c.Set(id, "asked", strconv.FormatInt(clock(), 10))
		default:
			return errors.New("Unknown answer.")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	warning := applied(d, text(a["lang"]), routes, loads)
	logged(d, journal.Event{"type": "device_changed", "person": was.Person, "device": id, "detail": strings.Join(detail, ", "), "by": admin.By})
	return map[string]any{"warning": warning}, nil
}

// DeviceWishAs is the networks a router's owner wants behind it, all of them at once, from their own page.
// One the router has and the list lacks goes at once: that is the owner's own to do. One it lacks is its
// own at once where the server's rule says so, else asked of the admin (a router that still waits asks for
// all of them). `cleared` names turned-down networks the owner has read and puts away; one asked for
// again is no longer turned down either.
func DeviceWishAs(d Deps, a map[string]any, who Actor) (map[string]any, error) {
	id := text(a["id"])
	cleared, err := netsGiven(a["cleared"])
	if err != nil {
		return nil, err
	}
	var was model.Device
	var detail []string
	routes := false
	err = write(d, func(c *uci.Config, m *model.Model) error {
		dev, err := who.own(m, id)
		if err != nil {
			return err
		}
		was = *dev
		if dev.Kind != "router" {
			return errors.New("Only a router has networks behind it.")
		}
		p := m.People[dev.Person]
		if p == nil || m.Servers[p.Server] == nil {
			return errors.New("The person has no server.")
		}
		asking := who.By != "admin" && (dev.Waiting || m.Servers[p.Server].PortalNets == "ask")
		wanted, err := behindNets(m, id, a["networks"], ownNets(d, m), who, asking)
		if err != nil {
			return err
		}
		// what it has and keeps, in the order it has them; what is new, in the order asked
		keep := without(dev.Behind, without(dev.Behind, wanted))
		added := without(wanted, dev.Behind)
		behind, ask := keep, added
		if !asking {
			behind, ask = append(keep, added...), nil
		}
		if !sameList(behind, dev.Behind) {
			setBehind(c, id, behind)
			detail = append(detail, "networks="+behindSaid(behind))
			routes = !dev.Waiting
		}
		if !sameList(ask, dev.Ask) {
			setList(c, id, "ask_net", ask)
			if fresh := without(ask, dev.Ask); len(fresh) > 0 {
				c.Set(id, "asked", strconv.FormatInt(clock(), 10))
				detail = append(detail, "asked="+strings.Join(fresh, " "))
			} else if len(ask) == 0 && !dev.Waiting {
				c.Delete(id, "asked")
			}
			if gone := without(dev.Ask, ask); len(gone) > 0 {
				detail = append(detail, "withdrew="+strings.Join(gone, " "))
			}
		}
		if rest := without(without(dev.DeclinedNets, cleared), wanted); len(rest) != len(dev.DeclinedNets) {
			setList(c, id, "declined_net", rest)
			if len(rest) == 0 && !dev.Waiting {
				c.Delete(id, "declined")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	warning := applied(d, text(a["lang"]), routes, false)
	if len(detail) > 0 {
		logged(d, journal.Event{"type": "device_changed", "person": was.Person, "device": id, "detail": strings.Join(detail, ", "), "by": who.By})
	}
	return map[string]any{"warning": warning}, nil
}
