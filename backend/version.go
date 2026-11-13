// Package backend is Dawnline's backend in Go. Its packages:
//
//	ubus    the wire protocol of ubusd: our object, calls, notifications
//	hub     the live state: topics, their changes as numbered events
//	api     the admin's door: the object `dawnline` over the hub
//	bridge  the topics told again when they may have moved without an event, and their shape on the stream
//	uci     /etc/config files read as libuci reads them
//	model   the settings as the backend works with them, read by the rules the settings' file has always had
//	awg     the one door to AmneziaWG: what the tunnels say of their peers
//	presence  who is online: connects, leaves and moves from one look at the tunnels to the next
//	link    how a device's link behaves: knocking, shared, dropped, unstable; the set-up sheet's state
//	meter   the live meter: a point a second from two looks at the tunnels
//	usage   the traffic accounting: by the day, the month, the person's limit month, the hour
//	journal the activity log's writer, on its file and under its lock
//	files   locks and whole-file writes
//	ipnet   IPv4 networks as the settings write them, with the settings' own rules
//	state   where a person stands: active, or why not (paused, past the end date, over the limit)
//	view    a person and their devices as the pages show them: the settings joined with the tunnels, the counters and what was handed out
//	netview the router's own networks: its interfaces, the WAN, the LAN, what a server's and a person's home reaches
//	handout what a device is given: its configuration and the fingerprint that says whether it must import again
//	zone    the router's time zone, read where OpenWrt keeps it: what a day and an hour are
//	watch   the watcher: every second, presence, link, meter, counters and the log, on disk and on the stream
//	portal  the personal portal's web server: the door, the answers behind it, a stream a page
//	roster  the stream's topics, made from what the watcher knows
//	daemon  the parts joined and kept running
//	cmd/dawnlined  the program
//
// Layers point one way: ubus, hub and uci know nothing of each other or of
// Dawnline; model reads uci, awg reads the tunnels; api and bridge join them, daemon runs them; only cmd knows the router's paths.
package backend

// Version is the backend's, the package's: the build sets it
// (-ldflags "-X …/backend.Version=0.18.0").
var Version = "dev"
