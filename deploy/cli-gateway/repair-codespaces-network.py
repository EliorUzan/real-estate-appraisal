"""Allow only this relay across Codespaces' additional legacy firewall table.

Docker's primary table continues to enforce the internal isolated network. Never
flush a table, change a default policy, or allow other bridges or destinations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from cli_gateway.network import controls
from cli_gateway.runner import Docker


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--egress', required=True)
    args = parser.parse_args()
    if os.environ.get('CODESPACES') != 'true':
        raise ValueError('Personal Codespaces only')
    config = Path(args.config)
    if config.is_symlink() or not config.is_file() or config.stat().st_mode & 0o077:
        raise ValueError('Private regular configuration required')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):
        os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    data = Path(values['CLI_DATA_DIR'])
    path = Path(args.egress).resolve()
    raw = path.read_bytes()
    report = json.loads(raw)
    engine = Docker()
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if engine.inventory():
            raise ValueError('Stop native jobs and logins first')
        controls(engine, {'network': report['network'], 'egressFile': str(path), 'egressDigest': hashlib.sha256(raw).hexdigest()})
        if report['network'] != 'cli-provider-gemini':
            raise ValueError('This compatibility repair is scoped to Google')
        bridge = 'br-' + report['networkId'][:12]
        from urllib.parse import urlsplit
        ip = urlsplit(report['proxyUrl']).hostname
        chain = 'CLI-GEMINI-RELAY'
        prefix = ['/usr/bin/sudo', '-n', '/usr/sbin/iptables-legacy', '-w', '5']
        def run(args, optional=False):
            result = subprocess.run([*prefix, *args], capture_output=True, timeout=10, check=False)
            if result.returncode and not optional:
                raise ValueError('Legacy firewall operation failed')
            return result
        rules = [
            ['-d', ip + '/32', '-p', 'tcp', '--dport', '8888', '-m', 'conntrack', '--ctstate', 'NEW,ESTABLISHED', '-j', 'ACCEPT'],
            ['-s', ip + '/32', '-p', 'tcp', '--sport', '8888', '-m', 'conntrack', '--ctstate', 'ESTABLISHED', '-j', 'ACCEPT'],
            ['-j', 'DROP'],
        ]
        # An existing owned chain must already contain exactly our reviewed rules.
        existing = run(['-S', chain], optional=True)
        if existing.returncode:
            run(['-N', chain])
            for rule in rules:
                run(['-A', chain, *rule])
        else:
            if len(existing.stdout.decode().splitlines()) != 4:
                raise ValueError('Existing compatibility chain needs operator review')
            for rule in rules:
                run(['-C', chain, *rule])
        jump = ['-i', bridge, '-o', bridge, '-j', chain]
        if run(['-C', 'DOCKER-USER', *jump], optional=True).returncode:
            run(['-I', 'DOCKER-USER', '1', *jump])
        print(json.dumps({'legacyCompatibilityApplied': True, 'scope': 'same private bridge, relay TCP 8888 only', 'g2Passed': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Compatibility repair failed closed; no provider enabled. Review the owned chain before retrying.')
        raise SystemExit(1) from None
