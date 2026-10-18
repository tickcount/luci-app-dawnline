# AGENTS.md — Dawnline

Guidance for coding agents working in this repository (`tickcount/luci-app-dawnline`): an AmneziaWG access server for OpenWrt with a LuCI admin UI and a personal portal. `CLAUDE.md` points here.

## Rules

- `rules/code-standards.md` — how all code is written: decomposition, one locked writer, fail closed, validation at the boundary, comments and commits.
- `rules/backend.md` — ucode on the router: module layers, conventions, what things cost there (CGI portal, rpcd, the agent's watcher).
- `rules/frontend.md` — TypeScript admin UI and portal: layout of `web/src`, pollers and the live revision.
- `rules/shell.md` — install, uninstall, init and CI scripts.
- `rules/ui-design.md` — how the admin UI and the portal look: modern product quality, mock first from the real CSS and components, verified in the browser.

This repo usually sits inside the router-admin workspace (`../AGENTS.md`). Its rules apply to anything that touches the router: read-only first, backup before mutating, router shell as a literal stdin heredoc over SSH (`../rules/`).

## Layout

- `package/luci-app-dawnline/root/` — what lands on the router: ucode modules in `usr/share/ucode/dawnline/` (`rpc/` for the LuCI backend), the agent and updater in `usr/libexec/dawnline/`, the portal in `usr/share/dawnline/portal/`, the init script, rpcd ACL.
- `web/` — TypeScript sources of the admin UI (`src/admin`) and the portal (`src/portal`), shared code in `src/shared`; the built bundles are committed under `package/`.
- `install.sh`, `uninstall.sh` — the standalone installer and uninstaller (both have `--dry-run`).
- `scripts/` — `lint-ucode.py`, `compile-ucode.sh` (compiles every ucode file of a tree wherever ucode runs), `check-ucode.sh` (the same on the router, without installing), `ucode-container.sh` (compile and unit tests in the OpenWrt rootfs containers CI uses), `deploy.sh` (dev deploy over SSH), `build-packages.sh`, `build-release.sh`, `release-notes.sh`.
- `tests/ucode/` — unit tests of the ucode modules (`run.uc` runs every `*.test.uc`; fixtures for `/etc/config` and a stand-in `awg`), run in a container by `run.sh`.

## Checks before a commit or deploy

- `python3 scripts/lint-ucode.py` (use before definition, exports, POSIX regexes, rpcd methods; layering notes are informational).
- `scripts/ucode-container.sh` (needs docker): compiles every ucode file and runs `tests/ucode` on OpenWrt 24.10 and 25.12, exactly what CI does. `scripts/check-ucode.sh` compiles on the router instead when there is no docker. New ucode entry points are added to the compile list in `scripts/compile-ucode.sh`, to `lint-ucode.py`, and to the executables list in `.github/workflows/ci.yml`; a pure function gets a case in `tests/ucode/<module>.test.uc`.
- In `web/`: `npm run format:check`, `npm run typecheck` (sources and tests), `npm test`, `npm run build` — and commit the rebuilt bundles (CI fails on a changed or new file under `package/`).
- `shellcheck -S warning` for the shell scripts (CI finds them by shebang).
- A tag builds only after CI passes on it (`build.yml` calls `ci.yml`).

## Releases

- A release is one commit on `main` titled `Dawnline X.Y.Z`; its body is `- ` points, which become the GitHub release notes and the Components "What's new". Work from a branch is squashed into that one commit.
- Bump the version in `package/luci-app-dawnline/Makefile` (`PKG_VERSION`), `util.uc` (`VERSION`), `web/package.json` and `web/package-lock.json` (CI checks they agree).
- No `Co-Authored-By` or other agent attribution in commits.
- Push `main`, then an annotated tag `vX.Y.Z` ("Dawnline X.Y.Z"); the "Build packages" workflow publishes the `.ipk`, `.apk` and `sha256sums.txt`.
- Re-cutting a release (fixes before anyone installs) rewrites `main`: force-push, `gh release delete vX.Y.Z --cleanup-tag`, cancel a running build of the old tag, tag again. Only with the user's go-ahead.
- On the router, install a release the way Components does: `/usr/libexec/dawnline/updater install app@vX.Y.Z` (verified against the release's sha256).
