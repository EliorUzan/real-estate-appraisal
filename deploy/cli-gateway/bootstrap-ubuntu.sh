#!/usr/bin/env bash
# Ubuntu 24.04 ARM64/AMD64. Run only on the dedicated, newly provisioned VM.
# Installs infrastructure; never starts inference or imports provider credentials.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run as root on the dedicated VM'; exit 1; }
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04
apt-get update
apt-get install -y ca-certificates curl uidmap dbus-user-session python3 git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce-cli docker-ce-rootless-extras
id cli-gateway >/dev/null 2>&1 || useradd --create-home --shell /bin/bash cli-gateway
loginctl enable-linger cli-gateway
worker_uid=$(id -u cli-gateway)
sudo -u cli-gateway XDG_RUNTIME_DIR="/run/user/$worker_uid" dockerd-rootless-setuptool.sh install
install -d -o cli-gateway -g cli-gateway -m 0700 /var/lib/cli-gateway
install -d -o root -g cli-gateway -m 0750 /etc/cli-gateway /etc/cli-gateway/manifests /etc/cli-gateway/evidence
printf 'Rootless Docker prepared. UID=%s. Copy the reviewed application and configure worker.env before starting.\n' "$worker_uid"
