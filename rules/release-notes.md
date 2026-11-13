# Release notes: how the list of changes is collected

A release's `- ` points (`AGENTS.md` › Releases) and any list of «what changed» asked for along the way are collected the same way. The owner set it on 2026-11-12, after a list made from commit messages came out long, mixed trivia with what matters and missed whole features: «в будущем мне нужно чтобы ты так всегда логи собирал».

## The rule

- **From the code, against production.** Production is the last release: the tip of `origin/main`, the last tag `vX.Y.Z`. Go through the difference itself (`git diff vX.Y.Z..HEAD`), not only the commits' titles and bodies: the backend's methods that came and went (`backend/methods`), the settings (`backend/model`), the admin's pages, flows and widgets (`web/src/admin`), the portal (`web/src/portal`), the package's dependencies, the scripts. The commit messages are where to start, never the source: the list made from them alone missed bulk actions on people, the rollout of a new configuration, «Waiting for a decision», Undo and the simplified expiry.
- **Key changes only.** What somebody who runs Dawnline wants to know: what was rebuilt (the backend in Go), what is faster and by how much, what can be done now that could not, what is gone, what behaves differently. One short line each, the thing first.
- **Not the trivia.** The owner's own examples of what does not belong: «Show speeds in bytes per second (KB/s, MB/s), the measure the traffic beside them is counted in» («околобесполезная инфа») and «New README screenshots of the redesigned admin» («юзелесс»). A unit, a label, a picture, a move of code nobody sees: left out.
- **A rework is told whole.** What it was, what it is now, and what happens to what people had before the update. One line for the limits counted by a person's own month was not enough (the owner: «а как же реворк системы юседжа и времени старта отсчета»): it takes the rule (the month begins with their first traffic, the next only when they connect again), what follows from it (extra data, «Reset usage», the charts) and what an update does to the month that was running.
- **A number says where it is from.** Measured for this list, or taken from `docs/` or a commit's message (and on which router). Nothing is called checked that was only read in the code.
- **In English.** The points are English whatever language they were asked for in: what the owner writes in Russian is what he means, not how to write it («то что я пишу на русском это то что я имею ввиду а не как написать»). The talk around the list stays in his language.

## How

1. Find production: `git fetch`, then the default branch's tip and its tag.
2. Size the difference by area (`git diff --numstat`), then read each area for what came, went and changed: names that exist on one side only are the quickest lead (methods, options, files added and deleted), and each lead is checked in the code before it is written down, since a thing drawn again is not a thing added.
3. Read the commits' bodies for the reasons and the measurements.
4. Write the short list; expand the reworks; say what was left out on purpose only if asked.
