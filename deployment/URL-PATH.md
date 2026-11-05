# URL prefix contract

Phase 2 starts from merged runtime revision `f49470d2ba180f44f881c62806f2094599cc419e`.
The unchanged root workflow passed on that revision (CI run 42064388692 and the
feature-branch baseline run 42064900719). The initial source audit found root-only
Vue history, `/sw.js`, root assets/print CSS, an upstream-host invitation/print link
and a root-only cross-instance import expression. These are the implementation
baseline, not evidence that the old image supported a prefix.

## One authoritative setting

Set `ROOT_URL` to an absolute HTTP(S) origin and optional plain path. Examples:

- `http://127.0.0.1:31080/` for private root mode.
- `https://example.invalid/dnd/` for a shared hostname.

A missing final slash is normalized. Credentials, queries, fragments, escaped
separators, repeated slashes and dot segments in deployment paths are rejected
before the server starts. Prefix segments use ASCII URL-safe characters. Encoded
character names and query/fragment values within application links are preserved.
Use ROOT_URL for the public address, not the container's internal address. Separate
DDP URL overrides are outside this configuration contract.

Meteor publishes that setting to the browser, prefixes generated bundle/file and
account URLs, scopes login storage keys, and strips the prefix before its own
HTTP/REST handlers. Vue history uses the same base. Vue route paths and router
links remain application-relative; raw browser asset URLs use `appPath`. Intentional
external HTTP(S), protocol-relative and mail links remain external.

The server adds an HTML base and adjusts authored root asset references. Static
manifest icons and start/scope values are relative to the manifest. Print assets,
QR/share URLs, invitations and native cross-instance character imports use the
configured instance. Reset/enrollment/verification email HTML is tested through
a fake transport; no real mail is sent by the tests.

The service worker is registered only within the application's base. It caches
only public static assets in an instance-specific cache, never character HTML,
API data, sockets or uploaded files, and deletes only its own outdated cache keys.
There is no offline character-editing guarantee.

## Proxy boundary

Preserve `/dnd/` when proxying: Meteor performs its own internal stripping. Do not
add hostname-root `/api`, `/sockjs`, `/websocket`, `/cdn`, `/sw.js` or asset routes.
Redirect bare `/dnd` to `/dnd/`, retaining its query. The production snippet is:

```caddy
@dicecloudBare path /dnd
handle @dicecloudBare {
    uri path_regexp ^/dnd$ /dnd/
    redir {uri} 308
}
handle /dnd/* {
    reverse_proxy dicecloud-web:3000
}
```

Insert these before the existing fallback handler. Keep the homepage and unrelated
service blocks unchanged. DNS changes and homepage service links are unnecessary.
Validate the full staged Caddy file before reload and retain its previous checksum
and contents for rollback.

`deployment/compose.proxy.yml` and `Caddyfile.test` supply a disposable loopback
HTTPS proxy, private internal CA and unrelated-root sentinel. Browser tests ignore
that disposable certificate only; production uses the existing trusted HTTPS
configuration. The same image is tested at root and behind this proxy, including
request boundaries, WSS reconnect, storage scope, deep links, print, files,
anonymous private-data denial and restart/recovery. The container health check uses
the configured prefix even though it talks to its own loopback HTTP listener.

## Release and recovery

Build and review this phase against the fork's merged develop. Merge the verified
URL branch before public activation. Retain the exact image, a consistent backup,
private environment and staged proxy rollback. Use a fresh production database,
not synthetic test users. Keep registration disabled.

For one-time account provisioning, privately mount a JSON input with `username`
and `email`, set `DICECLOUD_BOOTSTRAP_ACCOUNT_FILE` to that mount and
`DICECLOUD_BOOTSTRAP_RESULT_FILE` to a private writable result path. Startup creates
an account without a password and writes a one-time enrollment URL with mode 0600;
it sends no email, exposes no provisioning method and never resets an existing
account. Remove the temporary mount and variables after provisioning. Treat the
result as a credential and let its owner choose a password. Never commit or log it.

After activation verify the public prefixed matrix, private-data denial, persistent
login/characters, and the homepage/unrelated route baselines. Record deployment
image/configuration provenance and service inventory privately. Restore data into
a fresh private stack before any rollback that changes schema; image/proxy rollback
alone is appropriate only when the data remains compatible.
