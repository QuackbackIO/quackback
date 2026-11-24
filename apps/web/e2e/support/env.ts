/**
 * The support suite's environment: `support.env`, then any `E2E_SUPPORT_<KEY>`
 * override from the shell, then the values derived from those (URLs built from
 * ports, the sink certificate path).
 *
 * One function so the app server, the stand-ins, the helper scripts and the
 * test workers all read the same values.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Absolute path of the committed env file. */
export const SUPPORT_ENV_FILE = resolve(here, 'support.env')

/** Where run-time files live (certificate, stored sessions). Gitignored. */
export const SUPPORT_RUN_DIR = resolve(here, '../.auth/support')

/** The name the webhook sink answers on. Must be a `*.localhost` name. */
export const WEBHOOK_SINK_HOSTNAME = 'webhook-sink.localhost'

/** The name the OIDC provider fake answers on. Must be a `*.localhost` name. */
export const OIDC_FAKE_HOSTNAME = 'oidc-fake.localhost'

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

export interface SupportEnv {
  /** Everything the app server process gets (plus PATH and HOME). */
  app: Record<string, string>
  baseUrl: string
  port: number
  databaseUrl: string
  fakeAiUrl: string
  fakeAiPort: number
  sinkPort: number
  sinkControlPort: number
  sinkControlUrl: string
  /** The https origin webhooks are pointed at, e.g. https://webhook-sink.localhost:4011 */
  sinkOrigin: string
  /** The stand-ins' certificate (webhook sink and OIDC provider fake). */
  sinkCertPath: string
  sinkKeyPath: string
  /** The provider fake (Slack, Discord, Linear, GitHub, Jira): http on loopback. */
  providerFakePort: number
  providerFakeUrl: string
  /** The OIDC provider fake's https origin, e.g. https://oidc-fake.localhost:4014 */
  oidcFakePort: number
  oidcFakeOrigin: string
  oidcFakeControlPort: number
  oidcFakeControlUrl: string
  mailpitApiUrl: string
}

export function supportEnv(shell: NodeJS.ProcessEnv = process.env): SupportEnv {
  const file = parseEnvFile(readFileSync(SUPPORT_ENV_FILE, 'utf8'))
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(file)) {
    values[key] = shell[`E2E_SUPPORT_${key}`] ?? value
  }

  const port = Number(values.PORT)
  const fakeAiPort = Number(values.E2E_FAKE_AI_PORT)
  const sinkPort = Number(values.E2E_WEBHOOK_SINK_PORT)
  const sinkControlPort = Number(values.E2E_WEBHOOK_SINK_CONTROL_PORT)
  const providerFakePort = Number(values.E2E_PROVIDER_FAKE_PORT)
  const oidcFakePort = Number(values.E2E_OIDC_FAKE_PORT)
  const oidcFakeControlPort = Number(values.E2E_OIDC_FAKE_CONTROL_PORT)
  const providerFakeUrl = `http://127.0.0.1:${providerFakePort}`
  const baseUrl = `http://acme.localhost:${port}`
  // One certificate for every https stand-in (it names each of them).
  const sinkCertPath = resolve(SUPPORT_RUN_DIR, 'stand-ins-cert.pem')
  const sinkKeyPath = resolve(SUPPORT_RUN_DIR, 'stand-ins-key.pem')

  const app: Record<string, string> = {
    ...values,
    BASE_URL: baseUrl,
    OPENAI_BASE_URL: `http://127.0.0.1:${fakeAiPort}/v1`,
    E2E_WEBHOOK_SINK_HOST: `${WEBHOOK_SINK_HOSTNAME}:${sinkPort}`,
    // Provider requests (integrations) go to the provider fake, and identity
    // providers may live on the OIDC fake; both only behind the harness gate.
    E2E_PROVIDER_FAKE_URL: providerFakeUrl,
    E2E_OIDC_FAKE_HOST: `${OIDC_FAKE_HOSTNAME}:${oidcFakePort}`,
    // The app trusts the sink's self-signed certificate this way and no other:
    // certificate checks stay on.
    NODE_EXTRA_CA_CERTS: sinkCertPath,
  }

  return {
    app,
    baseUrl,
    port,
    databaseUrl: values.DATABASE_URL,
    fakeAiUrl: `http://127.0.0.1:${fakeAiPort}`,
    fakeAiPort,
    sinkPort,
    sinkControlPort,
    sinkControlUrl: `http://127.0.0.1:${sinkControlPort}`,
    sinkOrigin: `https://${WEBHOOK_SINK_HOSTNAME}:${sinkPort}`,
    sinkCertPath,
    sinkKeyPath,
    providerFakePort,
    providerFakeUrl,
    oidcFakePort,
    oidcFakeOrigin: `https://${OIDC_FAKE_HOSTNAME}:${oidcFakePort}`,
    oidcFakeControlPort,
    oidcFakeControlUrl: `http://127.0.0.1:${oidcFakeControlPort}`,
    mailpitApiUrl: values.MAILPIT_API_URL,
  }
}
