# Code standards

How code in our own projects (Dawnline first, the same spirit for Tachyon, liminal and the rest) is written. This file holds what applies everywhere; per area:

- `backend.md` — ucode on the router: layers, conventions, what things cost there.
- `frontend.md` — TypeScript admin UI and portal: layout, live data.
- `shell.md` — install, uninstall, init and CI scripts.
- `ui-design.md` — how anything visible looks and how it gets approved.

Match the code around you: its naming, comment density and idiom win over personal taste.

## Decomposition

- **One module, one job, named after it.** A file you cannot describe in one sentence is two files. Starting points: ~300–400 lines for a ucode/TS module, ~60 lines for a function. Past that, split by responsibility, not by line count.
- **Every module opens with a header comment**: what it owns, what it deliberately does not (and where that lives), and any invariant callers rely on (locks, files it writes, who may call it).
- **Layers point one way.** Pure helpers and the data model know nothing about the router or the UI; orchestration calls them, never the reverse. Dawnline's layers are in `backend.md`.
- **No god files, no grab-bag `ops`/`misc`/`kit` modules.** When a helper is used by one module, it stays private in that module.
- **Delete, don't deprecate.** When something is replaced, move every caller and remove the old code in the same change; no shims, no commented-out blocks. The same goes for its strings: new text is translated in the same change, removed text leaves the catalogs (`i18n.md`).

## Logic and state

- **Validate at the boundary, trust inside.** RPC, portal, CLI and file input are checked once (types, ranges, ids, regexes anchored with `^…$`, length caps); inner code assumes valid data. Never build a shell command from unchecked input — quote with `q()` and prefer argument whitelists.
- **One writer per resource, under a lock.** Config changes go through `store.transact()` (load the model inside the lock, change, commit, chmod 600). Router state changes go through `apply` under the `apply` lock. Long jobs (updates) hold a `flock`; "is it running" comes from the lock, never from a pid file. Do not nest locks.
- **Reconcile, don't patch.** Derive router state from config and converge (idempotent: running twice changes nothing). Touch only objects you own (tagged/named `dawnline`), never foreign interfaces, zones or rules.
- **Fail closed.** If a filter or nft load fails, access stays blocked, not open. A missing dependency (no AmneziaWG, no curl, no openssl) is a reported state with a fix, never a crash: check capabilities (`awg.state()`, `health.needs()`) and gate the feature in the backend *and* the UI.
- **Atomic files.** Write JSON/state to a temp file and rename; keep runtime counters in tmpfs (`RUN_DIR`) and flush to flash (`DATA_DIR`) rarely.
- **Trust and downloads.** APIs only directly over TLS; files may come from mirrors only when their sha256 is known from the API, and every attempt is verified. No hash → direct only, or refuse.
- **Side effects at the end.** Collect restarts (network, uhttpd, re-apply) and run them once after the job, so a failure halfway never leaves half-restarted services.
- **Errors say what to do.** `die()` / thrown messages are shown to the admin: a full sentence with the cause and, where possible, the fix. Never swallow an error silently; a `catch` either handles it or logs why it is ignored.
- **Time and dates come from the router** (`localtime`, `util.today()`), not from the browser.

## Comments, names, commits

- Comments explain why and the contract, not what the next line does. English in code and UI copy.
- Names say what the thing is in the product's words (people, devices, servers, circles), not implementation words.
- Commits are reviewable pieces (one area or concern each), message says what changed and why; no push without the user's go-ahead.
