# Aurora snapshot importer

The application bundles Aurora Core Reference (2014) v1.0.0, a partial compatibility pack with 91 definitions. It loads automatically; the user need not find or upload Aurora's internal data. See [reference/NOTICE.md](reference/NOTICE.md) for exact scope, CC-BY-4.0 attribution and provenance. Other required class/race/spell/item XML definitions remain private uploads. The full mixed-source Flare reference file is not included.

The feature is disabled by default. Set `AURORA_IMPORT_ENABLED=true` in the Compose environment and recreate the app after verification. No extra published port or network service is needed. The worker uses a digest-pinned Python 3.13.18 runtime included in the app image. It is an unprivileged subprocess with input, output, XML/ZIP, CPU, memory and wall-time limits. It never fetches remote indexes, images or URLs and never evaluates source expressions as code. No user-provided path or command reaches the subprocess API.

## Supported fidelity

Aurora's native `build/equipment`, `build/magic` and `build/input/attacks` sections are read explicitly. Legacy top-level equivalents remain supported; conflicting copies are rejected. Embedded `display-properties/portrait/base64` data is omitted without decoding or fetching it, with a preview warning. Add a portrait separately after import. The original uploaded file and its hash are retained under the existing private-source policy. The 2 MiB character upload cap and normal XML text/security limits still apply.

2014 saved sheets only. Six abilities, saves and skills use final fixed native values without a default live ruleset. Saved HP rolls or explicit average-HP selections, basic armor/shields, initiative, explicit movement, saved final casting attack/DC, explicit spell preparation flags, spell descriptions, inventory/currency and notes are supported within the contract. Ordinary and Pact Magic slot pools must be distinguished explicitly when multiple casting sources exist. Remaining HP/slots/hit dice are initialized to full after acknowledgement. Attacks and other active features are descriptive/manual. This is not a level-up engine or a comprehensive Aurora replacement.

Missing required content, unsupported numeric expressions/requirements, unknown rules versions, ambiguous slot pools, append/remove patches and conflicting built-in IDs fail visibly. A complete commercial compendium is not bundled. Importing a common actual Aurora sheet may require further parser coverage; the synthetic corpus is not proof of universal compatibility. A private saved character was used only to reproduce the portrait ingestion failure and inspect field locations. Public regression fixtures remain synthetic; no private character or portrait is included in source or CI.

## Verification

From the repository root:

```
PYTHONPATH=importer python3 -m unittest discover -s importer/tests -v
node --test deployment/test_aurora_adapter.mjs
```

The container test target also runs native Meteor schema/computation, ownership, idempotency and rollback fault tests. The synthetic fixture content and character files are dedicated to the public domain under CC0-1.0. Their expected totals were independently calculated and recorded in fixtures/expected.json. They contain invented names/content, not saved private characters.

## Storage and recovery

`auroraPacks`, `auroraJobs` and `auroraLocks` are server-only Mongo collections. Source originals are private and included in normal consistent database backups. No Mongo TTL automatically discards a committing job: startup/periodic recovery first checks whether the complete creature was published, otherwise removes staged properties/variables before returning the job to preview. Previews expire after one hour. Completed originals remain until the owner deletes their source history; deleting sources/packs leaves imported snapshot values/provenance intact. Orphan records after account deletion are removed within one minute. Import sources have a separate 20 MiB per-user quota (five packs/three pending previews), independent of image/archive storage.

Commit is a compare-and-set claim with stable creature ID and owner-bound key. Every property is schema-validated, computed and written before the creature is inserted. Native publications cannot view the staged data without a creature ownership record. Failures before that final insert remove staged properties and variables. A retried successful commit returns the same character; no second character is created. Global worker concurrency is two and per-user import concurrency is one, enforced with expiring Mongo locks.

Before activation: build and test the exact image, run root and `/dnd/` browser import/ownership checks, rehearse restart/restore, and take a consistent backup. Preserve the prior image digest. The release gate must remain closed until these pass. To stop new imports, set `AURORA_IMPORT_ENABLED=false` and recreate the app. Imported snapshots need no worker/reference pack for normal reading and remain available with the feature disabled or on the previous app image; they use existing native schemas only. Revert the image with the existing deployment runbook if required, retaining the database. No DNS or Caddy change is required.
