# Private runtime baseline

This branch modernizes DiceCloud before URL-prefix support and Aurora imports.
It includes the upstream Meteor 3 migration through
`05c522cd8ed5d171ab96a0a55a08e18d06555686`, preserving upstream history.
The migration also changes Vue 2 to Vue 3, Vuetify 2 to Vuetify 3 and the bundler
to Rspack; it requires application regression testing, not just an image build.

## Versions and update policy

| Component | Selected version | Reason |
| --- | --- | --- |
| Meteor | 3.4.3 | Patched Node 22 release, close to the upstream migration |
| Node | 22.23.4 | Supported Node 22 LTS, pinned container image digest |
| MongoDB | 7.0.45 | Supported release, pinned by digest; works with the host kernel |
| Architecture | Linux amd64 | The tested deployment target |

Meteor's [release history](https://docs.meteor.com/history.html) documents 3.4.3
as the security backport alongside 3.5.4. A later move to Meteor 3.5/Node 24
should be a separate upgrade, with this test suite rerun.
MongoDB 8.0.34 was rejected after the clean CI startup failed its Linux kernel compatibility check ([upstream issue](https://jira.mongodb.org/browse/SERVER-121912)). MongoDB 7.0.45 starts on the target kernel and is [supported until 31 August 2027](https://www.mongodb.com/legal/support-policy/lifecycles); plan the next database upgrade before that date.

The application, generated server dependencies, browser tests and Meteor packages
all have committed dependency locks. `deployment/bundle-package.json` and its
shrinkwrap replace vulnerable build-tool versions in Meteor's generated bundle.
Review those files whenever Meteor's generated package manifest changes.

The build uses the checked-out source. It never clones a floating upstream branch.
No Redis service is required: MongoDB is a standalone authenticated service and
Meteor uses polling. A replica set can be considered if later measurements justify
oplog tailing. The unused batch-insert dependency and stale Redis submodule entry
have been removed.

## Build and private startup

Requires Docker with Compose, Python 3.11+ for deployment tools, Linux amd64,
and sufficient disk. It does not change the host Node or Python installation.
Builds need several GiB of temporary space; keep at least 3 GiB free and stop if
that reserve is approached. Use a clean CI runner when the shared server cannot
accommodate the build. Do not prune unrelated containers, images or volumes.

```sh
docker build --progress=plain --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" -t dicecloud:runtime .
python3 deployment/initialize.py --directory /srv/dicecloud-config
docker compose --env-file /srv/dicecloud-config/runtime.env -p dicecloud-private up -d --no-build --wait
curl --fail http://127.0.0.1:31080/api/status
```

The initializer refuses an existing directory. The configuration directory is
0700 and environment file 0600. Individual secret files are readable only through
that private directory and are mounted only in the containers needing them.
MongoDB receives root and application passwords; the app receives only the
application password. Do not commit the configuration or include it in build
contexts. Do not put passwords in Compose arguments, URLs, tickets or logs.

The app runs as a non-root user, with a read-only root filesystem, a bounded
temporary filesystem and a persistent upload volume. MongoDB has no host port.
The app port binds only to 127.0.0.1. No reverse proxy, shared network, public route
or DNS change is part of this phase. Use an SSH tunnel to reach the private UI.

Health checks require an application database round trip. Compose starts the app
after MongoDB becomes healthy. Log files are limited to three 10 MB files per
service. App and database memory limits are 2 GiB and 768 MiB respectively.

## Accounts and content

Registration is disabled by default, independently of the UI. For initial account
setup, temporarily set `ALLOW_REGISTRATION=true` in the private environment file,
recreate the private app, create the accounts through the tunneled browser, then
set it back to `false` and recreate the app again. Verify a further registration
attempt fails. Keep that setting false before adding any public route later.
Existing users can still log in. The default stack disables Patreon restrictions.

Start with empty libraries or content you are licensed to use. This repository
does not include commercial rulebooks or Aurora content packs. SMTP and third-party
sign-in are not configured by this baseline; email recovery needs separate private
mail configuration before it is relied on. Never retain an upstream service's
sender address for a self-hosted installation.

## Tests

`npm ci` in `app/` installs the application dependencies. With the selected Meteor
toolchain, `npm run test:server` runs the server test suite once. Unit tests use a
disposable database and must never be pointed at an existing deployment database.
Test entry modules await async imports before Mocha begins, so asynchronous test
registration cannot produce a misleading small passing result.

The browser suite is separate from the app bundle:

```sh
cd deployment/browser
npm ci
npx playwright install --with-deps chromium
DICECLOUD_TEST_FIXTURE=/private/test-fixture.json npm test -- --grep 'root mode'
DICECLOUD_VERIFY_RESTORE=1 DICECLOUD_TEST_FIXTURE=/private/test-fixture.json npm test -- --grep 'retained fixture'
```

Set `DICECLOUD_TEST_URL` to the loopback URL of the target stack. The first run
requires registration enabled and creates disposable synthetic accounts. The
fixture contains generated test credentials; keep it private and delete it after
the rehearsal. Run the second command after restarting or restoring the stack,
against the same retained fixture. Extend this suite in the following URL phase.

## Consistent backup and recovery

Backups stop the app to quiesce its writers, logically dump the application
database, archive uploads and record the exact image ID, embedded source revision and
configuration hash. The tooling checkout revision is recorded separately; builds without
a source label report an unknown image revision. They restart the app if it had been running, including on
failure. Do not allow other writers to that database during the backup window.
Copying live database files is not a backup strategy.

```sh
python3 deployment/operations.py --env /srv/dicecloud-config/runtime.env --project dicecloud-private backup --destination /srv/dicecloud-backups/2026-11-04
python3 deployment/initialize.py --directory /srv/dicecloud-restore-config --port 31081
# Set DICECLOUD_IMAGE in the new environment file to the backup manifest's image_id.
python3 deployment/operations.py --env /srv/dicecloud-restore-config/runtime.env --project dicecloud-restore-rehearsal restore --backup /srv/dicecloud-backups/2026-11-04
```

A completed backup has a manifest written last, with SHA-256 checksums. A directory
without that manifest is incomplete. The tools refuse existing destinations,
restores over existing Docker resources, ambiguous project names, wrong image
versions, checksum mismatches and insufficient free space. Restores require a fresh
`dicecloud-restore-*` project, fresh credentials, separate volumes and another
loopback port. Never rename a live project to make it pass a guard.

Backups contain private account hashes and character content. Keep directories
0700 and files 0600 on encrypted storage. Retain at least the most recent verified
backup and one previous verified backup; measure space before selecting a larger
retention count. Delete only explicitly selected old application backup directories
after a newer restore has passed. No automatic deletion or off-server destination
is configured here. Retain the exact runtime image for each retained backup and a
private copy of deployment settings; container image IDs alone are not an archive.

Image/config rollback and database rollback are different operations. Use the
recorded image and compatible configuration for an image rollback. If a migration
has run, restore the pre-migration database and files into a fresh stack and verify
them before switching traffic. Do not downgrade an image against a newer schema
and assume it is safe. Future importer originals and content manifests must join
the persistent file volume and backup set.

## Acceptance evidence

See the runtime PR for actual clean-build, server-test, browser and recovery
results, including remaining limitations. A successful compile is not sufficient
evidence for production readiness. Do not close the runtime phase until those
checks are reviewed; the URL phase starts from the merged runtime baseline.
