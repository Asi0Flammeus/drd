# Deploying DRD

One container, one bind-mounted directory, one reverse proxy in front. The
container listens on 5178 and is published on `127.0.0.1:4354` only — never
bind it to a public interface: the session cookie is `Secure`, and the
`{domain}/{url}` capture route is a GET with a side effect.

```
git clone git@github.com:Asi0Flammeus/drd.git && cd drd
cp .env.example .env            # set DRD_INVITE_CODE at least
mkdir -p data                   # create it yourself: Docker would create it root-owned
export DRD_UID=$(id -u) DRD_GID=$(id -g)
docker compose build
docker compose up -d
curl -s http://127.0.0.1:4354/healthz
```

If `./data` does not exist when the container starts, Docker creates the bind
source as root and the app exits with `DRD_DATA_DIR is not writable` on a
restart loop — the message names the uid it ran as, so the fix is one
`chown` or one `DRD_UID`.

Expected:

```json
{
  "status": "ok",
  "schema": 1,
  "database": "ok",
  "capture": { "browser": "ready", "executable": "/opt/puppeteer/chrome/…/chrome",
               "queued": 0, "sandbox": "enabled" },
  "client": "built",
  "uptimeSeconds": 8
}
```

`/healthz` returns **503** when the database is unreadable at the expected
schema, when no browser binary is present, or when the client was not built
into the image — which is exactly when captures would fail. The container
`HEALTHCHECK` polls it every 30 s.

## What the compose file decides, and why

| Setting | Value | Reason |
|---|---|---|
| published port | `127.0.0.1:4354:5178` | loopback only; TLS terminates in the proxy |
| data | `./data:/app/data` | SQLite file + captured media; the entire app state |
| user | `${DRD_UID:-10001}:${DRD_GID:-0}` | a bind mount keeps host ownership, so the container must run as the uid that owns `./data` |
| capabilities | drop `ALL`, add `SYS_CHROOT` | the one capability Chrome's zygote needs |
| seccomp | `docker/chrome-seccomp.json` | Docker's default profile with `CLONE_NEWUSER` unblocked |
| `no-new-privileges` | on | no escalation via `execve` |
| `/dev/shm` | tmpfs 512 MB | Chrome crashes on large pages with Docker's 64 MB default |
| limits | 2 GB memory, 512 pids | a runaway page must not take the host with it |
| migrations | run on every start | idempotent and transactional; removes the "did anyone migrate?" failure mode |

## The Chromium sandbox, measured

Chrome refuses to start without a usable sandbox, and inside a container it
has two ways to get one. Both were tested on this host (Docker 29, kernel
5.15, `kernel.unprivileged_userns_clone=1`):

| configuration | result |
|---|---|
| Docker default seccomp | `FATAL … No usable sandbox!` — the default profile masks `clone()` so `CLONE_NEWUSER` is refused |
| patched profile, no `SYS_CHROOT` | `Check failed: sys_chroot("/proc/self/fdinfo/") == 0` |
| patched profile + `SYS_CHROOT` + `no-new-privileges` | **launches, captures** — this is what the compose file ships |
| `DRD_CHROME_NO_SANDBOX=1`, default seccomp | launches, captures, but the renderer is contained only by the container |

`docker/chrome-seccomp.json` is Docker's own default profile (moby v27.3.1)
with exactly three changes: `clone()` is no longer masked against
`CLONE_NEWUSER`, `clone3()` returns normally instead of `ENOSYS`, and
`unshare`/`setns` are allowed without `CAP_SYS_ADMIN`. Everything else Docker
denies is still denied, and `CAP_SYS_ADMIN` is **not** granted.

**Fallback.** On a host that refuses unprivileged user namespaces (Ubuntu
23.10+ with the AppArmor restriction, a hardened kernel, or a nested
container), set `DRD_CHROME_NO_SANDBOX=1`. The capture pipeline then relies on
the container alone: non-root uid, all capabilities dropped, no new
privileges, default seccomp, memory and pid limits, and only `/app/data`
writable. `/healthz` reports `capture.sandbox` so you can see which mode a
running deployment is in — do not guess.

To regenerate the profile against a newer Docker:

```sh
curl -sSL -o /tmp/default.json \
  https://raw.githubusercontent.com/moby/moby/<tag>/profiles/seccomp/default.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/default.json'))
for g in d['syscalls']:
    if g.get('names') == ['clone'] and g.get('args'): g.pop('args')
    if g.get('names') == ['clone3'] and g['action'] == 'SCMP_ACT_ERRNO':
        g['action'] = 'SCMP_ACT_ALLOW'; g.pop('excludes', None); g.pop('errnoRet', None)
d['syscalls'].append({'names': ['unshare', 'setns'], 'action': 'SCMP_ACT_ALLOW'})
json.dump(d, open('docker/chrome-seccomp.json', 'w'), indent='\t')
PY
```

## The origin, and why it cannot be approximate

`DRD_PUBLIC_ORIGIN` must be the exact origin the browser sees —
`https://dnd.alysis.cat` in this deployment. It drives two things: the
`Secure` flag on the session cookie, and the Origin check on every mutating
request. A mismatch produces a login that appears to work and then silently
forgets the session.

Over plain http (a local smoke test) the Secure cookie is never sent back, so
override it for that run only:

```sh
DRD_PUBLIC_ORIGIN=http://127.0.0.1:4354 docker compose up -d
```

## Reverse proxy

Terminate TLS for `dnd.alysis.cat` and forward everything to
`127.0.0.1:4354`. The whole path space matters: `/api`, `/media`, `/app`,
`/assets`, `/manifest.webmanifest`, `/sw.js` **and** the catch-all, because
`https://dnd.alysis.cat/https://some-site.fr` is the capture shortcut.

nginx:

```nginx
server {
  server_name dnd.alysis.cat;
  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:4354;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin            $http_origin;   # the CSRF check reads it
    proxy_read_timeout 120s;                            # a capture can take a minute
  }
}
```

Do **not** normalise or collapse the path: `//` inside the splat must survive.
DRD repairs a collapsed `https:/` anyway, but a proxy that rewrites the path
before DRD sees it turns a capture into a 404.

DNS and any Cloudron App Proxy configuration are deliberately out of scope
here; this file stops at a container listening on 4354.

## Accounts

Registration is invite-capable rather than closed, so the first account can be
created without a shell:

```
DRD_REGISTRATION_OPEN=true
DRD_INVITE_CODE=<something long, from your password manager>
```

Register once, then set `DRD_REGISTRATION_OPEN=false` and
`docker compose up -d` to re-create the container. The invite code is a
doorbell, not a password: it is checked in one place and protects nothing once
an account exists.

## Operating it

```sh
docker compose logs -f --tail 100 drd      # server + capture failures
docker compose ps                          # health column comes from /healthz
docker compose restart                     # migrations re-run, WAL is intact
docker compose up -d --build                # deploy a new build
```

Back up `./data`. It is one SQLite file (WAL mode — copy `drd.sqlite`,
`-wal` and `-shm` together, or use `sqlite3 .backup`) plus a media directory
of screenshots. Nothing else in the container holds state.

After a deploy, a browser with the old service worker takes one extra reload
to pick up the new build — the standard cache-first update cycle.

## Checklist before pointing DNS at it

- [ ] `DRD_PUBLIC_ORIGIN=https://dnd.alysis.cat`
- [ ] TLS terminated by the proxy; port 4354 still loopback-only
- [ ] `DRD_INVITE_CODE` set, or `DRD_REGISTRATION_OPEN=false` after the first account
- [ ] `/healthz` returns `"status": "ok"` with the `capture.sandbox` mode you intended
- [ ] `DRD_ALLOW_PRIVATE_NETWORK` unset — see `docs/THREAT-MODEL.md`
- [ ] the capture container has no route to your private network (see the threat model's residual risk)
- [ ] `./data` backed up and not served by the proxy
