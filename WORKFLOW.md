# Working on this project

You have a git repository in this folder and a private copy on GitHub. Here is
how to use them without losing work.

## The loop

```
node tools/verify.mjs     # before every commit: rebuilds index.html, checks behaviour (~3 s)
git status
git add -A
git commit -m "what changed and why"
git push
```

`git push` needs no arguments: `main` already tracks `origin/main`.

Before anything large, `node tools/verify.mjs --full` also runs the two
original-parity harnesses (~1.5 min).

## Rolling back

Three tiers, depending on how far the change got.

**Not committed yet.** `git status` to see what moved, then throw it away:

```
git restore src/core/FlipFluid.js     # one file
git restore .                         # everything uncommitted
```

**Committed.** Look before you leap:

```
git log --oneline                     # find the commit
git show <sha> --stat                 # what did it touch
git diff <sha> -- src/                # what changed since
```

Then pick one:

```
git revert <sha>                      # makes a NEW commit that undoes it
git reset --hard <sha>                # rewinds history; drops everything after it
```

`revert` is the right choice almost always, because it keeps history honest and
works on commits that are already on GitHub. `reset --hard` rewrites history, so
if you have already pushed, you need `git push --force-with-lease` afterwards and
any other copy of the repo disagrees with you. Use it only for commits that have
never left this machine.

**Something went badly wrong** (a reset removed work you wanted):

```
git reflog                            # every position HEAD has been at
git reset --hard <sha>                # or: git switch -c rescue <sha>
```

Reflog is the net under the trapeze. Commits are not gone until they are
garbage-collected, which takes weeks.

## Branches, for anything non-trivial

Rolling back is easier if the work was never on `main`:

```
git switch -c slider-ui               # new branch
# ... work, commit ...
git switch main
git merge slider-ui                   # keep it
git branch -D slider-ui               # or throw the whole thing away
```

## Tags, for known-good points

`v1.0-refactor` marks the refactor, verified byte-identical to the original demo.
To mark another point you are happy to come back to:

```
git tag -a v1.1 -m "..."              # create
git push --tags                       # publish
```

## Versions

The version is one number in one place: `src/version.js`. It is displayed in the
corner of the running simulation and stamped into the generated `index.html`, so
the page tells you what you are looking at.

To cut a version:

```
node tools/release.mjs 1.1.0 --dry-run      # see the plan, change nothing
node tools/release.mjs 1.1.0                # check, confirm, then do it
```

That is the whole flow. It refuses to run unless the working tree is clean, the
branch is `main`, the branch is not behind `origin/main`, and `CHANGELOG.md`
already has a `## v1.1.0` section - those lines become the release notes, which
is why the entry has to be written first.

The steps it performs, if you would rather do them by hand:

```
# 1. bump VERSION in src/version.js
# 2. add the entry to CHANGELOG.md, and update the version document in docs/
node tools/verify.mjs --update         # only if behaviour changed on purpose
node tools/verify.mjs --full           # the checks that gate a release
git add -A
git commit -m "v1.1.0: what changed"
git tag -a v1.1.0 -m "what this version is"
git push && git push --tags

# 3. publish it, with the runnable single file attached under a versioned name
Copy-Item index.html "$env:TEMP\flip-fluid-v1.1.0.html"
gh release create v1.1.0 --title "v1.1.0 - what it is" --notes "what changed" `
    "$env:TEMP\flip-fluid-v1.1.0.html"
Remove-Item "$env:TEMP\flip-fluid-v1.1.0.html"
```

The asset takes its name from the file, so copy it to a versioned name first:
`file#label` renaming does not take effect reliably from PowerShell. For longer
notes, `--notes-file` works, or build the text with a here-string.

Each version gets an entry in `CHANGELOG.md`, and the document that describes it
goes in `docs/` as `vX.Y.Z-short-name.md` - the specification while the work is
planned, the record of what was built once it is done. `docs/v1.1.0-settings-debug-panel.md`
is the first one.

### Why publish a release and not just a tag

A tag is enough for `git`, but a release is what a person can actually use:

```text
https://github.com/simonroamingx-coder/flip-fluid/releases
```

Each release page shows its notes and offers the generated `index.html` as a
download, renamed to carry the version, so any old version can be fetched and
opened by double-click without cloning anything. GitHub also attaches the source
zip to every release automatically. The tags themselves remain browsable at
`/tags`, and `/compare/v1.0.0...v1.1.0` shows what changed between two versions.

`gh` is installed and authenticated on this machine, so the release step is one
command. Do not move or re-tag a version that has already been published.

The tag name must match `src/version.js`: `node tools/verify.mjs` fails if HEAD
carries a version tag that disagrees with the code, so the badge cannot lie about
which version you are running.

Current tags: `v1.0-refactor` is the refactor commit from before versioning
existed; `v1.0.0` is the first versioned release.

### Going back to a version

```
git log v1.0.0..HEAD --oneline         # what has happened since
git diff v1.0.0 -- src/                # what changed, in full
git restore --source=v1.0.0 src/core/FlipFluid.js   # one file back, staged to review
git switch -c rescue v1.0.0            # work from that version in a branch
```

`git restore --source=` is the one to remember: it puts a single file back the way
it was at that version, without touching anything else, and you can inspect the
result before committing it.

## Naming versions

Numbers only, so they sort and compare: `v1.1.0` for a feature, `v1.0.1` for a
fix, `v2.0.0` for something that changes what the simulation does. Keep tag text
short, and put the detail in the commit message where it belongs.

## What the two tests mean

They answer different questions, and confusing them will waste your time.

**`test/baseline.mjs`** compares the simulation against `test/baseline.json`,
recorded behaviour that you own. This is the day-to-day regression net: it fails
when behaviour moves and you did not say so. That is what you want while adding
features.

**`test/parity.mjs`** and **`test/parity-browser.mjs`** compare against the
original single-file demo in `ref/`. They are the proof that the refactor changed
nothing, so they can only pass while behaviour is unchanged — the moment you
deliberately change the physics, they will fail, and that is not breakage. Run
them with `--full` when you want that reassurance, or when you are preparing to
say "this still behaves as originally specified".

When you change behaviour on purpose:

```
node test/baseline.mjs --update       # or: node tools/verify.mjs --update
git diff test/baseline.json           # ← read this. It is the change, in one place.
git add test/baseline.json
```

Reading that diff is the habit worth having: it turns "I think I only touched
the slider" into evidence.

## The generated file rule

`index.html` is generated from `dev.html` and `src/`, and it is committed so that
double-clicking it works straight from a clone. Never edit it by hand — you would
be editing a file the next build overwrites.

`node tools/verify.mjs` rebuilds it for you and tells you if it had gone stale,
which is the failure mode you will otherwise hit: edit `src/`, forget to bundle,
and the file everyone actually opens quietly disagrees with the source.

## Commits and your name

The commits so far are authored as `Codex <codex@localhost>`. To make future ones
yours, in this repo:

```
git config user.name "Your Name"
git config user.email "you@example.com"
```

## One machine-specific note

This folder is owned by the account Codex's sandbox runs as, so git refuses to
work in it as "dubious ownership" until the path is trusted. That exception is
already set here. A fresh clone anywhere else does not need it.
