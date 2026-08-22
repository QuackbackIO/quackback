/**
 * Parse a session-mode DSN into fields postgres.js will not fill from `PG*`.
 *
 * A connection-string constructor inherits missing user/password/host from the
 * process environment (and treats a host containing `/` as a Unix socket). The
 * HTTP provision path is the first place a caller-supplied URL is dialed, so
 * reject incomplete URLs before connecting.
 */
import postgres from 'postgres'

export type SessionModeDsnReason = 'unparseable' | 'scheme' | 'host' | 'credentials' | 'pooled'

export class SessionModeDsnError extends Error {
  readonly reason: SessionModeDsnReason
  constructor(reason: SessionModeDsnReason) {
    super('session-mode DSN is not usable')
    this.name = 'SessionModeDsnError'
    this.reason = reason
  }
}

export interface SessionModeDsn {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: boolean | undefined
  applicationName: string | undefined
}

function isPooledHostname(host: string): boolean {
  return host.includes('-pooler.') || host.startsWith('-pooler') || host.endsWith('-pooler')
}

export function parseSessionModeDsn(dsn: string): SessionModeDsn {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    throw new SessionModeDsnError('unparseable')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new SessionModeDsnError('scheme')
  }
  const host = url.hostname
  if (!host || host.includes('/')) throw new SessionModeDsnError('host')
  if (isPooledHostname(host)) throw new SessionModeDsnError('pooled')

  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  const database = decodeURIComponent((url.pathname.replace(/^\//, '').split('/')[0] ?? '').trim())
  if (!username || !password || !database) throw new SessionModeDsnError('credentials')

  const port = url.port ? Number(url.port) : 5432
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new SessionModeDsnError('host')

  const sslmode = url.searchParams.get('sslmode')
  let ssl: boolean | undefined
  if (sslmode === 'disable' || sslmode === 'allow') ssl = false
  else if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') ssl = true

  const applicationName = url.searchParams.get('application_name') || undefined
  return { host, port, database, username, password, ssl, applicationName }
}

/** Open one session-mode connection; never inherit `PG*` for identity. */
export function connectSessionMode(dsn: string): postgres.Sql {
  const parsed = parseSessionModeDsn(dsn)
  return postgres({
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    username: parsed.username,
    password: parsed.password,
    ...(parsed.ssl !== undefined ? { ssl: parsed.ssl } : {}),
    max: 1,
    onnotice: () => {},
    connect_timeout: 20,
    ...(parsed.applicationName ? { connection: { application_name: parsed.applicationName } } : {}),
  })
}
