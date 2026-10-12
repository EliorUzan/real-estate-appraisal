"""Store an operator's Maps demo key outside Git, without displaying it.

This prepares a credential only. It does not activate MCP or change a runtime.
Run interactively in the personal Codespace; never supply a key as an argument.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    args=parser.parse_args()
    path=Path(args.config)
    if (os.environ.get('CODESPACES')!='true' or not sys.stdin.isatty() or not path.is_absolute()
        or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077):
        raise ValueError('Private personal configuration and interactive terminal required')
    values=dict(line.split('=',1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    data=Path(values['CLI_DATA_DIR'])
    if data.is_symlink() or not data.is_absolute() or data.stat().st_mode & 0o077:
        raise ValueError('Private operator directory required')
    target=data/'maps-mcp.pending.json'
    if target.exists() or target.is_symlink():raise ValueError('A pending credential already exists')
    key=getpass.getpass('Paste your Maps demo key here (hidden; never paste in chat): ')
    if not re.fullmatch(r'AIza[A-Za-z0-9_-]{35}',key):raise ValueError('Unexpected API key format')
    config={'mcpServers':{'google-maps':{'serverUrl':'https://mapstools.googleapis.com/mcp',
        'headers':{'X-Goog-Api-Key':key}}}}
    descriptor=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w') as output:json.dump(config,output)
    print('Maps credential stored privately. MCP is pending verification and is not active.',flush=True)


if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt):
        print('Maps credential setup stopped; no credential was printed.',flush=True)
        raise SystemExit(1) from None
