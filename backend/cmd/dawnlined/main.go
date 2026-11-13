// dawnlined is Dawnline's backend in Go: one long-running program that holds
// the live state and serves it to the pages. procd runs it (the `backend`
// instance of /etc/init.d/dawnline).
//
// It looks at the tunnels, keeps the router to the settings, answers the pages (the object `dawnline` on
// ubus, with the stream of live state) and serves the personal portal. The same binary is the `dawnline`
// command (dawnlined cli …) and the update worker (dawnlined updater …).
package main

import (
	"context"
	"flag"
	"fmt"
	"log/syslog"
	"os"
	"os/signal"
	"syscall"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/cli"
	"github.com/tickcount/luci-app-dawnline/backend/daemon"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

func main() {
	// `dawnlined updater …` is the background update worker (/usr/libexec/dawnline/updater hands its words over)
	if len(os.Args) > 1 && os.Args[1] == "updater" {
		zone.Load(zone.File)
		os.Exit(cli.Updater(os.Args[2:]))
	}
	// `dawnlined cli …` is the dawnline command (/usr/bin/dawnline hands its words over)
	if len(os.Args) > 1 && os.Args[1] == "cli" {
		zone.Load(zone.File)
		os.Exit(cli.System().Main(os.Args[2:]))
	}
	socket := flag.String("ubus", ubus.Socket, "ubusd's socket")
	run := flag.String("run", "/var/run/dawnline", "the directory of runtime state (tmpfs)")
	data := flag.String("data", "/etc/dawnline", "the directory of kept state (flash)")
	config := flag.String("config", "/etc/config/dawnline", "the settings file")
	stream := flag.String("stream", "poll", "how pages follow: sse (the web server can hold an event stream) or poll")
	// taken and ignored: the init script of a version before this one passes it
	flag.Bool("watch", true, "(always on)")
	portalPort := flag.Int("portal-port", 0, "serve the personal portal on this HTTPS port (0: its own web server does)")
	portalHTTP := flag.Int("portal-http", 0, "and plain HTTP on this port, for links with an IP address (0: none)")
	portalCert := flag.String("portal-cert", "", "the portal's certificate")
	portalKey := flag.String("portal-key", "", "and its key")
	portalProcs := flag.Int("portal-procs", 2, "(taken and ignored: the portal answers in this process)")
	version := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *version {
		fmt.Println(backend.Version)
		return
	}
	if *stream != "sse" && *stream != "poll" {
		fmt.Fprintln(os.Stderr, "dawnlined: -stream is sse or poll")
		os.Exit(2)
	}

	say := logger()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	say("dawnlined %s started · pages follow by %s", backend.Version, *stream)
	o := daemon.Options{Socket: *socket, RunDir: *run, DataDir: *data, Config: *config, Stream: *stream, Watch: true, Log: say}
	if *portalPort > 0 {
		o.Portal = &daemon.Portal{Port: *portalPort, HTTP: *portalHTTP, Cert: *portalCert, Key: *portalKey, Procs: *portalProcs}
	}
	daemon.Run(ctx, o)
	say("dawnlined stopped")
}

// logger writes to syslog as the ucode backend does (tag dawnline), or to
// stderr where there is none (a test stand).
func logger() func(format string, args ...any) {
	w, err := syslog.New(syslog.LOG_DAEMON|syslog.LOG_INFO, "dawnline")
	if err != nil {
		return func(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...) }
	}
	return func(format string, args ...any) { w.Info(fmt.Sprintf(format, args...)) }
}
