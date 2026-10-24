# Changelog

All notable changes to Tilde are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/AlxFrst/tilde/releases/tag/v0.1.0
