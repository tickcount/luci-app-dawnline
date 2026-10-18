# Backend (ucode on the router)

Read with `code-standards.md`. Everything here runs on a small router (2 × Cortex-A53 on the reference Cudy WR3000P): cost is part of correctness.

## Layers

- `util`, `schema` (validation) → `core` (model, allocation) → `store` (the only writer of `/etc/config/dawnline`) → domain modules (`net`, `nft`, `fw`, `netifd`, `awg`, `loop`, `resolver`, `live`, `health`, `backup`, …) → `apply` (reconciliation) → entry points (`rpc/*`, `portal`, the `dawnline` CLI, the agent, the updater).
- Read models for the UI live in `view`; RPC modules translate arguments and call down, they hold no business logic.
- The updater is a thin dispatcher over `upd_app` / `upd_awg` / `upd_pkgs`, with GitHub in `github`, the package manager in `pkg`, policy/locks/history in `updates`.
- Live state: the agent's watcher owns who is online (`live.PRESENCE`); readers ask `live.online()`, never re-derive it from handshake ages. Online means the WireGuard session lives (`live.ONLINE_WINDOW`): traffic silence is no signal, a phone asleep is silent too.

## ucode

- `'use strict'` in entry points; modules `import { … } from 'fs'` / `'dawnline.x'`. Subdirectories map to dots (`dawnline.rpc.status` → `dawnline/rpc/status.uc`).
- Exported functions end with `};` (the compiler requires it). No destructuring. Regexes are POSIX (no `(?:)`, `\s\S` classes, lazy quantifiers); anchor them.
- Modules with `export` cannot be loaded with `require()`: imports are static and compiled on every start of the script.
- Doc comments (`/** … */`) on every export: what it returns, including the null/empty case.
- Shell out through one small helper per module (`run()`/`sh()`), with `2>&1` captured and the exit code checked.
- nft changes load as one script (`nft.load()`, a transaction); tables Dawnline owns are named `dawnline*` and rebuilt whole (`table X` + `delete table X` + the table).

## Cost on the router

- **The portal is CGI:** every request starts ucode and compiles the module graph, about 140 ms of CPU before any work (a full `state` answer about 180 ms). No periodic polling from the portal; one request per user action.
- **rpcd keeps the admin backend loaded:** LuCI RPC calls are cheap, so the admin UI may poll small methods often (`rev`), and the heavy ones (`status`) only on change or rarely.
- **Code on the agent's 1-second watcher stays in the low milliseconds:** one `awg show all dump` (about 4 ms with process start), the model cached by the config file's mtime/inode (`core.load()` is about 4 ms), files written only when something changed. Slow work (geo lookups, apply) runs only on a transition.
- Measure before and after on the router (a loop of 20–200 calls, `/proc/self/stat` CPU ticks, system busy from `/proc/stat`) when adding anything periodic.

## Checks

- `scripts/lint-ucode.py` and `scripts/ucode-container.sh` (compiles and runs `tests/ucode` in the OpenWrt rootfs containers; `scripts/check-ucode.sh` compiles on the router instead) pass before any deploy; new directories and entry points are added to `lint-ucode.py` and `scripts/compile-ucode.sh`, and executables to the mode check in `.github/workflows/ci.yml`.
- Pure functions get a case in `tests/ucode/<module>.test.uc`; what reads the clock takes an optional `ts` so a test can pass one.
