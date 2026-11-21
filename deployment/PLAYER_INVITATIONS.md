# Private player invitations

Keep `ALLOW_REGISTRATION=false`. Set `PLAYER_INVITATION_MANAGERS` to a JSON array of existing Meteor user IDs in the private deployment environment, for example `["an-existing-user-id"]`. Use immutable IDs rather than usernames, so renaming an account cannot transfer invitation permission. Never grant this permission from a client request. If a private Compose override supplies its own `METEOR_SETTINGS`, preserve its other settings and add the same `private.playerInvitationManagers` array there.

The authorised account sees **Settings → Players → Invite player**. Enter a username and email, create the invitation, then copy the private link and send it yourself. No email is automatically sent. The recipient chooses a password, creates their account and signs in. They do not acquire invitation privileges or automatically gain access to characters or campaigns.

Links expire after seven days. Replace link invalidates the previous copy. Revoke prevents an unused link being accepted. No account exists until acceptance. Existing usernames/emails are rejected; this flow never resets an existing account's password.

The server stores only a hash of each invitation token. Owner-only list responses omit both hashes and tokens. An atomic pending-to-claiming transition prevents concurrent acceptance/revocation from creating multiple accounts. A failed identity/password validation reopens only that claim; once native account creation succeeds it is never reopened. A server/database interruption after account creation may leave a claim marked as processing; do not reopen it automatically or reset the newly created account. Investigate the existing username/email privately.

Mongo backups include `playerInvitations` and accepted accounts. Invitation-manager IDs are private deployment configuration and must also be retained/restored. CI configures only its synthetic fixture owner, exercises the flow with public registration closed, and verifies the pending link and accepted account after backup/restore.

Passwords follow native Meteor Accounts hashing: the browser submits its standard SHA-256 digest, and native server account creation stores the normal salted password hash. Raw passwords and invitation tokens must not be logged. Share links only with the intended recipient.
