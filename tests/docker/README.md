# SSH test bench

Three OpenSSH containers used by `cargo test -p tilde-ssh --features integration`:

```
host ──2201──▶ bastion1 ──▶ bastion2 ──▶ target (also on 2203; echo server on target:7777)
```

- User `tilde`, password `tilde-test` (test-only).
- Keys are **generated locally** by `scripts/ssh-test-env.{sh,ps1} up` into `keys/` (git-ignored):
  `id_ed25519` (no passphrase), `id_ed25519_pass` (passphrase `tilde-pass`), `id_rsa`.
  They are never committed and must never be used anywhere else.

```sh
scripts/ssh-test-env.sh up      # or: pwsh scripts/ssh-test-env.ps1 up
cargo test -p tilde-ssh --features integration
scripts/ssh-test-env.sh down
```
