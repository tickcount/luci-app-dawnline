# Shell (install, uninstall, init, CI)

Read with `code-standards.md`. Anything run on the router by hand follows the workspace's `../rules/router-shell.md` (a literal stdin heredoc over SSH).

- POSIX `sh` (BusyBox ash), `set -eu` where the script allows; quote every expansion; `shellcheck -S warning` clean (CI runs it).
- Every mutating script has a `--dry-run` that prints what it would do; uninstall removes everything install created (cron, nft, firewall, routing, packages it added, files) and nothing else — including what older versions created (e.g. the priority-90 reply rules up to 0.4.0).
- BusyBox lacks GNU options (`ls -e`, `pkill`, `time` on shell functions): check on the router before relying on a flag.
