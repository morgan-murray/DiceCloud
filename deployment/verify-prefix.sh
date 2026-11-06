#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Use a private disposable test directory}"
cd "$(dirname "$0")/.."
python3 deployment/initialize.py --directory "$RUNNER_TEMP/dicecloud-prefix-config" --port 31083
sed -i 's|^ROOT_URL=.*|ROOT_URL=https://localhost:31082/dnd/|' "$RUNNER_TEMP/dicecloud-prefix-config/runtime.env"
echo 'DICECLOUD_PROXY_PORT=31082' >> "$RUNNER_TEMP/dicecloud-prefix-config/runtime.env"
ALLOW_REGISTRATION=true AURORA_IMPORT_ENABLED=true docker compose -f docker-compose.yml -f deployment/compose.proxy.yml --env-file "$RUNNER_TEMP/dicecloud-prefix-config/runtime.env" -p dicecloud-prefix-ci up -d --no-build --wait --wait-timeout 180
curl --insecure --fail https://localhost:31082/dnd/api/status
(cd deployment/browser && DICECLOUD_TEST_URL=https://localhost:31082/dnd/ DICECLOUD_TEST_FIXTURE="$RUNNER_TEMP/dicecloud-prefix-fixture.json" npm test -- --grep 'native workflow|URL contract' && DICECLOUD_TEST_URL=https://localhost:31082/dnd/ DICECLOUD_TEST_FIXTURE="$RUNNER_TEMP/dicecloud-prefix-fixture.json" npm test -- --grep 'Aurora workflow')
(cd deployment/browser && DICECLOUD_TEST_URL=https://localhost:31082/dnd/ DICECLOUD_TEST_FIXTURE="$RUNNER_TEMP/dicecloud-prefix-fixture.json" npx playwright test --config playwright.firefox.config.mjs --grep 'Aurora workflow')
docker compose -f docker-compose.yml -f deployment/compose.proxy.yml --env-file "$RUNNER_TEMP/dicecloud-prefix-config/runtime.env" -p dicecloud-prefix-ci up -d --no-build --force-recreate --wait --wait-timeout 180 app
cd deployment/browser
DICECLOUD_TEST_URL=https://localhost:31082/dnd/ DICECLOUD_VERIFY_RESTORE=1 DICECLOUD_TEST_FIXTURE="$RUNNER_TEMP/dicecloud-prefix-fixture.json" npm test -- --grep 'retained fixture|closed registration'
cd ../..
python3 deployment/operations.py --env "$RUNNER_TEMP/dicecloud-prefix-config/runtime.env" --project dicecloud-prefix-ci backup --destination "$RUNNER_TEMP/dicecloud-prefix-backup"
python3 deployment/initialize.py --directory "$RUNNER_TEMP/dicecloud-prefix-restore-config" --port 31084
IMAGE_ID=$(docker image inspect dicecloud:runtime --format '{{.Id}}')
sed -i "s|DICECLOUD_IMAGE=.*|DICECLOUD_IMAGE=$IMAGE_ID|;s|^ROOT_URL=.*|ROOT_URL=http://127.0.0.1:31084/dnd/|" "$RUNNER_TEMP/dicecloud-prefix-restore-config/runtime.env"
python3 deployment/operations.py --env "$RUNNER_TEMP/dicecloud-prefix-restore-config/runtime.env" --project dicecloud-restore-prefix-ci restore --backup "$RUNNER_TEMP/dicecloud-prefix-backup"
cd deployment/browser
DICECLOUD_TEST_URL=http://127.0.0.1:31084/dnd/ DICECLOUD_VERIFY_RESTORE=1 DICECLOUD_TEST_FIXTURE="$RUNNER_TEMP/dicecloud-prefix-fixture.json" npm test -- --grep 'retained fixture|closed registration'
