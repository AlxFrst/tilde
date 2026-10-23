#!/usr/bin/env sh
# Starts/stops the SSH test bench (see tests/docker/README.md). Usage: up | down | status
#
# Credentials are generated per checkout into tests/docker/keys (git-ignored): the user
# password, a key passphrase and three key pairs. Nothing secret is committed.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DOCKER_DIR="$ROOT/tests/docker"
KEYS="$DOCKER_DIR/keys"

random() { od -An -N12 -tx1 /dev/urandom | tr -d ' \n'; }

gen_credentials() {
  mkdir -p "$KEYS"
  [ -f "$KEYS/password" ] || random > "$KEYS/password"
  [ -f "$KEYS/passphrase" ] || random > "$KEYS/passphrase"
  [ -f "$KEYS/id_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C tilde-test -f "$KEYS/id_ed25519"
  [ -f "$KEYS/id_ed25519_pass" ] ||
    ssh-keygen -q -t ed25519 -N "$(cat "$KEYS/passphrase")" -C tilde-test-pass -f "$KEYS/id_ed25519_pass"
  [ -f "$KEYS/id_rsa" ] || ssh-keygen -q -t rsa -b 3072 -N "" -C tilde-test-rsa -f "$KEYS/id_rsa"
  chmod 600 "$KEYS"/id_* "$KEYS/password" "$KEYS/passphrase" 2>/dev/null || true
  chmod 644 "$KEYS"/*.pub
}

case "${1:-}" in
  up) gen_credentials; docker compose -f "$DOCKER_DIR/compose.yml" up -d --build --wait ;;
  down) docker compose -f "$DOCKER_DIR/compose.yml" down -v ;;
  status) docker compose -f "$DOCKER_DIR/compose.yml" ps ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
