# Backend (Go: `backend/`)

Read with `code-standards.md` (it applies whole: one job per package, layers one way, validate at the boundary, one writer, fail closed) and `docs/backend.md` (where the backend is going and the stream's protocol).

## Packages

- One package, one job, named after it, with a package comment that says what it owns, what it does not and what callers rely on. `backend/version.go` lists them and the layers.
- **Layers:** `ubus` and `hub` know nothing of Dawnline or of each other; `api`, `bridge` (and later the producers) join them; `daemon` runs them; only `cmd/dawnlined` knows the router's paths.
- **One door per outside system.** Only `ubus` speaks ubus; when they come, only one package runs `awg`, one talks nftables, one writes UCI. A new version of the thing behind a door is one package to change.
- **Seams are interfaces declared by the user** (`bridge.Caller`, `api.Notifier`), so a test hands in a stand-in. No package-level state.
- **No dependency without a reason written in the change that adds it.** The standard library covers the stream; nftables and netlink will need libraries.
- **Not copied from podkop-exp** (GPL; Dawnline is MIT): its patterns, never its code.

## The stream

- A producer **puts whole documents** (`hub.Put`) and never builds a patch; it may put as often as it likes.
- Documents hold **no `null`** and publish lists of things with ids as **keyed lists** (`{ order, items }`).
- What costs something to produce runs **only under a lease** (`Audience.Wants`).
- A new topic or method is added to `docs/backend.md`, and a method to the rpcd ACL (`acl.d/luci-app-dawnline.json`) in the same change.
- Text people read is not put into topics: the page translates (`i18n.md`). A topic carries codes and values.

## Failures

- **A refusal is a sentence for a person, capital first**, in English through the catalog (`access.Said`, `said`, `github.Failure`, `w.die`), listed in `i18n/messages.js`. An error Go or a library wrote for programmers (lower-case first, by Go's convention: «open /etc/config/dawnline: no such file») is never sent to a page: `methods.wordsOf` sends the plain sentence (`methods.Unworded`) and puts the error itself in the system log. The page holds the same line (`web/src/admin/failure.ts`).

## Cost on the router

- Nothing periodic without a measurement on the router. What was measured there: `nft` reads the router's whole ruleset to change a set in place (0.9 s beside a proxy's lists) and nothing to replace our own table (0.06 s), so a sync replaces the table; `auto-merge` on an interval set costs the same 0.9 s, so networks are collapsed before they are written.
- A goroutine per job, not per event; channels that can fill say what happens when they do (the hub lets a slow follower go).

## Checks

- **The goldens are the ucode backend's own answers.** `backend/*/testdata/*.json` were made by the ucode backend (0.18.0) from the fixtures beside them, before it was removed; nothing regenerates them. A test that compares with one holds Go to what that backend did. Changing behaviour on purpose means editing the golden by hand in the same change, and saying why in it.
- `scripts/backend-container.sh` (needs docker): gofmt, `go vet` (all build tags), the unit tests, then the tests against a real `ubusd`, `rpcd` and `uhttpd` in the OpenWrt 24.10 and 25.12 rootfs images.
- A pure function gets a table test beside it; what speaks to the router gets a case in a tagged test (`ubusd`, `e2e`) that the script runs.
- **Local time is the router's, asked of `zone.Local()`**, never `time.Local`: OpenWrt keeps the zone in `/etc/TZ`, where Go does not look, so a Go program there is in UTC unless told (`backend/zone`). A golden made with `TZ=UTC` cannot see a mistake here: test what counts days or hours in a zone east of Greenwich.
- **There is no second backend to fall back to.** What changes how the router is kept is tried first where it changes nothing (`ubus call dawnline apply_plan` and `sync_plan` say what an apply or a sync would do), and on the real router only on objects made for the try. A person's link code is never logged, printed or put in an error.
