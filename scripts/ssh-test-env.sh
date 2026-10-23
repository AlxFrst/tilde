#!/usr/bin/env sh
# Starts/stops the SSH test bench (see tests/docker/README.md). Usage: up | down | status
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DOCKER_DIR="$ROOT/tests/docker"
KEYS="$DOCKER_DIR/keys"

gen_keys() {
  mkdir -p "$KEYS"
  [ -f "$KEYS/id_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C tilde-test -f "$KEYS/id_ed25519"
  [ -f "$KEYS/id_ed25519_pass" ] || ssh-keygen -q -t ed25519 -N tilde-pass -C tilde-test-pass -f "$KEYS/id_ed25519_pass"
  [ -f "$KEYS/id_rsa" ] || ssh-keygen -q -t rsa -b 3072 -N "" -C tilde-test-rsa -f "$KEYS/id_rsa"
  chmod 600 "$KEYS"/id_* 2>/dev/null || true
  chmod 644 "$KEYS"/*.pub
}

case "${1:-}" in
  up) gen_keys; docker compose -f "$DOCKER_DIR/compose.yml" up -d --build --wait ;;
  down) docker compose -f "$DOCKER_DIR/compose.yml" down -v ;;
  status) docker compose -f "$DOCKER_DIR/compose.yml" ps ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
