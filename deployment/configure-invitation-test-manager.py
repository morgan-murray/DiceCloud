#!/usr/bin/env python3
"""Configure only a synthetic CI fixture's ID as invitation manager."""
import argparse, json
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--env', type=Path, required=True)
p.add_argument('--fixture', type=Path, required=True)
a = p.parse_args()
fixture = json.loads(a.fixture.read_text())
owner = fixture['owner']
if not owner['username'].startswith('runtime-owner-') or not isinstance(owner.get('userId'), str) or not owner['userId']:
    p.error('Expected the synthetic native-workflow owner ID')
lines = [line for line in a.env.read_text().splitlines() if not line.startswith('PLAYER_INVITATION_MANAGERS=')]
lines.append('PLAYER_INVITATION_MANAGERS=' + json.dumps([owner['userId']], separators=(',', ':')))
a.env.write_text('\n'.join(lines) + '\n')
a.env.chmod(0o600)
print('Configured synthetic invitation manager; registration policy unchanged.')
