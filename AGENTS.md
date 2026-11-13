# AGENTS.md — Dawnline

Guidance for coding agents working in this repository (`tickcount/luci-app-dawnline`): an AmneziaWG access server for OpenWrt with a LuCI admin UI and a personal portal. `CLAUDE.md` points here.

## Important

Always build code cleanly, modularly, and with proper architecture and separation of concerns. Never simply bolt on a feature because I asked for it. If you can’t find an easy way to build it naturally, and you'd recommend a refactor to make the whole thing cleanly, stop your work ahead of time and say so.

## Rules

- `rules/code-standards.md` — how all code is written: decomposition, one locked writer, fail closed, validation at the boundary, comments and commits.
- `rules/backend-go.md` — the backend (`backend/`, Go: the program `dawnlined`): packages, the stream's rules, what things cost on the router, checks. `docs/backend.md` — how it came to be, the stream's protocol, what each part is held to.
- `rules/frontend.md` — TypeScript admin UI and portal: layout of `web/src`, the admin's four LuCI modules and their size budget, pollers and the live revision.
- `rules/shell.md` — install, uninstall, init and CI scripts.
- `rules/ui-design.md` — how the admin UI and the portal look: one design system inside LuCI, modern product quality, mock first from the real code and CSS, verified in the browser.
- `DESIGN.md` — the design system of the personal portal and the admin: tokens, components, layout and motion, measured on the live page. Read it before any work on the portal (`web/src/portal`, and what it uses from `web/src/shared`) or the admin's pages (`web/src/admin`); a change to how they look or move updates it in the same change.
- `rules/i18n.md` — translations: every visible string and backend message wrapped, the catalogs, the Russian style guide and glossary. Anything added to the admin UI or the portal is localized in the same change; anything removed takes its catalog entries with it.
- `rules/release-notes.md` — how a release's points and any list of «what changed» are collected: from the code against production, key changes only, a rework told whole, in English.

This repo usually sits inside the router-admin workspace (`../AGENTS.md`). Its rules apply to anything that touches the router: read-only first, backup before mutating, router shell as a literal stdin heredoc over SSH (`../rules/`).

## Layout

- `package/luci-app-dawnline/root/` — what lands on the router beside the backend's binary: the init script, the shell around the backend in `usr/bin/dawnline` and `usr/libexec/dawnline/` (`updater`, `fetch-backend`, `postupdate`, `resolver`), the portal's assets in `usr/share/dawnline/portal/`, the version in `usr/share/dawnline/version`, the rpcd ACL and the LuCI menu. There is no ucode: the backend is Go.
- `backend/` — the backend (`dawnlined`), one static binary: the stream and the pages' methods (`ubus`, `hub`, `api`, `methods`), the watcher and the minute's work (`watch`, `chores`, `watchdog`, `geo`), putting the settings into effect (`apply`, `nft`, `store`, `uci`, `model`), the portal (`portal`), the updater and the command line (`updater`, `pkgmgr`, `cli`), `daemon` and `cmd/dawnlined`. A release publishes it for each architecture as `dawnlined-<version>-<goarch>`; `fetch-backend` puts the right one on a router (`docs/backend.md`).
- `web/` — TypeScript sources of the admin UI (`src/admin`: the LuCI modules `dawnline.app`, `dawnline.style`, `dawnline.map` and `dawnline.qr`) and the portal (`src/portal`), shared code in `src/shared`; `npm run build` writes the bundles under `package/` (git-ignored: CI builds them before packaging); `npm run build:demo` writes the two demos into `web/dist/` (the portal's, which is the public preview, and the admin's, which the README's pictures are taken from). `web/i18n/` — the string catalogs' tools (`extract.ts`, `po.ts`, `lmo.ts`).
- `package/luci-app-dawnline/po/` — the admin's catalog (`templates/dawnline.pot`, `ru/dawnline.po`): luci.mk builds the `luci-i18n-dawnline-ru` package from it. The portal's catalog is `web/src/portal/i18n/ru.po`, bundled into the portal.
- `install.sh`, `uninstall.sh` — the standalone installer and uninstaller (both have `--dry-run`).
- `scripts/` — `backend-container.sh` (the backend's checks, needs docker), `build-backend.sh` (the binary for one architecture), `deploy.sh` (dev deploy over SSH), `build-packages.sh`, `build-release.sh`, `release-notes.sh`, and the screenshot tools.

## Checks before a commit or deploy

- `scripts/backend-container.sh` (needs docker) after any change under `backend/` or to the rpcd ACL: gofmt, vet, unit tests, and the tests against a real ubusd, rpcd and uhttpd on OpenWrt 24.10 and 25.12. The goldens in `backend/*/testdata` are the removed ucode backend's own answers (0.18.0), fixed: a deliberate change of behaviour changes its golden by hand, in the same change, and says why.
- In `web/`: `npm run format:check`, `npm run typecheck` (sources and tests), `npm run lint` (oxlint), `npm run knip` (unused exports and dependencies), `npm run i18n:check` (after changing visible text: `npm run i18n`, translate the new entries in each `ru.po`), `npm test`, `npm run build` — and commit the catalogs (the bundles stay out of git; CI fails when the build leaves a file under `package/` that `.gitignore` does not cover).
- `shellcheck -S warning` for the shell scripts (CI finds them by shebang).
- A tag builds only after CI passes on it (`build.yml` calls `ci.yml`).

## Releases

- A release is one commit on `main` titled `Dawnline X.Y.Z`; its body is `- ` points, which become the GitHub release notes and "What's new" in Settings › Updates. Work from a branch is squashed into that one commit.
- The points are collected as `rules/release-notes.md` says: from the difference with the last release, not from the commit messages alone.
- Bump the version in `package/luci-app-dawnline/Makefile` (`PKG_VERSION`), `package/luci-app-dawnline/root/usr/share/dawnline/version`, `web/package.json` and `web/package-lock.json` (CI checks they agree).
- No `Co-Authored-By` or other agent attribution in commits.
- Push `main`, then an annotated tag `vX.Y.Z` ("Dawnline X.Y.Z"); the "Build packages" workflow publishes the `.ipk`, `.apk` (the app and `luci-i18n-dawnline-ru`) and `sha256sums.txt`.
- Re-cutting a release (fixes before anyone installs) rewrites `main`: force-push, `gh release delete vX.Y.Z --cleanup-tag`, cancel a running build of the old tag, tag again. Only with the user's go-ahead.
- On the router, install a release the way Settings → Updates does: `/usr/libexec/dawnline/updater install app@vX.Y.Z` (verified against the release's sha256).
