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

**In a git worktree this bites again**, because worktrees here share the primary
checkout's `node_modules` through a symlink, and the shipped `dist/iac/bin.js`
is `777` in every one of them. Make one real `755` copy and point every worktree
at it by absolute path:

```bash
cp node_modules/railway/dist/iac/bin.js node_modules/railway/dist/iac/bin-755.js
chmod 755 node_modules/railway/dist/iac/bin-755.js
```

Keep the copy inside the package's own tree. Moved elsewhere it resolves its
`graphql` import against the wrong `node_modules` and fails differently.

`--file` takes an absolute path too, so a linked directory can plan a
`railway.ts` that lives in another worktree — which is the usual case here,
since `railway link` records a directory and a worktree does not inherit one:

```bash
railway config plan \
  --runner /abs/path/node_modules/railway/dist/iac/bin-755.js \
  --file   /abs/path/to/worktree/.railway/railway.ts
```

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
- **A `build` block cannot be cleared, only overwritten.** Same failure, other
  direction. Moving a service from a Dockerfile build to `source: image(...)`
  leaves `build.builder` and `build.dockerfilePath` stored; omitting them asks
  for their removal, which `apply` reports as applied and does not perform. So
  every app service here still declares its `build` block even though an image
  deploy never runs one. Declaring what is stored is what keeps the drift gate
  usable; omitting it costs five phantom changes on every `plan`.

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

`.railway/railway.ts` describes five app services and the bucket. All five run
**one image, pinned by digest** (`APP_IMAGE`), published by the repository's
Docker workflow and pulled anonymously from a public package, so no registry
credential has to exist in a file that cannot express one. That is what makes
§10.8's deploy gate mean something: the migrator and the serving tier are the
same bytes by construction, where five independent source builds could only be
the same by coincidence. Rolling forward is editing that one line; rolling back
is editing it in reverse.

What separates the services is **which connections they hold**:

| Service                            | `QUACKBACK_ROLE`                | Connections                                                                                 | Sleeps                              |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `quackback`                        | `web`                           | workspace **pooled** endpoints, evicted after 45 s idle                                     | no — the pooled tier is always warm |
| `quackback-worker`                 | `worker`                        | workspace **direct** (session-mode) endpoints, one always-attached relay loop per workspace | no                                  |
| `quackback-cron-daily` / `-hourly` | `worker` + `QUACKBACK_CRON_JOB` | whatever the sweep touches, for the length of the run                                       | n/a — it exits                      |
| `quackback-migrator`               | `migrator`, one-shot            | the **direct** endpoint of each workspace it claims                                         | n/a — it exits                      |

(There was a sixth, `quackback-web-sleeper` — a `role=web` service with sleep
enabled, kept to answer §13's open question 6 against a real deployment. It
answered it (yes, in seven seconds, no registry credential), carried no
traffic, and was deleted on 2026-08-14.)

`DATABASE_URL` is deliberately absent from every one of them: pooled mode
refuses to boot with a fleet-wide DSN. The control-plane registry is the
Railway Postgres database `quackback_cp` and arrives as
`QUACKBACK_CONTROL_DATABASE_URL`.

Published images: `bun .railway/list-ghcr.ts`. Pin `APP_IMAGE` in
`railway.ts` to a digest from that list, never a moving tag.

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
  `.railway/railway.ts` is a _deletion_: with the per-workspace buckets omitted,
  `plan` proposed `Delete bucket qb-neon-t1 / qb-neon-t2 / qb-neon-t4` — every
  workspace's stored objects. So resources the control plane creates through the
  API must still be enumerated in this file, or `apply` must never be run.
  (Those buckets were in the end deleted by hand on 2026-08-14: no registry row
  named any of them and their contents were provisioning probes, not workspace
  data. The rule stands for anything the control plane creates in future.)

### `preserve()` cannot bootstrap a new service

`preserve()` means "keep the value the platform already holds", so on a service
that does not exist yet it holds nothing and the variable is simply absent.
`quackback-migrator` was created this way and came up with only its literal
variables: no `QUACKBACK_CONTROL_DATABASE_URL`, no `SECRET_KEY`, no
`QUACKBACK_FLEET_ROOT_KEY`. `apply` reported success, because from its side
nothing failed.

So creating a service whose secrets are preserved is two steps, and the file
only describes the second:

```bash
railway variables --service <new-service> --skip-deploys --set 'KEY=value' ...
railway config plan     # now clean, because the values exist to be preserved
```

`--skip-deploys` matters when setting several at once: without it each `--set`
can trigger its own deployment.

### Cron services

`deploy.cronSchedule` runs a service and waits for it to exit, so the cron
services set `QUACKBACK_CRON_JOB` and `startup.ts` runs that job and exits with
its status. `restartPolicyType: NEVER` is declared on them (Railway stores it
for cron services, and it is right: a failed sweep should wait for the next slot
rather than restart-loop against a fleet of workspace databases) and
`restartPolicyMaxRetries` is **not** — it means nothing under NEVER and
declaring it showed as permanent plan drift.

`quackback-migrator` is the same shape with `startCommand` overriding the image
entrypoint, because that role is a command rather than a server. Its schedule is
a convergence pass, not the trigger: a run only touches a workspace recorded
below its target version, and the target only moves when an operator moves it.

### Reading a cron service's logs, and three things that make it look impossible

Cron logs are perfectly readable. Getting to them took three wrong turns, all of
which produce the same empty output:

1. **`railway logs` streams by default** and prints nothing for a service that is
   not currently running — which a cron service almost never is. Pass `--lines`
   (or `--since`) to fetch history instead.
2. **`railway logs` defaults to the most recent successful deployment**, and a
   deployment created after the last scheduled run has no logs of its own. Every
   service looks silent for a while after any `apply`.
3. **The `environmentLogs` GraphQL query ignores `afterDate`** and returns the
   OLDEST entries up to `afterLimit`, so a small limit shows you last week and
   nothing else. Raise the limit and read the tail:

```bash
railway api 'query($eid: String!, $filter: String) {
  environmentLogs(environmentId: $eid, afterLimit: 5000, filter: $filter) {
    timestamp message } }' \
  --variables '{"eid":"<env-id>","filter":"@service:<service-id>"}'
```

**Scheduled runs lag their slot by three to four minutes.** Measured twice: a
`24 * * * *` slot started at `:27:13`, a `41 * * * *` slot at `:44:59`. Checking
a minute after the slot reads as a failure when nothing has failed.

**A redeploy does not run a cron service.** Six redeploys of
`quackback-migrator` produced six `Stopping Container` lines and no run; only the
scheduled slot produced `Starting Container`. This matters for the release
pipeline: deploying a digest to the migrator service is not a way to trigger it.

**Changing the schedule or deploying appears to cost the next slot.**
`quackback-cron-hourly` was deployed at `20:43` and did not run at `21:23`; given
a fresh schedule it ran normally. Worth knowing before reading a missed sweep as
a fault.

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- Services already managed by `railway.json` must be migrated before `.railway/railway.ts` can manage them.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.
