/**
 * `QUACKBACK_ROLE=migrator` — the fleet migration reconciler, as a command.
 *
 * ```
 * QUACKBACK_ROLE=migrator QUACKBACK_TENANCY=pooled \
 *   QUACKBACK_CONTROL_DATABASE_URL=... bun run scripts/fleet-migrator.ts run
 * ```
 *
 * A command rather than a daemon, because that is what the platform wants: it
 * fits `deploy.cronSchedule` (Railway runs a service on a schedule and lets it
 * exit), it is what a release pipeline invokes after a deploy, and it is what
 * provisioning calls for one workspace. §10.3's *"one code path, two triggers"* is
 * literally this file with and without `--workspace`.
 *
 * Exit codes are the contract, because a scheduled service is judged on them:
 *   0  every claimed workspace reconciled (or was already current)
 *   1  at least one workspace failed — the rollout should halt and be read
 *   2  the invocation itself was wrong (bad argument, no control database)
 */
import {
  latestBundledVersion,
  tagForVersion,
  BUNDLED_MIGRATIONS,
} from '@quackback/db/schema-version'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  enrolActiveWorkspaces,
  planWorkspace,
  requireWorkspace,
  runReconcilePass,
} from '@/lib/server/fleet/migrator'
import {
  blockWorkspace,
  explainUnclaimed,
  listSchemaState,
  setTargetVersion,
} from '@/lib/server/fleet/schema-state'
import { closeControlSql } from '@/lib/server/workspaces/registry'

type Command = 'run' | 'status' | 'enrol' | 'set-target' | 'block' | 'plan'

const USAGE = `fleet-migrator <command> [options]

  run          Claim workspaces behind their target and reconcile them.
  plan         Report, per workspace, what a run WOULD apply. Touches no schema.
  status       Print cp_workspace_schema_state.
  enrol        Create intent rows for active workspaces that have none.
  set-target   Write the intent version for a cohort or a workspace list.
  block        Take a workspace out of claiming, with a reason.

Options:
  --workspace <id>         one workspace only
  --cohort <name>       restrict to a rollout cohort
  --concurrency <n>     workspaces claimed per batch (default 4)
  --lease-ms <n>        lease duration (default 900000)
  --max-workspaces <n>     stop after this many claims
  --target <spec>       version for set-target; a tag, its 0NNN prefix, or millis
  --reason <text>       required by block
  --allow-mutating-replay
                        proceed even when the replay set contains a migration
                        that would change data on a second run. Only correct
                        once the ledger is known honest for that workspace.
`

function parseArgs(argv: string[]): { command: Command; opts: Record<string, string | true> } {
  const [command, ...rest] = argv
  const known = new Set([
    '--workspace',
    '--cohort',
    '--concurrency',
    '--lease-ms',
    '--max-workspaces',
    '--target',
    '--reason',
  ])
  const flags = new Set(['--allow-mutating-replay', '--json'])
  const opts: Record<string, string | true> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (flags.has(token)) {
      opts[token.slice(2)] = true
      continue
    }
    if (!known.has(token)) {
      throw new Error(`unknown argument ${token}`)
    }
    const value = rest[i + 1]
    // A `--`-prefixed token can never be a value. An unset shell variable
    // collapses `--target $V --cohort x` into `--target --cohort x`, and
    // accepting `--cohort` as the target is how a rollout silently retargets.
    if (value === undefined || value.startsWith('--')) {
      throw new Error(
        `${token} needs a value, but the next argument is ${value === undefined ? 'absent' : `'${value}'`}. ` +
          'If a shell variable is empty, this is where it went.'
      )
    }
    opts[token.slice(2)] = value
    i++
  }
  if (!command || !['run', 'status', 'enrol', 'set-target', 'block', 'plan'].includes(command)) {
    throw new Error(`unknown command ${command ?? '(none)'}`)
  }
  return { command: command as Command, opts }
}

function num(opts: Record<string, string | true>, key: string, fallback: number): number {
  const raw = opts[key]
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${key} must be a positive number`)
  return n
}

function workerId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
}

async function main(): Promise<number> {
  const { command, opts } = parseArgs(process.argv.slice(2))
  if (!process.env.QUACKBACK_CONTROL_DATABASE_URL) {
    throw new Error('QUACKBACK_CONTROL_DATABASE_URL is not set (no control database)')
  }
  const target = latestBundledVersion()

  if (command === 'status') {
    const rows = await listSchemaState(opts.cohort as string | undefined)
    console.log(
      `bundle: ${BUNDLED_MIGRATIONS.length} migrations, newest ${tagForVersion(target)} (${target})`
    )
    for (const r of rows) {
      const behind = r.currentVersion === null || r.currentVersion < r.targetVersion
      console.log(
        [
          r.workspaceKey.padEnd(26),
          r.status.padEnd(10),
          `cohort=${r.cohort}`,
          `target=${tagForVersion(r.targetVersion)}`,
          `current=${r.currentVersion === null ? 'never' : tagForVersion(r.currentVersion)}`,
          `applied=${r.appliedCount ?? '-'}`,
          `post=${r.postconditionsOk === null ? '-' : r.postconditionsOk}`,
          `attempts=${r.attempts}/${r.maxAttempts}`,
          behind ? 'BEHIND' : 'ok',
          r.lastError ? `\n    last_error: ${r.lastError}` : '',
        ].join(' ')
      )
    }
    return 0
  }

  if (command === 'enrol') {
    const created = await enrolActiveWorkspaces((opts.cohort as string) ?? 'default')
    console.log(`enrolled ${created} workspace(s) at ${tagForVersion(target)}`)
    return 0
  }

  if (command === 'set-target') {
    const spec = opts.target as string | undefined
    const version = spec ? resolveTargetSpec(spec) : target
    const updated = await setTargetVersion({
      targetVersion: version,
      workspaceKeys: opts.workspace ? [opts.workspace as string] : undefined,
      cohort: opts.cohort as string | undefined,
    })
    console.log(`set target ${tagForVersion(version)} on ${updated} workspace(s)`)
    return 0
  }

  if (command === 'block') {
    const workspace = opts.workspace as string | undefined
    const reason = opts.reason as string | undefined
    if (!workspace || !reason) throw new Error('block needs --workspace and --reason')
    const ok = await blockWorkspace(workspace, reason)
    console.log(ok ? `blocked ${workspace}` : `${workspace} is running; not blocked`)
    return ok ? 0 : 1
  }

  if (command === 'plan') {
    // Deliberately reuses the run's own preflight rather than recomputing it: a
    // plan that disagrees with the run is worse than no plan.
    const workspaceKey = opts.workspace as string | undefined
    if (!workspaceKey) throw new Error('plan needs --workspace')
    const { applied, gap, replaySet, verdicts, refusal } = await planWorkspace(
      await requireWorkspace(workspaceKey)
    )
    console.log(
      `${workspaceKey}: ledger ${applied.count} rows, newest ` +
        `${applied.max === 0 ? 'none' : tagForVersion(applied.max)}`
    )
    if (gap) {
      // Printed above the replay set and not folded into it, because the two are
      // different facts: one is "this database is behind", the other is "this
      // database is wrong". A gapped ledger reads as nearly current by its
      // high-water mark, which is precisely when it is least current.
      console.log(
        `  LEDGER GAP: ${gap.missing.length} migration(s) at or below the high-water mark are ` +
          `absent: ${gap.missing.join(', ')}`
      )
      console.log(
        `  would truncate from ${tagForVersion(gap.from)}, rewriting ` +
          `${gap.rewrites.length} row(s): ${gap.rewrites.join(', ') || '(none)'}`
      )
      if (gap.unrewritable.length > 0) {
        console.log(
          `  ${gap.unrewritable.length} row(s) this build does not bundle would be discarded ` +
            `unrecoverably: ${gap.unrewritable.join(', ')}`
        )
      }
    }
    console.log(`  would apply ${replaySet.length}: ${replaySet.join(', ') || '(nothing)'}`)
    for (const r of verdicts) {
      console.log(
        `    ${r.tag}: replay=${r.verdict} (${r.statementCount} statements, ` +
          `${r.mutating.length} mutating, ${r.erroring.length} erroring)`
      )
      for (const m of r.mutating) console.log(`        MUTATES L${m.line}: ${m.excerpt}`)
    }
    if (refusal) console.log(`  WOULD REFUSE: ${refusal}`)
    return 0
  }

  // run
  if (opts.workspace && !opts.cohort) {
    // Single-workspace mode still goes through the lease, so a provisioning call
    // and a rollout cannot both be migrating one workspace at once.
    const result = await runReconcilePass({
      workerId: workerId(),
      workspaceKey: opts.workspace as string,
      concurrency: 1,
      maxWorkspaces: 1,
      leaseMs: num(opts, 'lease-ms', 900_000),
      allowMutatingReplay: opts['allow-mutating-replay'] === true,
    })
    printPass(result)
    if (result.claimed === 0) {
      // `claimed=0` on a NAMED workspace is not a success. Provisioning calls this
      // to migrate one workspace now; reporting nothing and exiting 0 is how that
      // becomes a silent no-op that looks like it worked.
      const why = await explainUnclaimed(opts.workspace as string)
      console.log(`  NOT CLAIMED [${why.kind}] ${why.detail}`)
      if (why.kind !== 'already_current') return 1

      // `already_current` is a belief about the control row, and the control row
      // is only as good as the reconcile that wrote it. A workspace whose ledger
      // has a hole was recorded at the target by a run that healed nothing, and
      // the claim narrows on `current_version < target_version` — so it can
      // never be claimed again and the reason it is broken is exactly the reason
      // nothing will look at it. Read the workspace's own ledger before agreeing.
      const { gap } = await planWorkspace(await requireWorkspace(opts.workspace as string))
      if (!gap) return 0
      console.log(
        `  LEDGER GAP: this workspace is recorded at its target but its ledger is missing ` +
          `${gap.missing.length} migration(s) below its own high-water mark: ` +
          `${gap.missing.join(', ')}. It cannot be claimed while current_version meets ` +
          `target_version, so healing it needs the observation cleared first — see ` +
          'FLEET-MIGRATIONS.md §10.'
      )
      return 1
    }
    return result.failed > 0 ? 1 : 0
  }

  const result = await runReconcilePass({
    workerId: workerId(),
    cohort: opts.cohort as string | undefined,
    concurrency: num(opts, 'concurrency', 4),
    leaseMs: num(opts, 'lease-ms', 900_000),
    maxWorkspaces: opts['max-workspaces'] ? num(opts, 'max-workspaces', 0) : undefined,
    allowMutatingReplay: opts['allow-mutating-replay'] === true,
  })
  printPass(result)
  return result.failed > 0 ? 1 : 0
}

function resolveTargetSpec(spec: string): number {
  const match = BUNDLED_MIGRATIONS.find(
    (e) => e.tag === spec || e.tag.startsWith(`${spec}_`) || String(e.when) === spec
  )
  if (!match) throw new Error(`--target ${spec} names no bundled migration`)
  return match.when
}

function printPass(result: Awaited<ReturnType<typeof runReconcilePass>>): void {
  console.log(
    `claimed=${result.claimed} reconciled=${result.reconciled} ` +
      `gaps_healed=${result.healed} ` +
      `already_current=${result.alreadyCurrent} failed=${result.failed} ` +
      `refused_records=${result.refusedRecords} ` +
      `reaped(requeued=${result.reaped.requeued} terminated=${result.reaped.terminated})`
  )
  for (const o of result.outcomes) {
    console.log(
      `  ${o.workspaceKey.padEnd(26)} ${o.ok ? 'OK ' : 'ERR'} [${o.code}] ` +
        `ledger ${o.before.count}->${o.after?.count ?? '-'} ` +
        `applied=${o.replaySet.length} healed=${o.healedIndexes.length} ` +
        `post=${o.postconditions ? o.postconditions.ok : '-'} ${o.durationMs}ms`
    )
    if (o.gap) {
      console.log(
        `      LEDGER GAP ${o.gap.missing.length}: ${o.gap.missing.join(', ')} ` +
          `(replayed from ${tagForVersion(o.gap.from)})`
      )
    }
    if (!o.ok) console.log(`      ${o.detail}`)
    for (const v of o.postconditions?.violations ?? []) console.log(`      VIOLATION ${v.detail}`)
  }
}

main()
  .then(async (code) => {
    await closeControlSql()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err))
    if (
      err instanceof Error &&
      /unknown (argument|command)|needs a value|needs --|no control database/.test(err.message)
    ) {
      console.error(`\n${USAGE}`)
      await closeControlSql()
      process.exit(2)
    }
    await closeControlSql()
    process.exit(1)
  })
