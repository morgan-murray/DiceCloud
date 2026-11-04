#!/usr/bin/env python3
"""Consistent, private DiceCloud backups and guarded disposable restores."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
MARGIN = 3 * 1024**3


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def compose(env, project, *args, **kwargs):
    return run(['docker', 'compose', '--project-directory', str(ROOT),
                '--env-file', str(env), '-p', project, *args], **kwargs)


def output(env, project, *args):
    return compose(env, project, *args, capture_output=True, text=True).stdout.strip()


def capacity(path, needed=0):
    if shutil.disk_usage(path).free < MARGIN + needed:
        raise RuntimeError('Insufficient free disk; preserve a 3 GiB reserve')


def config_digest(env, project):
    # Compose configuration contains secret file paths, never secret values.
    config = output(env, project, 'config')
    return hashlib.sha256(config.encode()).hexdigest()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def backup(args):
    destination = args.destination.resolve()
    if destination.exists():
        raise RuntimeError('Backup destination already exists')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    capacity(destination.parent)
    destination.mkdir(mode=0o700)
    os.chmod(destination, 0o700)
    app = output(args.env, args.project, 'ps', '-q', 'app')
    if not app:
        raise RuntimeError('Source application container does not exist')
    details = json.loads(run(['docker', 'inspect', app], capture_output=True, text=True).stdout)[0]
    was_running = details['State']['Running']
    image_id = details['Image']
    try:
        # Stop all application writers before dumping the standalone database and files.
        if was_running:
            compose(args.env, args.project, 'stop', '-t', '45', 'app')
        with (destination / 'database.archive.gz').open('wb') as stream:
            compose(args.env, args.project, 'exec', '-T', 'mongo', 'sh', '-ec',
                    'exec mongodump --quiet --host 127.0.0.1 --username dicecloud '
                    '--password "$(cat /run/secrets/mongo_app_password)" '
                    '--authenticationDatabase dicecloud --db dicecloud --gzip --archive', stdout=stream)
        # A one-off app uses the same volume without starting Meteor.
        with (destination / 'files.tar').open('wb') as stream:
            compose(args.env, args.project, 'run', '--rm', '--no-deps', '-T',
                    '--entrypoint', 'tar', 'app', '-C', '/var/lib/dicecloud', '-cf', '-', '.', stdout=stream)
        for name in ['database.archive.gz', 'files.tar']:
            (destination / name).chmod(0o600)
        manifest = {
            'format': 1, 'completed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'source_project': args.project, 'image_id': image_id,
            'git_commit': run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip(),
            'compose_sha256': config_digest(args.env, args.project),
            'schema_note': 'Schema/migration records are included in the logical database dump.',
            'sha256': {name: digest(destination / name) for name in ['database.archive.gz', 'files.tar']},
        }
        completed = destination / 'manifest.json'
        completed.write_text(json.dumps(manifest, indent=2) + '\n')
        completed.chmod(0o600)
        print('Completed consistent backup:', destination)
    finally:
        if was_running:
            compose(args.env, args.project, 'start', 'app')
        # Missing manifest deliberately means incomplete; preserve evidence for inspection.


def restore(args):
    if not re.fullmatch(r'dicecloud-restore-[a-z0-9][a-z0-9-]*', args.project):
        raise RuntimeError('Restore project must start dicecloud-restore- and identify a fresh disposable stack')
    manifest = json.loads((args.backup / 'manifest.json').read_text())
    if manifest.get('format') != 1 or not manifest.get('completed_at_utc'):
        raise RuntimeError('Unsupported or incomplete backup')
    if args.project == manifest['source_project']:
        raise RuntimeError('Cannot restore over the source project')
    for name, expected in manifest['sha256'].items():
        if name not in ['database.archive.gz', 'files.tar'] or digest(args.backup / name) != expected:
            raise RuntimeError('Backup checksum mismatch')
    # Refuse even stopped containers and orphaned volumes with this project label.
    for kind in ['container', 'volume', 'network']:
        existing = run(['docker', kind, 'ls', '-q', '--filter', f'label=com.docker.compose.project={args.project}'],
                       capture_output=True, text=True).stdout.strip()
        if existing:
            raise RuntimeError('Restore target already has Docker resources; choose a fresh project')
    size = sum((args.backup / name).stat().st_size for name in manifest['sha256'])
    capacity(ROOT, size * 5)
    config = json.loads(output(args.env, args.project, 'config', '--format', 'json'))
    # Recovery must use the exact retained image, not a mutable tag or a new schema.
    if config['services']['app']['image'] != manifest['image_id']:
        raise RuntimeError('Set DICECLOUD_IMAGE in the private restore environment to manifest image_id')
    compose(args.env, args.project, 'up', '-d', '--wait', '--wait-timeout', '180', 'mongo')
    with (args.backup / 'database.archive.gz').open('rb') as stream:
        compose(args.env, args.project, 'exec', '-T', 'mongo', 'sh', '-ec',
                'exec mongorestore --quiet --host 127.0.0.1 --username dicecloud '
                '--password "$(cat /run/secrets/mongo_app_password)" '
                '--authenticationDatabase dicecloud --nsInclude "dicecloud.*" --gzip --archive', stdin=stream)
    with (args.backup / 'files.tar').open('rb') as stream:
        compose(args.env, args.project, 'run', '--rm', '--no-deps', '-T',
                '--entrypoint', 'tar', 'app', '-C', '/var/lib/dicecloud', '-xf', '-', stdin=stream)
    compose(args.env, args.project, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'app')
    print('Restored into fresh private project:', args.project)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, required=True)
    parser.add_argument('--project', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    save = commands.add_parser('backup'); save.add_argument('--destination', type=Path, required=True)
    load = commands.add_parser('restore'); load.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'dicecloud-[a-z0-9][a-z0-9-]*', args.project):
        parser.error('Use an explicit application-specific dicecloud-* project name')
    args.env = args.env.resolve(strict=True)
    try:
        {'backup': backup, 'restore': restore}[args.command](args)
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        print(f'Operation failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
