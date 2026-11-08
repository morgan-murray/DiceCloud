# Rules reference operations

The bundled 2014 SRD is installed privately through **Rules Reference → Add 2014 rules to my library**. One native library with six category folders is grouped in a native library collection. This gives complete-content visibility through one library ACL and keeps source nodes out of character pickers (`searchable=false`, `fillSlots=false`). Managed source roots are read-only through native edit/ownership checks; personal libraries are separate.

`RULE_REFERENCE_ENABLED=false` disables new installs/updates, preserving access to existing pages. `RULE_REFERENCE_BOOTSTRAP_USER=<existing username>` performs the same validated, idempotent install for that account at startup; remove this setting after provisioning. It never creates accounts, changes character mechanics or changes registration.

The server-only installs/revisions/entries collections include the derived text index. Search validates native library access before returning any results, counts, snippets or a page. Library sharing is managed through Rules Reference's Share dialog to preserve read-only source and consistent reader permissions. No source library is public.

Update through **Check for updates** after deploying a newer bundle; identical content is a no-op. A complete previous revision is retained for **Previous version**. Source keys resolve against the active revision. An unpublished interrupted stage is reclaimed on retry. A lost final acknowledgement preserves the committed revision. Old revisions beyond current/previous are removed by the next successful maintenance operation. Removing a reference collection affects only its managed roots and derived records; other libraries/characters are untouched. Account-deletion orphans are reclaimed within one minute.

Backups must include all Mongo collections, including the derived entries index. Existing deployment/operations.py handles this. Image rollback can leave compatible native read-only note libraries in place; restore the recorded predeployment backup in isolation before any database rollback. The reference feature does not alter the native schema version or existing character data.
