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

1. **A candidate that is group- or world-writable is rejected.** Package
   managers do not all install with the same mode, so the helper can land at
   `777` and be thrown away without comment.
2. **`node_modules/.bin/railway-iac-ts` is a symlink**, and a symlink's own mode
   on Linux is always `lrwxrwxrwx`. If the check does not follow the link it
   sees `777` and rejects it, so `chmod` on the real file changes nothing.

Point the CLI straight at the real file instead. An **absolute** path is
required; a relative one reproduces the same ENOENT:

```bash
export RAILWAY_IAC_TS_BIN="$PWD/node_modules/railway/dist/iac/bin.js"
railway config plan
```

`railway config plan --runner /abs/path/to/bin.js` works identically if you
prefer a flag to an environment variable.

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

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- Services already managed by `railway.json` must be migrated before `.railway/railway.ts` can manage them.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.
