# Changelog

All notable changes to Tilde are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- The terminal no longer loses its left side. It was sized two columns wider than what shows
  (the padding around it was counted in), so the browser scrolled it sideways when the
  cursor reached those columns, and the shell wrapped lines at a width that did not show.

## [0.3.0]

### Added
- **Files as root.** The files pane has a user menu: switch the session's files to *root* (or
  another user) through `sudo`, and back. A folder you may not read offers *Open as root
  (sudo)*, and a refused operation *Switch to root (sudo)*. Tilde asks for your password when
  `sudo` needs it (and can remember it in the OS keyring); the editor, transfers and external
  edits of the session follow the chosen user. Classic sudo and sudo-rs (Ubuntu 25.10 and
  later) both work. A switch never tries more than three passwords, and if `sudo` refuses
  later (a password changed), the files go back to your own user instead of trying again.
- **Maximize a pane**: the button in a pane's header (or the editor's own when it is alone),
  `Ctrl+Shift+Enter`, or the palette. The pane fills the window and the Rail steps aside; the
  other panes keep running. `F11` puts the window in full screen.
- *Open another session* on a pinned server lists the new session **under that server**
  (*Session 2*, *Session 3*…), no longer among the day's other sessions.

### Changed
- The editor's *Save* button tells the file's state: highlighted when there are changes,
  *Saving…*, then *✓ Saved*. `Ctrl+S` on an unchanged file writes nothing.
- *Pin* on a session of *Today* adds it to the server's sessions instead of replacing the one
  already pinned.

## [0.2.1]

### Added
- **The interface in English.** Tilde follows the system's language (French on a French
  system, English everywhere else); *Settings → General → Language* picks one. Error messages,
  native file dialogs and Windows Explorer's entry follow it too.
- Pinned connections can be reordered by dragging them; dropping one on a row of another
  folder moves it there, at that place.

### Fixed
- macOS: ⌘C copies the terminal's selection and ⌘V pastes the clipboard. ⌘C used to copy
  nothing, so ⌘V pasted whatever was there before.

## [0.2.0]

### Added
- Files: *Nouveau fichier* creates an empty file in the current folder and opens it in the
  editor. An existing file is never overwritten.

### Fixed
- An empty space's *Nouvelle connexion…* and *Ouvrir la Bibliothèque* links were drawn in a
  background colour and could not be read. The brand accent is back on them, and on the other
  spots that had the same mistake: active pane and session header icons, the monitor icon, the
  editor's unsaved dot, the shortcut recorder and JSON preview keys.
- In the Rail, a session's status dot no longer shows under its close button: it gives way to
  the button on hover.
- macOS installs receive built-in updates: releases now carry the signed update archive
  (`.app.tar.gz`) that `latest.json` points to.

## [0.1.0]

The first public version.

### The Rail and spaces
- The Rail replaces the tab bar and the sidebar: favourite tiles, *Pinned* servers (asleep
  until opened, then live with their state and panes) and *Today*'s other sessions.
- Spaces (Arc-style), each with its colour, icon, servers and sessions; `Ctrl+Shift+1…9`.
- The Library: every connection of every space and the `~/.ssh/config` hosts.
- Session header (files, monitor, tunnels, new shell, split), pane headers (split, close),
  environment colour frame, monitor *Peek*, a Rail that hides.
- The palette finds sessions and spaces, lists a server's actions with `→`, and understands
  English words.

### SSH
- `~/.ssh/config` read as OpenSSH does: `Include`, `Host`/`Match` patterns, tokens, first
  value wins; problems are reported with file and line.
- Password, key (with passphrase), agent (OpenSSH for Windows, Pageant, `ssh-agent`) and
  keyboard-interactive authentication.
- Chained `ProxyJump` and `ProxyCommand`.
- OpenSSH `known_hosts` with hashed entries, ports and `@revoked`; a changed key is refused
  unless explicitly replaced.
- Keepalive, automatic reconnection, local and remote forwards that survive reconnections.
- Secrets in the OS keyring only.

### Connections
- Folders, tags, colours, icons and favourites; jump hosts picked from a list.
- `~/.ssh/config` hosts listed in the Library, and adopted in one click.
- Fuzzy search and a command palette.
- JSON import and export without secrets.

### Files
- SFTP pane on the session's connection; it follows the shell's directory (OSC 7).
- Transfers with progress, cancel and resume.
- Permissions, rename, delete (recursive, never through symlinks).
- External editing with upload on save and conflict detection.

### Terminal
- ConPTY/PTY shells, with Windows shells and WSL distributions detected; custom profiles.
- Sessions and splits restored at startup; `Ctrl+C` / `Ctrl+V` as in Windows Terminal.
- « Ouvrir dans Tilde » in Windows Explorer's context menu.
- WebGL rendering, ligatures, search, links, copy on select, safe paste.

### Panes
- Built-in editor (CodeMirror 6).
- Markdown, JSON and image preview.
- System monitor, local or remote over SSH (`/proc`).
- A documented panel registry for future plugins.

### Customisation
- 14 themes, a theme editor with live preview, and imports from iTerm2, Windows Terminal and
  base16.
- Rebindable shortcuts.
- Mica, Acrylic, vibrancy and opacity.
- Quake mode.
- A settings page covering every setting, plus JSON files with schemas and hot reload.

### Distribution
- Installers for Windows (MSI, NSIS), macOS (universal dmg) and Linux (AppImage, deb), with
  SHA-256 sums.
- Built-in updates, signed and checked at startup (can be turned off).

[0.2.1]: https://github.com/AlxFrst/tilde/releases/tag/v0.2.1
[0.2.0]: https://github.com/AlxFrst/tilde/releases/tag/v0.2.0
[0.1.0]: https://github.com/AlxFrst/tilde/releases/tag/v0.1.0
