# Wonderarium on Windows: a plan

Wonderarium was built and tested on a Mac, but very little of it is Mac-shaped. Electron, three.js and the private `app://` file server are all indifferent to the operating system, and the save folder already follows the platform: the main process asks Electron for the per-user application data folder, which on Windows is `%APPDATA%\Wonderarium`, without naming a Mac path anywhere. So bringing the box to Windows is less a port than a handful of small corrections, followed by a choice about how far to carry it: running from source on a machine of your own, or handing an installer to people who never open a terminal.

The plan below takes those in order. The first stage is needed either way; the second only if the box is meant to travel.

## Stage 1: run from source on Windows

These are the places where the code, read closely, assumes a Mac. Each is small.

| What | Where | Why it matters | Fix |
| --- | --- | --- | --- |
| Starting Vite in the dev loop | `scripts/dev.mjs` | It launches `node_modules/.bin/vite` directly, but on Windows that file is a `vite.cmd` wrapper, which cannot be launched that way, so `npm run dev` fails at once. (`npm start` does not use this script and should be fine.) | Run Vite's JavaScript entry with `node` itself, which works on both systems. |
| Full screen | `electron/main.mjs`, `window:toggle-fullscreen` | On the Mac the app uses a separate full-screen mode that ignores the window's `fullscreenable: false` setting. On Windows the standard call may refuse because of that setting, and full-screen transparent windows are known to misbehave there anyway. | On Windows, cover the display by setting the window's bounds to it, and put them back afterwards. |
| The interface font | `src/styles.css` | The font list names only Apple fonts, so Windows falls through to the generic sans-serif, which is usually Arial. | Add `'Segoe UI Variable', 'Segoe UI'` before the generic fallback. |
| Line endings | new `.gitattributes` | Git for Windows converts line endings on checkout by default, which can make a fresh clone show spurious changes. | `* text=auto eol=lf`, with binary images marked as such. |
| Instructions | `README.md` | The run steps are written for macOS and Terminal. | A "Running it on Windows" section: Git for Windows, Node 24 from the official installer or `winget`, and the same four commands in PowerShell. |

Several behaviours are not bugs that can be seen in the code, but they depend on Windows itself and can only be judged on a real desktop:

- **Transparency.** The window is frameless and transparent. That works on Windows 10 and 11 with ordinary graphics drivers, but some machines (remote desktops, older or virtual GPUs) draw the transparent area black.
- **Moving and resizing.** The pill at the top is a drag region, and the corner is the app's own resize handle rather than a native border. Both should work; whether they feel right is a question for the hand on the mouse.
- **Pin on top.** `setAlwaysOnTop` with the `floating` level is a macOS notion; on Windows the level is ignored and the window is simply topmost. It should behave, but it needs checking against the taskbar and other topmost windows.
- **Keyboard.** ⌘Q has no meaning on Windows; Alt+F4 closes a focused frameless window, which is the expected gesture there. The README should say so.
- **The first launch.** `npm ci` fetches the Electron build that matches the machine (x64 or Arm64), about 100 MB, once.

**Done when:** on a Windows machine, `npm ci` and `npm start` open the box with its transparent background, both worlds run, the window can be dragged, resized, pinned, sent full screen and back, screenshots land in `%APPDATA%\Wonderarium\screenshots`, and `npm run dev` reloads on save.

## Stage 2: an installable app (optional)

If the aim is for anyone to try the desktop version, cloning and installing Node is too much to ask. The natural answer mirrors the GitHub Pages workflow that already publishes the web edition: a second workflow that builds the Windows app on GitHub's own Windows machines and attaches it to a release.

1. **Packaging.** Add electron-builder as a development dependency, with a small configuration: an NSIS installer (a one-click per-user install, no administrator rights) and a portable `.exe` that runs without installing. Electron Forge, the Electron project's own tool, would do as well; electron-builder is the simpler fit for a project this size.
2. **An icon.** The app needs one, as an `.ico` file holding several sizes; the same artwork can later become the Mac `.icns`.
3. **Packaged-mode details.** Inside a packaged app the code lives in a read-only archive. The `app://` server and the preload already resolve their paths from the code's own location, so they carry over. The `.env.local` lookup is harmless there, but should skip itself cleanly when the app is packaged, so an installed copy always saves to `%APPDATA%\Wonderarium`.
4. **The workflow.** On a pushed version tag (`v0.1.0`, say), a `windows-latest` job runs `npm ci`, the typecheck and the build, packages with electron-builder, and uploads the installer and the portable `.exe` to a GitHub Release with that tag. Building on Arm64 as well is one more line, if there is reason to.
5. **Signing, later.** An unsigned app meets Windows SmartScreen's "Windows protected your PC" screen until the user clicks *More info* and *Run anyway*. That is acceptable for friends and early visitors, and the README can say so plainly. Removing the screen needs a code-signing certificate; Microsoft's Artifact Signing service (formerly Azure Trusted Signing) costs about $10 a month. That money is worth spending only once there is an audience, which also gives SmartScreen time to learn the app's reputation.

**Done when:** pushing a tag produces a release with an installer and a portable `.exe`; either one, downloaded onto a clean Windows machine, opens the box after the SmartScreen step, saves between launches, and uninstalls cleanly from Settings → Apps.

## Testing without a Windows desk

A real Windows PC is the best test bed. The next best is a Windows 11 virtual machine on the Mac, such as Parallels on Apple silicon: it runs Windows on Arm, Electron ships an Arm64 build, and it is good enough to show whether things work, though not how smoothly they run on ordinary hardware. A `windows-latest` job in GitHub Actions can prove that the install, typecheck and build succeed on every push, but it cannot show the transparent window; it is a smoke test, not a judge of the look.

## Open questions

- Is the goal to run the box on a Windows machine of your own, or to hand an installer to other people? The first needs only Stage 1.
- Which Windows machine, real or virtual, will the testing happen on?
- Should the Mac get the same treatment (a signed, notarised `.dmg` from the same workflow) at the same time, or only once Windows is done?
