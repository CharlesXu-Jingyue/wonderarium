# World in a Box

A small glass cube sits on your desktop, and inside it a tiny world goes about its business. The first one is a hamster cage; the design notes in [DESIGN.md](DESIGN.md) explain the rest of the idea, and why the cube is only ever a boundary.

## How the project keeps to itself

The guiding rule is that this project should be able to vanish without a trace. Delete the folder (and the app-data folder, if you like) and nothing else on the machine remembers it was here, so every tool that would normally scatter files around your home directory has been asked, politely, to stay indoors.

Node is pinned by `.nvmrc`, and every dependency, Electron included, lives in the project's own `node_modules`, with exact versions recorded in the lockfile. npm would ordinarily keep its download cache in `~/.npm`, but `.npmrc` sends it to `.cache/npm` instead; Electron's installer, which caches in `~/Library/Caches` by default, follows the `electron_config_cache` variable to `.cache/electron`. Both caches are ignored by git, so they cost disk space but never clutter a commit.

The app's saved state, meaning the hamster, its furniture and your time settings, goes to the folder named by `BITS_DATA_DIR` in `.env.local`. That file is ignored by git because the path belongs to one machine; `.env.example` shows its shape for anyone setting up elsewhere.

Development with Claude Code runs inside the operating system's sandbox, configured in `.claude/settings.json`. Shell commands can write only inside this folder and the app-data folder, and can reach only the npm registry and GitHub. Network git commands are allowed to step outside the sandbox, but only through an explicit permission prompt. Machine-specific pieces of that configuration, the absolute paths, sit in the untracked `.claude/settings.local.json`.

## Getting started

```bash
nvm use
npm ci
```

If you install outside a Claude Code session, set the Electron cache first so it lands in the project too:

```bash
export electron_config_cache="$PWD/.cache/electron"
```
