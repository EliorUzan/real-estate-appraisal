# Personal Antigravity research

The existing report prompt is unchanged. Research is enabled by a fixed native
agent capability profile, not by adding report instructions.

`web-search-v1` exposes only `search_web`. Native settings remain strict. File
reads/writes, shell execution, browser actuation, MCP and delegation are excluded.
The parser accepts search events only with the reviewed registry and selected
agent. The existing isolated provider relay is unchanged: native search operates
through Google's approved provider endpoint.

## Operator procedure

Pause admissions by draining the host; verify no active job. Stop the supervisor
without interrupting any job. Run these commands from the repository root:

```sh
PYTHONPATH=src python3 deploy/cli-gateway/probe-research.py --config /workspaces/.cli-gateway-state/worker.env --mode search
PYTHONPATH=src python3 deploy/cli-gateway/probe-research.py --config /workspaces/.cli-gateway-state/worker.env --mode canary
PYTHONPATH=src python3 deploy/cli-gateway/verify-egress.py --config /workspaces/.cli-gateway-state/worker.env --egress /workspaces/.cli-gateway-state/runtime/egress-gemini.json
PYTHONPATH=src python3 deploy/cli-gateway/approve-research.py --config /workspaces/.cli-gateway-state/worker.env
PYTHONPATH=src python3 deploy/cli-gateway/resume-personal.py --config /workspaces/.cli-gateway-state/worker.env
```

Approval checks fresh, hash-bound search, native permission denial and network
reports. It rotates only the single personal manifest and retains the original
in a private `.backup` file. It does not change customer G1/G2 gates or database
admissions. After startup advertises the approved digest, update the Google
provider digest and set the idle, healthy host ready in one transaction. Verify
a synthetic frontend job settles successfully before declaring it operational.
Never print configuration files, native authentication or host secrets.

For rollback, drain and stop the idle worker. Restore its original private
manifest backup, resume it, and switch the provider digest to that advertised
original digest before undraining. Do not replay interrupted native attempts.

## Capabilities awaiting verification

`probe-research.py --mode read` tests page reading separately and cannot approve
it. Tests on 2026-10-11 emitted native read events but returned an empty final
answer. Page reading is not in the active capability profile.

Google Maps MCP requires a separate Maps credential. The native Antigravity
login does not grant Maps Platform access. The official no-card demo key:
https://developers.google.com/maps/demo-key supports Maps Grounding Lite for
prototyping. The account owner must sign in and accept Google's demo terms.
Store the key through the interactive helper, never chat, arguments or Git:

```sh
python3 deploy/cli-gateway/configure-maps.py --config /workspaces/.cli-gateway-state/worker.env
```

This only creates a private pending MCP configuration. Maps activation still
requires exact MCP tool scoping, testing native permission enforcement, allowing
the exact Maps endpoint in the relay, new network evidence, attribution in the
result view, and validating Maps' compatible-model/data-use requirements for the
user's provider account. See https://developers.google.com/maps/ai/grounding-lite.
Maps results describe places; they do not establish zoning, building rights,
construction condition or legal property facts. Those need authoritative sources.
