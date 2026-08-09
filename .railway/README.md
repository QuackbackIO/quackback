# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project you want: services, databases, buckets, custom domains, replicas, groups, and environment variables.

## Common commands

Create the configuration files:

```bash
railway config init
```

Import an existing Railway project into code:

```bash
railway config pull
```

Preview what Railway would change:

```bash
railway config plan
```

Apply the planned changes:

```bash
railway config apply
```

## Before your first `plan`: the runner trap

`railway config plan` (and `pull`, and `apply`) do not read `.railway/railway.ts`
themselves. They shell out to a helper, `railway-iac-ts`, which ships inside the
`railway` npm package — so the package has to be installed:

```bash
bun add -D railway
```

Installing it is necessary but **not sufficient**, and the failure that follows
is actively misleading:

```txt
Could not find Railway configuration support for this project.
Install the Railway TypeScript SDK, then run this command again: ...

Caused by:
    No such file or directory (os error 2)
```

The package _is_ installed. What happens is that the CLI walks a list of
candidate paths and silently discards any that fail its safety checks, then
falls through to a bare `railway-iac-ts` on `PATH`, which genuinely does not
exist — hence the ENOENT. Two things get a candidate discarded here:

1. **A candidate that is group- or world-writable is rejected** — `775` is
   refused just as `777` is. The published tarball ships `dist/iac/bin.js` at
   `777`, so a clean install lands in the rejected state on its own; this is not
   something a package manager did locally.
2. **`node_modules/.bin/railway-iac-ts` is a symlink**, and a symlink's own mode
   on Linux is always `lrwxrwxrwx`. The check does not follow the link, so it
   sees `777` and rejects it no matter what the target is set to.

The second cause is the operative one, and it makes `chmod` a dead end. Tested
four ways: symlink at `777` fails, symlink whose target is `755` fails, symlink
with the whole directory chain at `755` fails, and only replacing the symlink
with a real `755` file succeeds. Since package managers that link binaries will
recreate the symlink on every install, do not try to fix this with permissions.

Point the CLI straight at the real file instead. An **absolute** path is
required; a relative one reproduces the same ENOENT:

```bash
export RAILWAY_IAC_TS_BIN="$PWD/node_modules/railway/dist/iac/bin.js"
railway config plan
```

`railway config plan --runner /abs/path/to/bin.js` works identically if you
prefer a flag to an environment variable.

One further prerequisite, which this repo already satisfies: the runner
`import()`s its own entry point with a query string appended, and Node refuses
that for a `.cjs` file, so in a project without `"type": "module"` you clear the
trap above only to land on:

```txt
Cannot find module '.../dist/iac/index.cjs?namespace=...'
```

Adding `"type": "module"` to the nearest `package.json` resolves it immediately.

Two smaller traps in the same area:

- **`railway config pull` fails the same way when `.railway/railway.ts` does not
  exist yet**, even though importing an existing project is the command's whole
  purpose. Run `railway config init` first, then `pull --force`.
- **Never declare a value that is already the platform default.** The API
  accepts the write and returns success, but does not store it, so every
  subsequent `plan` reports the same phantom change and
  `--detailed-exit-code` never reaches `0`. `deploy.restartPolicyType`
  (`ON_FAILURE`) is the one that bites; `deploy.restartPolicyMaxRetries` is
  safe to declare because its default is `10`.

To check for drift in CI, use `railway config plan --detailed-exit-code`: `0`
means clean, `2` means changes are pending, anything else is an error.

## What the drift gate does not cover: `replicas`

**A clean `plan` does not mean the service is placed where this file says.**
`replicas` is read from `.railway/railway.ts` and then ignored: `plan` never
reports a difference on it and `apply` never writes it.

Verified with a paired control on one file. Declaring `europe-west4` against a
service stored in `us-east4-eqdc4a` still reports "already up to date" and exits
`0`; changing `healthcheckTimeout` in the same file exits `2` and lists only the
healthcheck. The gate works — it cannot see placement.

This matters more than it sounds. Placement is not sticky, because
`multiRegionConfig` is **merged rather than replaced**: writing one region adds
it alongside whatever is already stored. A service can therefore drift to two
regions, or back to the platform default, and the only symptom is a deploy that
fails with `Your plan can only deploy to a single region` — or, worse, one that
succeeds on the wrong continent. Every query in a server-rendered page pays that
distance.

So treat placement as unmanaged and check it directly, especially before and
after any deploy:

```bash
railway environment config --json | jq '.services[].deploy.multiRegionConfig'
```

To change it, name every region explicitly and set the ones you do not want to
`null` — otherwise the merge leaves them in place:

```bash
railway api 'mutation($eid: String!, $sid: String!, $in: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(environmentId: $eid, serviceId: $sid, input: $in)
}' --variables '{"eid":"<env-id>","sid":"<service-id>",
  "in":{"multiRegionConfig":{"<region-to-drop>":null,"us-east4-eqdc4a":{"numReplicas":1}}}}'
```

`railway service scale <alias>=<n>` is the friendlier route but it merges the
same way, and its aliases (`us-east`, `us-west`, `eu-west`, `southeast-asia`) do
not accept the region ids that appear in the stored config, so it cannot always
express the removal. The `replicas` declaration is kept in `.railway/railway.ts`
as a record of intent, not as something enforced.

## The fleet shape

`.railway/railway.ts` describes five app services built from one image, plus
the buckets. What separates them is **which connections they hold**:

| Service                            | `QUACKBACK_ROLE`                | Connections                                                                              | Sleeps                              |
| ---------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| `quackback`                        | `web`                           | tenant **pooled** endpoints, evicted after 45 s idle                                     | no — the pooled tier is always warm |
| `quackback-worker`                 | `worker`                        | tenant **direct** (session-mode) endpoints, one always-attached relay loop per tenant     | no                                  |
| `quackback-cron-daily` / `-hourly` | `worker` + `QUACKBACK_CRON_JOB` | whatever the sweep touches, for the length of the run                                    | n/a — it exits                      |
| `quackback-web-sleeper`            | `web`                           | same as `quackback`                                                                      | **yes** (`deploy.sleepApplication`) |

`DATABASE_URL` is deliberately absent from every one of them: pooled mode
refuses to boot with a fleet-wide DSN. The control-plane registry lives in its
own Neon project and arrives as `QUACKBACK_CONTROL_DATABASE_URL`.

### Two more things `plan` cannot see

The `replicas` warning below is not the only gap.

- **`postgres(name, { region })` is not applied either.** A Railway Postgres
  declared for `us-east4-eqdc4a` was created in `sfo`, service _and_ volume. A
  volume's region is fixed at creation, so repointing the service leaves the
  volume behind and the deployment cannot schedule; and `volumeDelete` returns
  `true` while **soft-deleting with a two-day window**, during which
  `volumeCreate` refuses ("a service can only have one volume"). There is no
  path from a mis-placed database service to a correctly placed one inside two
  days. That is why the control-plane database here is Neon rather than the
  Railway Postgres §9 recommends.
- **IaC cannot express "skeleton only".** Anything absent from
  `.railway/railway.ts` is a _deletion_: with the per-tenant buckets omitted,
  `plan` proposed `Delete bucket qb-neon-t1 / qb-neon-t2 / qb-neon-t4` — every
  tenant's stored objects. So resources the control plane creates through the
  API must still be enumerated in this file, or `apply` must never be run.

### Cron services

`deploy.cronSchedule` runs a service and waits for it to exit, so the cron
services set `QUACKBACK_CRON_JOB` and `startup.ts` runs that job and exits with
its status. `restartPolicyType: NEVER` is declared on them (Railway stores it
for cron services, and it is right: a failed sweep should wait for the next slot
rather than restart-loop against a fleet of tenant databases) and
`restartPolicyMaxRetries` is **not** — it means nothing under NEVER and
declaring it showed as permanent plan drift.

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- Services already managed by `railway.json` must be migrated before `.railway/railway.ts` can manage them.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.
