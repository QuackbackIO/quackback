/**
 * Suite configuration: CLI flags, with environment variables as fallback.
 *
 * The contract is "two hostnames in, verdict out" — everything else is optional
 * and unlocks additional probe families. Anything a probe needs but did not get
 * is reported as `BLOCKED`, never skipped.
 */

import type { ProbeConfig } from './types'

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/** Thrown for a usage error; the CLI prints the message and the usage block. */
export class ConfigError extends Error {}

const USAGE = `
quackback workspace-isolation probe

  bun apps/web/workspace-probe/cli.ts --alpha <url> --bravo <url> [options]

Required
  --alpha <url>              Base URL of the alpha workspace (e.g. http://alpha.localhost:3000)
  --bravo <url>              Base URL of the bravo workspace

Credentials (each unlocks probe families; missing ones produce BLOCKED, not skips)
  --alpha-db <pg url>        Direct Postgres URL for alpha            (env ALPHA_DATABASE_URL)
  --bravo-db <pg url>        Direct Postgres URL for bravo            (env BRAVO_DATABASE_URL)
  --alpha-api-key <qb_...>   REST API key for alpha                   (env ALPHA_API_KEY)
  --bravo-api-key <qb_...>   REST API key for bravo                   (env BRAVO_API_KEY)
  --alpha-storage-secret <s> S3/R2 secret access key for alpha        (env ALPHA_S3_SECRET_ACCESS_KEY)
  --bravo-storage-secret <s> S3/R2 secret access key for bravo        (env BRAVO_S3_SECRET_ACCESS_KEY)
  --alpha-workspace-key <id>     Control-plane workspace id for alpha        (env ALPHA_WORKSPACE_ID)
  --bravo-workspace-key <id>     Control-plane workspace id for bravo        (env BRAVO_WORKSPACE_ID)
                             Required only under pooled tenancy, where the storage read
                             capability is bound to the workspace as well as to the object key.
                             Omit on a single-workspace deployment.
  --alpha-widget-secret <s>  Widget signing secret for alpha          (env ALPHA_WIDGET_SECRET)
  --bravo-widget-secret <s>  Widget signing secret for bravo          (env BRAVO_WIDGET_SECRET)
                             (both widget secrets are read from the database automatically
                              when --alpha-db / --bravo-db are supplied)

Fixture identity (must be IDENTICAL for both workspaces — the collision is the point)
  --admin-email <email>      Default: admin@example.com               (env PROBE_ADMIN_EMAIL)
  --admin-password <pw>      Default: password                        (env PROBE_ADMIN_PASSWORD)

Planted identity (must DIFFER per workspace — the suite judges workspace identity on these)
  --alpha-identity-token <s> Token planted in alpha's settings        (env ALPHA_IDENTITY_TOKEN)
  --bravo-identity-token <s> Token planted in bravo's settings        (env BRAVO_IDENTITY_TOKEN)
                             Defaults: the suite-owned qbprobeidentityalpha / qbprobeidentitybravo.
                             Plant the token into a settings-derived field a public surface renders
                             (the workspace name, or the portal welcome-card headline), then run.
                             Pass these flags only when a custom token was planted instead.

Output and behaviour
  --json-out <path>          Write the JSON report to a file instead of stdout
  --only <id,id>             Run only these probe ids (e.g. P01,P08)
  --allow-blocked            Exit 0 when the only non-PASS verdicts are BLOCKED
  --timeout-ms <n>           Per-request timeout (default ${DEFAULT_REQUEST_TIMEOUT_MS})
  --teardown                 Remove the probe fixtures from both workspaces and exit
  --help                     This text
`.trim()

export function usage(): string {
  return USAGE
}

function normalizeBaseUrl(raw: string, flag: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ConfigError(`${flag} is not a valid absolute URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${flag} must be http or https, got ${parsed.protocol}`)
  }
  return parsed.origin
}

/**
 * Parse argv into a resolved config.
 *
 * `env` is injected so the parser stays pure and testable.
 */
export function parseConfig(argv: string[], env: Record<string, string | undefined>): ProbeConfig {
  const flags = new Map<string, string>()
  const bare = new Set<string>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      throw new ConfigError(`unexpected argument: ${arg}`)
    }
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1))
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      bare.add(name)
      continue
    }
    flags.set(name, next)
    i++
  }

  const unknown = [...flags.keys(), ...bare].filter((k) => !KNOWN_FLAGS.has(k))
  if (unknown.length > 0) {
    throw new ConfigError(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`)
  }

  const alphaRaw = flags.get('alpha') ?? env.ALPHA_BASE_URL
  const bravoRaw = flags.get('bravo') ?? env.BRAVO_BASE_URL
  if (!alphaRaw) throw new ConfigError('--alpha is required (or set ALPHA_BASE_URL)')
  if (!bravoRaw) throw new ConfigError('--bravo is required (or set BRAVO_BASE_URL)')

  const alphaUrl = normalizeBaseUrl(alphaRaw, '--alpha')
  const bravoUrl = normalizeBaseUrl(bravoRaw, '--bravo')

  // Pointing both slots at one deployment would make every probe "pass" — the
  // same workspace answering twice is trivially consistent with itself. Preflight
  // re-checks this against live identity, but catching the typo here is free.
  if (alphaUrl === bravoUrl) {
    throw new ConfigError(
      `--alpha and --bravo resolve to the same origin (${alphaUrl}). ` +
        'Two distinct workspaces are required; a single deployment cannot leak to itself.'
    )
  }

  const timeoutRaw = flags.get('timeout-ms')
  const requestTimeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new ConfigError(`--timeout-ms must be a positive number, got ${timeoutRaw}`)
  }

  const only = flags
    .get('only')
    ?.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  return {
    alphaUrl,
    bravoUrl,
    adminEmail: flags.get('admin-email') ?? env.PROBE_ADMIN_EMAIL ?? 'admin@example.com',
    adminPassword: flags.get('admin-password') ?? env.PROBE_ADMIN_PASSWORD ?? 'password',
    alphaDatabaseUrl: flags.get('alpha-db') ?? env.ALPHA_DATABASE_URL,
    bravoDatabaseUrl: flags.get('bravo-db') ?? env.BRAVO_DATABASE_URL,
    alphaApiKey: flags.get('alpha-api-key') ?? env.ALPHA_API_KEY,
    bravoApiKey: flags.get('bravo-api-key') ?? env.BRAVO_API_KEY,
    alphaWorkspaceKey: flags.get('alpha-workspace-id') ?? env.ALPHA_WORKSPACE_ID,
    bravoWorkspaceKey: flags.get('bravo-workspace-id') ?? env.BRAVO_WORKSPACE_ID,
    alphaStorageSecret: flags.get('alpha-storage-secret') ?? env.ALPHA_S3_SECRET_ACCESS_KEY,
    bravoStorageSecret: flags.get('bravo-storage-secret') ?? env.BRAVO_S3_SECRET_ACCESS_KEY,
    alphaWidgetSecret: flags.get('alpha-widget-secret') ?? env.ALPHA_WIDGET_SECRET,
    bravoWidgetSecret: flags.get('bravo-widget-secret') ?? env.BRAVO_WIDGET_SECRET,
    alphaIdentityToken: flags.get('alpha-identity-token') ?? env.ALPHA_IDENTITY_TOKEN,
    bravoIdentityToken: flags.get('bravo-identity-token') ?? env.BRAVO_IDENTITY_TOKEN,
    allowBlocked: bare.has('allow-blocked'),
    jsonOut: flags.get('json-out'),
    only: only && only.length > 0 ? only : undefined,
    requestTimeoutMs,
    teardown: bare.has('teardown'),
  }
}

const KNOWN_FLAGS = new Set([
  'alpha',
  'bravo',
  'alpha-db',
  'bravo-db',
  'alpha-api-key',
  'bravo-api-key',
  'alpha-workspace-id',
  'bravo-workspace-id',
  'alpha-storage-secret',
  'bravo-storage-secret',
  'alpha-widget-secret',
  'bravo-widget-secret',
  'alpha-identity-token',
  'bravo-identity-token',
  'admin-email',
  'admin-password',
  'json-out',
  'only',
  'allow-blocked',
  'timeout-ms',
  'teardown',
  'help',
])

export function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h') || argv.length === 0
}
