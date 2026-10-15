# Dawnline

[![CI](https://github.com/tickcount/luci-app-dawnline/actions/workflows/ci.yml/badge.svg)](https://github.com/tickcount/luci-app-dawnline/actions/workflows/ci.yml)
[![Build packages](https://github.com/tickcount/luci-app-dawnline/actions/workflows/build.yml/badge.svg)](https://github.com/tickcount/luci-app-dawnline/actions/workflows/build.yml)

Your OpenWrt router as a private VPN for the people you choose.

Dawnline runs an [AmneziaWG](https://docs.amnezia.org/) server on the router
and gives every person a personal link. They open it, add their own devices
(up to the limit you set) and connect with AmneziaVPN or AmneziaWG. You decide
what each person may reach: the home network, the internet, or both.

Dawnline is the successor of [Liminal](https://github.com/tickcount/openwrt-liminal):
the same idea rebuilt around people instead of peers, with a personal portal,
limits, live traffic and a LuCI admin that follows a modern design.

![Overview](docs/screenshots/overview.png)

| People | A person |
|---|---|
| ![People](docs/screenshots/people.png) | ![Person](docs/screenshots/person.png) |

| Personal portal | Where people connect from |
|---|---|
| ![Personal portal](docs/screenshots/portal.png) | ![Map](docs/screenshots/map.png) |

## Features

- **People, not peers.** One card per person with device chips, live status,
  traffic, end date and data limit. Add a person, send them the link or the
  invite card (QR code), and they do the rest.
- **Personal portal.** Every person gets a link made of three words
  (`https://vpn.example.com/kamiro-telosu-bavine`). The link is the key: no
  accounts, no sessions, and a new link locks the old one out at once. People
  add, rename and remove their devices and get each one as a QR code,
  "Open in AmneziaVPN" (`vpn://`), a key or a `.conf` file. They cannot change
  access or limits. Links work on 443 with a Let's Encrypt certificate (via
  ACME), several addresses at once (a Cloudflare-proxied name, a plain IP), the
  same link at home, and wrong links can redirect to your website.
- **Access per person**, enforced in an `inet dawnline` nftables table on the
  tunnel interface: home network only, internet only, or both, and optionally
  only some home services.
- **Limits.** End dates (pause, keep, or remove devices when they pass), monthly
  or total data limits, allowed hours, pause one person or everyone. Devices
  drop off the tunnel at once (`awg syncconf`, no interface restart).
- **Disguise presets** for AmneziaWG obfuscation (junk packets,
  header and padding parameters), with what each preset needs from the apps.
- **Internet like a home device.** Tunnel clients' internet traffic enters the
  router from the LAN, through a small network namespace on the LAN bridge
  (needs `kmod-veth`). Whatever handles LAN traffic on the router (proxies, DPI
  bypass, DNS filters, the `lan` zone) handles VPN clients too, with no
  per-tool integration.
- **Overview.** Who is online with what, speed now, today and the last 30 days,
  and a map of where people connect from (city level).
- **Diagnostics.** Health checks with one-click fixes, including the ones that
  matter for reaching the portal from outside (DNS, port forwards, reply
  routing behind proxies such as SSClash/Mihomo, certificate coverage). A
  watchdog checks the tunnels, access rules, portal, resolver and LuCI link
  every minute and repairs them on its own (a cron job looks after the agent
  itself). One log holds people's activity and the service log: tunnel starts
  and stops with netifd's reasons, repairs and errors (`dawnline log` on the
  router).
- **Updates.** Dawnline itself, AmneziaWG builds for your firmware (choose
  between [Slava-Shchipunov](https://github.com/Slava-Shchipunov/awg-openwrt)
  and [2Grey](https://github.com/2Grey/awg-openwrt), AmneziaWG 2.0 or 3.1), and
  the few OpenWrt packages Dawnline adds.
- **Backups** nightly and before risky operations, JSON export/import to move
  to another router.

## Requirements

- OpenWrt **24.10** (opkg, `.ipk`) or **25.12** (apk, `.apk`)
- AmneziaWG (`kmod-amneziawg`, `amneziawg-tools`, `luci-proto-amneziawg`):
  the installer adds a build made for your firmware when it is missing
- About 2 MB of free flash

## Install

On the router:

```sh
sh -c "$(wget -qO- https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/install.sh)"
```

The installer checks the firmware, installs AmneziaWG for it if needed, then
downloads the Dawnline package for your package manager from the latest
release, checks it against `sha256sums.txt` and installs it with its
dependencies. Then open **LuCI → Network → Dawnline** and run the setup wizard.

Options:

```sh
sh install.sh 0.1.0                       # a given release
DAWNLINE_AWG=grey sh install.sh           # AmneziaWG from 2Grey (default: Slava-Shchipunov, then 2Grey)
DAWNLINE_AWG=skip sh install.sh           # never install AmneziaWG
```

By hand, from a [release](https://github.com/tickcount/luci-app-dawnline/releases):

```sh
opkg update && opkg install ./luci-app-dawnline-0.1.0.ipk                 # OpenWrt 24.10
apk update && apk add --allow-untrusted ./luci-app-dawnline-0.1.0.apk     # OpenWrt 25.12
```

**Upgrade** from **Dawnline → Updates**, or run the installer again. Settings,
keys and history are kept, and a backup is made first.

**Remove**: **Settings → Remove Dawnline from this router** (keeps a backup),
then `opkg remove luci-app-dawnline` or `apk del luci-app-dawnline`.

## What Dawnline changes on the router

Only objects it created: network interfaces tagged `_dawnline`, firewall
sections named `dawnline_*`, the `inet dawnline` nft table, `/tmp/hosts/dawnline`,
the `dawnline` network namespace with its two veth links (`dlx0`, `dll0`, the
latter a port of the LAN bridge), policy rules for the tunnel interfaces with
one routing table, a second dnsmasq instance on port 5354
(`/var/etc/dawnline-dns.conf`), a cron line for the agent's heartbeat check
and, while the portal is on, a uhttpd instance for it. `dawnline teardown`
removes all of them.

Data lives in `/etc/config/dawnline` (mode 0600, contains private keys) and
`/etc/dawnline/` (usage, events, issued configurations, backups). Live counters
are kept in `/var/run/dawnline` and flushed to flash at most hourly.

## Development

```
package/luci-app-dawnline/
  root/usr/share/ucode/dawnline/   ucode library (model, apply, live, ops, view, loop)
  root/usr/share/rpcd/ucode/       luci.dawnline RPC object
  root/usr/libexec/dawnline/       agent (usage, limits, presence) and updater
  root/usr/share/dawnline/portal/  portal CGI and its (minified) assets
  root/usr/bin/dawnline            command line (`dawnline help`)
  htdocs/                          LuCI views and the generated module dawnline/app.js
web/                               TypeScript sources of the admin UI and the portal
build/Dockerfile                   package build with the OpenWrt SDK
scripts/                           build, deploy and check scripts
```

```sh
cd web
npm ci
npm run format        # Prettier
npm run ci            # format check, types, tests, minified bundles

scripts/lint-ucode.py                 # static ucode checks
scripts/check-ucode.sh root@router    # compile every ucode file on a router
scripts/deploy.sh root@router         # install the working tree (backs up configs first)
scripts/build-packages.sh all         # .ipk and .apk with the OpenWrt SDK in Docker
scripts/frame-screenshots.py          # frame docs/screenshots/raw/*.png for this README
```

The web bundles are committed: CI fails when they are out of date. Pushing a
tag `vX.Y.Z` (matching `PKG_VERSION`) builds both packages with the OpenWrt SDK
and publishes a release with `sha256sums.txt`.

## License

[MIT](LICENSE)
