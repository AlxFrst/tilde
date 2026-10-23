#!/bin/sh
# Authorize every test public key mounted in /keys, optionally start a TCP echo
# server (for port-forwarding tests), then run sshd in the foreground.
set -e
cat /keys/*.pub > /home/tilde/.ssh/authorized_keys 2>/dev/null || true
chown tilde:tilde /home/tilde/.ssh/authorized_keys
chmod 600 /home/tilde/.ssh/authorized_keys
if [ "${ECHO_PORT:-}" != "" ]; then
  socat TCP-LISTEN:"$ECHO_PORT",fork,reuseaddr EXEC:cat &
fi
exec /usr/sbin/sshd -D -e
