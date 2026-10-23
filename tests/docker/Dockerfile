# OpenSSH server for Tilde's integration tests. Test-only: weak password, test keys.
FROM alpine:3.20

RUN apk add --no-cache openssh-server socat \
 && ssh-keygen -A \
 && adduser -D -s /bin/sh tilde \
 && echo 'tilde:tilde-test' | chpasswd \
 && mkdir -p /home/tilde/.ssh && chown tilde:tilde /home/tilde/.ssh && chmod 700 /home/tilde/.ssh

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
HEALTHCHECK --interval=1s --timeout=2s --retries=30 CMD nc -z 127.0.0.1 22 || exit 1
ENTRYPOINT ["/entrypoint.sh"]
