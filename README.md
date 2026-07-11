# Derba

_Explicit, checkbox-driven context for AI chat — you choose what the model sees._

## Why Derba

Most AI coding tools decide your context for you: semantic search, automatic file discovery, agents that guess what's relevant. Derba flips that around. You check the files you want in a tree view — the same tree you already use to browse your project — and that selection _is_ the context. Nothing is included that you didn't check. Nothing is guessed.

## Features

- **Checkbox-driven file tree** — select files and folders with checkboxes directly in a dedicated tree view. Parent/child state cascades automatically, but a manual pick you made is never silently overridden by that cascade.
- **Snapshots** — save the current checked-file set and restore it later, either by explicitly saving one or letting Derba capture it as you work. Browse saved snapshots through a quick pick.
- **Click-to-preview** — click any file in the tree to preview it without disturbing your checked selection.
- **Expand state that remembers what you actually did** — folder expand/collapse state is tracked from your real clicks, not a separate rule that can fight them.

### Coming soon

An integrated AI chat, `@derba`, powered by [LongCat-2.0](https://longcat.chat). Your checked files become the model's context automatically — no separate "attach file" step, no letting the model guess what's relevant. This is in active development and not yet included in this release.

## Requirements

VS Code `1.104.0` or later.

## Extension Settings

This extension contributes the following settings:

| Setting         | Default                                                                                 | Description                                             |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `derba.include` | `["**/*"]`                                                                              | Glob patterns for files to show in the file selector.   |
| `derba.exclude` | `["**/.git/", "**/node_modules/", "**/dist/", "**/build/", "**/.vscode/", "**/*.vsix"]` | Glob patterns for files to hide from the file selector. |
| `derba.locale`  | `""` (follows VS Code's UI language)                                                    | Locale for date/time display, e.g. `zh-CN`, `en-US`.    |

## Commands & Keybindings

| Command                  | Keybinding    | Description                                                                                                 |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Reveal Derba panel       | `Shift+Alt+V` | Open the Derba view in the activity bar.                                                                    |
| `Derba: Save Snapshot`   | `Shift+Alt+S` | Save the current checked-file set as a snapshot.                                                            |
| `Derba: Show Snapshots`  | `Shift+Alt+P` | Browse and restore saved snapshots.                                                                         |
| `Derba: Extract Context` | —             | Extract the checked files — file list and file content — and copy them to the clipboard as a context block. |

## Release Notes

### 0.0.1

Initial release: checkbox-driven file tree, snapshots, expand-state persistence, click-to-preview.

## License

[MIT](LICENSE)
