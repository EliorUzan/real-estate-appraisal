#!/usr/bin/env bash
# Operator-installed postStartCommand; never contains account credentials.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
task_config="/workspaces/.cli-gateway-state/worker.env"
task_log="/workspaces/.cli-gateway-state/post-start.log"
[[ "${CODESPACES:-}" == "true" && -f "$task_config" ]] || exit 1
umask 077
# The outer lock also covers gaps between resume's network checks and supervisor.
# A second lifecycle invocation exits without starting another worker.
cd -- "$task_root"
nohup /usr/bin/flock --nonblock /workspaces/.cli-gateway-state/launcher.lock env PYTHONPATH=src python3 deploy/cli-gateway/resume-personal.py --config "$task_config" >"$task_log" 2>&1 </dev/null &
