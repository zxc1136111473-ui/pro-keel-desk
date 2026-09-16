# pro-v4 → dsh-desktop fusion

This tree is `https://github.com/dataelement/dsh-desktop` with the product
plugins and CLI surface from `/Users/admin/pro-v4` folded in.

## Architecture split (do not collapse)

| Tree | Host | Runtime |
| --- | --- | --- |
| pro-v4 (`deepseek-harness-desktop`) | Tauri + vendored `harness/` | Cordis overlay generated in Rust |
| dataelement/dsh-desktop | Electron + npm `@deepseek-ai/dsh@0.1.5-rc.2` | `build/dsh-desktop.patch.yml` + `patch-package` |

Fusion keeps the Electron host. It does **not** port Tauri chrome, `desktop-bridge`,
or the vendored harness snapshot.

## What landed

| pro-v4 path | dsh-desktop path | Mount |
| --- | --- | --- |
| `desktop-plugins/dsh-manager` | `packages/dsh-desktop-manager` | web + CLI overlay |
| `plugins/dsh-layered-memory` | `packages/dsh-layered-memory` | web + CLI overlay |
| `plugins/dsh-quick-commands` | `packages/dsh-quick-commands` | web + CLI overlay |
| `plugins/dsh-retry` | `packages/dsh-retry` | web + CLI overlay |
| `plugins/dsh-open-external` | `packages/dsh-open-external` | web + CLI overlay |
| `plugins/dsh-infinite-gen-1` | `packages/dsh-infinite-gen-1` | web + CLI overlay |
| `harness/packages/bundle/tui` | `packages/dsh-tui` | TUI profile bundle |
| `harness/apps/cli` tui alias | `scripts/dsh.mjs` (`npm run dsh`) | CLI wrapper |

Not copied (already covered by upstream 0.1.5-rc.2 or Electron):

- `plugins/dsh-attachments` / `dsh-model-capabilities` — official packages
- `desktop-plugins/desktop-bridge` — Tauri iframe/theme adapter

## How plugins load

1. Root `package.json` `dependencies` use `file:packages/<name>`.
2. `patches/@deepseek-ai+dsh+0.1.5-rc.2.patch` injects those names into the
   `@deepseek-ai/dsh` closure so `$DSH_HOME/profiles/node_modules` can resolve them.
3. `build/dsh-desktop.patch.yml` inserts the rows for the Electron web profile.
4. `build/dsh-fused-cli.patch.yml` is the same host rows for `dsh tui` / headless.

Host HTTP (`quick-commands`, `retry`, manager `/api/desktop-manager`) waits for
`webServer` instead of listing it in required `inject`, so TUI/headless do not hang.

## CLI

After `npm ci` in this tree:

```bash
npm run dsh -- --help
npm run dsh -- tui
npm run dsh -- web --no-open
npm run dsh -- plugin --profile web ls
npm run dsh -- --profile headless "summarise this repo"
```

`scripts/dsh.mjs` creates `~/.dsh/profiles/tui` on first TUI boot. Official
`0.1.5-rc.2` has no `tui` command; the wrapper rewrites it to `--profile tui`.

## Build plugins

```bash
npm run plugin:build
```

Needs `esbuild` (added as a root devDependency). Then `npm ci` so the `file:`
packages and the `dsh` patch-package injection land in `node_modules`.

## Still different

- Desktop shell remains Electron, not Tauri.
- Harness is the pinned npm graph, not pro-v4's vendored `harness/` (newer TUI
  source + older 0.1.5-rc.2 peers — TUI boot may need a later harness bump).
- Infinite-gen-1 install/uninstall in the manager UI now looks under
  `packages/dsh-infinite-gen-1`, not Tauri's `plugins/`.
- `dsh-open-external` still prefers Tauri opener IPC, then `window.open` /
  `postMessage` (Electron path).
- Safe Mode overlay is unchanged: fused plugins stay off during recovery.

## Run the desktop app

```bash
cd dsh-desktop
npm install          # lockfile includes fused file: packages
npm run plugin:build
npm run dev
```

## Packaged install (macOS arm64)

Unsigned local package (no Apple identity on this machine):

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac:arm64
```

Artifacts:

- `dist/dsh-desktop-mac-arm64.dmg`
- `dist/dsh-desktop-mac-arm64.zip`
- `dist/mac-arm64/DSH Desktop.app`

Installed to `/Applications/DSH Desktop.app` (does not replace Tauri `DeepSeek Harness.app`). First launch may need System Settings → Privacy & Security → Open Anyway.
