# Native 2014 advancement

This adds a preview/apply/undo workflow for fixed-value single-class characters, including Aurora imports. Initial supported base-class tables are Paladin, Ranger, Sorcerer, Rogue and Monk, levels 1–20. Existing library-based builds retain the native Build workflow. There is no dependency on Aurora, Windows or a new `.dnd5e` file after initial import.

## Rules and choices

Built-in tables, base-class feature text and 319 spells derive from the repository's existing SRD 5.1 reference conversion. Subclass and feat names and notes are unrestricted. Extra approved numeric benefits can target existing stats. The wizard does not claim to execute every published subclass/feat, conditional attack, spell or item rule. It records those choices explicitly and leaves normal native property editing available. No commercial/private packs or real characters are committed.

The wizard requires a one-time review of the proficiencies and casting abilities that fixed imported totals cannot unambiguously reveal. Current totals are preserved. HP rolls/averages, retroactive Constitution HP, ability improvements, proficiency-based skill/save changes, spellcasting attack/DC increments, hit dice, standard class spell slots and a primary class-resource counter are supported. Existing resource damage is retained; a newly introduced class counter records the user's entered spent amount. Ranger/sorcerer standard new known spells/cantrips and one known-spell replacement are validated, with an explicit override for subclass/feat/DM-approved extra spells. Spells outside the SRD remain available through normal native editors.

Armor response is selected explicitly; the wizard does not infer equipment rules from a frozen AC. Monk movement improvements apply only in the chosen unarmored mode. Descriptive attacks remain manual, including Improved Divine Smite, Sneak Attack and Martial Arts. Multiclass progression, automatic racial scaling, exhaustive subclass automation and automatic magic-item recalculation are not implemented by this feature.

## Persistence and failure behavior

The server authenticates native sheet edit permission, computes a candidate preview without writes and fingerprints source inputs. Apply rejects a stale preview. New native properties are staged with an `advancementBundle` marker. The engine holds a bundle inactive until ONE compare-and-set update activates its ID in `creature.advancement`. This avoids partially applied levels without requiring Mongo replica-set transactions. All native property IDs and original input formulas/descriptions are retained. New spells can retain an existing spell-list parent and are individually gated by their bundle marker.

Retries recognize an activated bundle and do not apply a second level. A failure before activation removes the properties inserted by that attempt; abandoned crash remnants remain inactive and count toward the property limit until reviewed/cleaned. Undo deactivates the most recent bundle and restores its previous proficiency/subclass/spell-replacement settings. It rejects a new resource whose spent amount changed since creation. Undo preserves later edits to the original character, not a whole-sheet database rollback. Ordinary native edits remain possible; the preview is rechecked immediately before activation. Deployment currently uses one application process; in-process serialization and the creature CAS prevent duplicate level-up commits. Do not scale the service without reviewing staging/concurrency behavior.

Advancement metadata and property markers are additive optional schema fields. Archive and coherent backup/restore include them. Server-only previews expire after 15 minutes via a Mongo TTL index. They contain derived character data and must never be published or exported to public artifacts. `NATIVE_ADVANCEMENT_ENABLED=false` is the default and blocks new level-up methods; already saved progression layers still compute when disabled. An older application image that does not understand these markers is NOT a compatible application-only rollback after any character has advanced: it could activate staged layers and cannot apply casting deltas. Retain a compatible image or reverse advancement with the current application before considering older code. Do not restore an old database over newer user edits.

## Verification and rollout

Run `node --test deployment/test_advancement.mjs`. Native Meteor tests are registered in `app/server/tests.js`; browser tests exercise paladin 10→11, preview, usage preservation, reload, undo, desktop/mobile screenshots and restart/backup restoration. Enable the flag only in disposable CI/preview stacks until exact-image review and deployment gates pass. Production Hjoerden has not been changed by this implementation.

## Attribution

This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

Source: https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf. See `reference/srd51/NOTICE.md` and `CONVERSION-NOTES.md` for the existing conversion provenance. Generated tables are in `catalog.mjs`; the local authoring helper is not required by the deployed application.
