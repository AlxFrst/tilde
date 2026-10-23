# Contributing to Tilde

Thanks for your interest! A few simple rules save everyone time.

## Before you code

- **Bug**: open an issue with the steps to reproduce it, your OS and Tilde version, and the
  logs if you can (*Réglages → Général → Logs*).
- **Feature**: open an issue first to discuss it, especially if it touches the architecture.
- **Security issue**: do not open a public issue; see [SECURITY.md](SECURITY.md).

## Setting up

See [Build from source](README.md#build-from-source) in the README.
[docs/architecture.md](docs/architecture.md) explains how the pieces fit together (in French).

## Rules

- **Tests first.** A bug fix comes with a test that failed before the fix.
- **CI must be green**:
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` ;
  - `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
    `cargo test --workspace` ;
  - `cargo deny check`.
- **Core crates stay Tauri-free.** The crates in `crates/` must not depend on Tauri, so they
  can be tested on their own.
- **One IPC path.** Every Tauri command lives in `src-tauri/src/commands/` and has a typed
  wrapper in `src/ipc/`. Components never call `invoke` directly.
- **Settings types are generated.** After changing `crates/tilde-config`, run
  `pnpm gen:types` and commit the result; CI checks it.
- **No secret** may be written to disk, logs or exports.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(ssh): …`, `fix(config): …`).

## Licence

By contributing, you agree that your contribution is published under the project's dual
licence, MIT OR Apache-2.0.
