"""Run the pilot with one existing app credential. Keys stay in child environment."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / '.venv' / 'Lib' / 'site-packages'))
from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore

parser = argparse.ArgumentParser()
parser.add_argument('--provider', required=True, choices=['gemini', 'openai', 'anthropic', 'moonshot', 'qwen'])
args, remaining = parser.parse_known_args()
key, model = ProviderSettingsStore().load(args.provider)
if not key or not model:
    sys.exit('No saved key/model for the selected provider in this app.')
node = os.environ.get('NADLAN_NODE') or shutil.which('node')
if not node:
    sys.exit('Node.js 24+ is required; set NADLAN_NODE to its executable.')
env = os.environ.copy()
env['APPRAISAL_AI_KEY'] = key
result = subprocess.run([node, str(ROOT / 'tools' / 'nadlan_transactions.mjs'),
                         '--provider', args.provider, '--model', model, *remaining],
                        cwd=ROOT, env=env, timeout=300, capture_output=True, text=True, encoding='utf-8',
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
for output in (result.stdout, result.stderr):
    if output:
        print(output.replace(key, '[REDACTED]'), end='')
sys.exit(result.returncode)
