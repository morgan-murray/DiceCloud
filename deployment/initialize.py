#!/usr/bin/env python3
"""Create private local deployment configuration without printing secrets."""
import argparse, os, secrets
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,required=True);p.add_argument('--port',type=int,default=31080);a=p.parse_args()
if not 1024<=a.port<=65535:p.error('port must be between 1024 and 65535')
d=a.directory.resolve()
if d.exists():p.error('directory already exists; refusing to replace configuration')
d.mkdir(parents=True,mode=0o700);os.chmod(d,0o700)
secret_dir=d/'secrets';secret_dir.mkdir(mode=0o700)
for name in ['mongo_root_password','mongo_app_password']:
 f=secret_dir/name;f.write_text(secrets.token_hex(32)+'\n');f.chmod(0o444)
# Readable secret files are behind 0700 host directories. Each container receives
# only its required files, including the MongoDB image's distinct Unix uid.
env=d/'runtime.env';env.write_text(f'DICECLOUD_SECRETS_DIR={secret_dir}\nDICECLOUD_PORT={a.port}\nROOT_URL=http://127.0.0.1:{a.port}\nALLOW_REGISTRATION=false\nDICECLOUD_IMAGE=dicecloud:runtime\n');env.chmod(0o600)
print('Created private configuration:',str(env))
