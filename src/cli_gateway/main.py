"""Linux-only supervisor: PYTHONPATH=src python3 -m cli_gateway.main."""
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import time
from .client import Client
from .contracts import GatewayError
from .recovery import Journal
from .runner import Docker, Runner, container_name
from .research import PROFILE as RESEARCH_PROFILE, CHECKS as RESEARCH_CHECKS

PERSONAL_CHECKS = frozenset({'nativeAccountVerified', 'restrictedInferenceVerified', 'nativeReadDenied',
    'textOnlyCanaryPassed', 'networkChecksPassed', 'agentDiscovered'})


def personal_approval(entry):
    """Separate a verified single-account experiment from customer release gates."""
    if entry.get('personalExperimentApproved') is not True:
        return False
    if (entry.get('executionHostMode') != 'codespaces-personal' or os.environ.get('CODESPACES') != 'true'
        or entry.get('provider') != 'gemini' or entry.get('customerReleaseApproved') is not False
        or entry.get('g1Passed') is not False or entry.get('g2Passed') is not False):
        raise ValueError('Personal approval cannot authorize customer release')
    path = Path(entry.get('evidenceFile', ''))
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise ValueError('Private personal evidence file required')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry.get('evidenceDigest'):
        raise ValueError('Personal evidence changed after review')
    evidence = json.loads(raw)
    checks = evidence.get('checks')
    expected_checks = RESEARCH_CHECKS if entry.get('capabilityProfile') == RESEARCH_PROFILE else PERSONAL_CHECKS
    if entry.get('capabilityProfile') not in (None, RESEARCH_PROFILE):
        raise ValueError('Unknown capability profile')
    if evidence.get('capabilityProfile') != entry.get('capabilityProfile'):
        raise ValueError('Evidence capability scope mismatch')
    if (not isinstance(checks, dict) or set(checks) != expected_checks
        or any(value is not True for value in checks.values()) or evidence.get('customerReleaseApproved') is not False):
        raise ValueError('Incomplete personal verification')
    for key in ('provider', 'cliRuntime', 'version', 'image', 'personalRuntimeRef', 'policyDigest',
                'agentDigest', 'egressDigest', 'toolRegistryDigest'):
        if not entry.get(key) or evidence.get(key) != entry[key]:
            raise ValueError('Personal evidence scope mismatch')
    return True


def manifests(directory):
    approved = {}
    for path in Path(directory).glob("*.json"):
        raw = path.read_bytes()
        entry = json.loads(raw)
        if not personal_approval(entry) and (entry.get("g1Passed") is not True or entry.get("g2Passed") is not True):
            continue
        for key in ("provider", "version", "image", "network", "policyDigest", "authMode", "evidenceFile"):
            if not isinstance(entry.get(key), str) or not entry[key]:
                raise ValueError("Incomplete approved manifest")
        if entry["provider"] not in {"claude", "openai", "gemini"} or entry["authMode"] != "native-account":
            raise ValueError("Unsupported authentication mode")
        if entry.get("syntheticDiagnostic") or entry["network"] != "cli-provider-" + entry["provider"] or not isinstance(entry.get("egressFile"), str) or not re.fullmatch(r"[0-9a-f]{64}", entry.get("egressDigest", "")):
            raise ValueError("Approved jobs require a reviewed private egress relay")
        if entry["provider"] == "gemini" and entry.get("cliRuntime") != "antigravity":
            raise ValueError("Google approval must cover Antigravity, not legacy Gemini CLI")
        if entry["provider"] == "gemini" and not isinstance(entry.get("settingsFile"), str):
            raise ValueError("Antigravity requires a read-only operator settings mount")
        if entry['provider'] == 'gemini' and (not isinstance(entry.get('agentFile'), str) or not re.fullmatch(r'[0-9a-f]{64}', entry.get('agentDigest', ''))):
            raise ValueError('Antigravity requires a reviewed agent definition')
        if entry.get('toolRegistryDigest') is not None and not re.fullmatch(r'[0-9a-f]{64}', entry['toolRegistryDigest']):
            raise ValueError('Invalid native registry fingerprint')
        mode = entry.get("executionHostMode", "rootless-vm")
        if mode not in {"rootless-vm", "codespaces-personal"}:
            raise ValueError("Unsupported execution host mode")
        if mode == "codespaces-personal":
            if os.environ.get("CODESPACES") != "true" or entry.get("customerReleaseApproved") is not False:
                raise ValueError("Codespaces is restricted to the personal experiment")
            if not re.fullmatch(r"cli-home-[0-9a-f-]{36}", entry.get("personalRuntimeRef", "")):
                raise ValueError("A single personal runtime must be approved")
        if not Path(entry["evidenceFile"]).is_file():
            raise ValueError("Missing gate evidence")
        approved[hashlib.sha256(raw).hexdigest()] = entry
    return approved


def recover(engine, client, journal):
    local = journal.load()
    assigned = client.call("getAssignment").get("job")
    names = engine.inventory()
    if local is None and not assigned and names:
        for name in names:
            engine.stop(name)
        client.call("quarantineHost")
        raise GatewayError("UNKNOWN_CONTAINER")
    if local is None and not assigned:
        return
    if local and assigned and local["jobId"] != assigned["jobId"]:
        for name in names:
            engine.stop(name)
        client.call("quarantineHost")
        raise GatewayError("ASSIGNMENT_MISMATCH")
    attempt = local or assigned
    name = container_name(attempt["jobId"], attempt["attemptNumber"])
    # An inventory response must succeed before absence is accepted as stop proof.
    for other in names:
        engine.stop(other)
    unknown = any(other != name for other in names)
    if unknown:
        client.call("quarantineHost")
    ids = {k: attempt[k] for k in ("jobId", "attemptNumber", "leaseToken")}
    client.call("reconcile", **ids, containerRef=name, stopped=True)
    if name in names:
        engine.remove(name)
    journal.clear()
    if unknown:
        # Reconciliation drains the host; retain the stronger quarantine state.
        client.call("quarantineHost")
        raise GatewayError("UNKNOWN_CONTAINER")


def main():
    import fcntl  # Runtime is Linux; parsers/recovery fixtures also run on Windows.
    data = Path(os.environ["CLI_DATA_DIR"])
    data.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (data / "supervisor.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        secret_path = Path(os.environ["CLI_HOST_SECRET_FILE"])
        if secret_path.stat().st_mode & 0o077:
            raise ValueError("Host secret must be readable only by the supervisor")
        client = Client(os.environ["CLI_WORKER_URL"], os.environ["CLI_HOST_ID"], secret_path.read_text().strip())
        engine, journal = Docker(), Journal(data / "journal")
        approved = manifests(os.environ["CLI_MANIFEST_DIR"])
        login_directory = os.environ.get("CLI_LOGIN_MANIFEST_DIR")
        login_approved = {}
        login_runner = login_journal = None
        if login_directory:
            from .login import load_login_manifests, LoginRunner
            from .login_recovery import recover_login
            login_approved = load_login_manifests(login_directory, approved)
            login_journal = Journal(data / "login-journal")
            login_runner = LoginRunner(engine, client, login_journal)
        setup_directory = os.environ.get("CLI_MAPS_CONFIG_DIR")
        setup_runner = setup_journal = setup_store = None
        if setup_directory:
            from .login_crypto import LoginKey  # Verify crypto dependency before advertising readiness.
            from .maps_config import MapsStore, MapsSetupRunner, recover_setup
            setup_store = MapsStore(setup_directory)
            setup_journal = Journal(data / "setup-journal")
            setup_runner = MapsSetupRunner(engine, client, setup_journal, setup_store)
        # Startup health deliberately drains execution until recovery has finished.
        client.call("heartbeatHost", manifests=list(approved))
        if login_directory:
            recover_login(engine, client, login_journal)
        if setup_directory:
            recover_setup(engine, client, setup_journal, setup_store)
        recover(engine, client, journal)
        stopping = False
        def stop(_signal, _frame):
            nonlocal stopping
            stopping = True
            # Stop named runtimes, rather than merely interrupting their Docker clients.
            for name in engine.inventory():
                engine.stop(name)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        runner = Runner(engine, client, journal)
        last_kind = "maintenance"
        def maintenance_work():
            if login_approved:
                login = client.call("claimLogin").get("login")
                if login:
                    if login.get("recoveryRequired"):
                        recover_login(engine, client, login_journal)
                    else:
                        manifest = login_approved.get(login["loginManifestDigest"])
                        inference = approved.get(login["manifestDigest"])
                        if not manifest or not inference or manifest["inferenceManifestDigest"] != login["manifestDigest"]:
                            client.call("quarantineHost")
                            raise GatewayError("MANIFEST_MISMATCH")
                        login_runner.run(login, manifest, inference)
                    return True
            if setup_directory:
                setup = client.call("claimSetup").get("setup")
                if setup:
                    if setup.get("recoveryRequired"):
                        recover_setup(engine, client, setup_journal, setup_store)
                    else:
                        setup_runner.run(setup)
                    return True
            return False
        while not stopping:
            try:
                capabilities = {**({"loginProtocol": "antigravity-login-v1"} if login_approved else {}), **({"setupProtocol": "maps-setup-v1"} if setup_directory else {})}
                health = client.call("heartbeatHost", manifests=list(approved), **capabilities)
                for connection in client.call("getMaintenance")["connections"]:
                    if connection["status"] == "disconnecting":
                        # Removing the personal volume happens only after no active container uses it.
                        if not engine.inventory():
                            volumes = engine.command(["volume", "ls", "--format", "{{.Name}}"] ).decode().splitlines()
                            if connection["runtimeRef"] in volumes:
                                engine.command(["volume", "rm", connection["runtimeRef"]])
                            client.call("reportConnection", connectionId=connection["id"], revision=connection["revision"], status="disconnected")
                if not health.get("drain"):
                    if last_kind == "inference" and maintenance_work():
                        last_kind = "maintenance"
                        continue
                    job = client.call("claim").get("job")
                    if job:
                        if job.get("recoveryRequired"):
                            recover(engine, client, journal)
                        else:
                            manifest = approved.get(job["manifestDigest"])
                            if not manifest or manifest["provider"] != job["provider"]:
                                client.call("quarantineHost")
                                raise GatewayError("MANIFEST_MISMATCH")
                            runner.run(job, manifest)
                        last_kind = "inference"
                    elif maintenance_work():
                        last_kind = "maintenance"
                time.sleep(5)
            except (GatewayError, OSError, ValueError):
                # Diagnostics intentionally contain no payloads, tokens or CLI output.
                print("CLI gateway cycle failed; reconciling before claiming again", flush=True)
                if login_directory and (login_journal.load() or client.call("getLoginAssignment").get("login")):
                    recover_login(engine, client, login_journal)
                if setup_directory and (setup_journal.load() or client.call("getSetupAssignment").get("setup")):
                    recover_setup(engine, client, setup_journal, setup_store)
                if journal.load() or engine.inventory():
                    recover(engine, client, journal)
                time.sleep(5)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', help='Private operator environment file; values are never printed')
    args = parser.parse_args()
    try:
        if args.config:
            path = Path(args.config)
            if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
                raise ValueError('Private regular worker configuration required')
            values = dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
            allowed = {'CLI_WORKER_URL', 'CLI_HOST_ID', 'CLI_DATA_DIR', 'CLI_MANIFEST_DIR', 'CLI_HOST_SECRET_FILE',
                       'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR', 'CLI_LOGIN_MANIFEST_DIR', 'CLI_MAPS_CONFIG_DIR'}
            if set(values) - allowed:
                raise ValueError('Unsupported operator environment setting')
            os.environ.update(values)
        main()
    except Exception:
        # A traceback can expose provider/transport details. Report no payloads.
        print('CLI gateway startup stopped; review configuration or reconcile the drained host.', flush=True)
        raise SystemExit(1) from None
