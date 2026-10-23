#!/bin/sh
# Sets the test user's password from the per-run file, authorizes every test public key
# mounted in /keys, optionally starts a TCP echo server (port-forwarding tests), then
# runs sshd in the foreground.
set -e
if [ -f /keys/password ]; then
  printf 'tilde:%s\n' "$(cat /keys/password)" | chpasswd
fi
cat /keys/*.pub > /home/tilde/.ssh/authorized_keys 2>/dev/null || true
chown tilde:tilde /home/tilde/.ssh/authorized_keys
chmod 600 /home/tilde/.ssh/authorized_keys
if [ "${ECHO_PORT:-}" != "" ]; then
  socat TCP-LISTEN:"$ECHO_PORT",fork,reuseaddr EXEC:cat &
fi
exec /usr/sbin/sshd -D -e
