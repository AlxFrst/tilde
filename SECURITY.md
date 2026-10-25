# Security policy

Tilde handles SSH access, keys and passwords: security issues are handled first.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting: the *Security* tab →
*Report a vulnerability* (GitHub Security Advisories).

Include the Tilde version, your OS, the steps to reproduce and the impact you expect. We
acknowledge reports within 7 days.

## Scope

In particular:

- a secret (password, passphrase, key) leaking to disk, logs or an export;
- bypassing `known_hosts` verification;
- remote code execution, or file system access from the web view;
- weakening the Content Security Policy or the Tauri permissions;
- an update accepted without a valid signature.

## Principles

- Secrets are stored only in the OS keyring.
- The web view has no `fs` or `shell` plugin: everything goes through dedicated Rust
  commands. Local files are opened only through the system's file dialog.
- No telemetry. The only network request Tilde makes on its own is the update check at
  startup: at most once a day, to GitHub releases, with nothing sent. It can be turned off in
  *Settings → General*.
- On a server, Tilde runs only what you type, plus a read-only command for the status strip
  under each SSH session (`cat` of a few `/proc` files and `df` on local disks, every 3 s
  while the session is shown). It can be turned off in *Settings → SSH*.
- Updates are signed (minisign): an update whose signature does not match the public key
  built into Tilde is refused.

## Supported versions

Security fixes go into the latest release; Tilde updates itself to it.
