/**
 * Fail-closed Amazon SNS signature verification (SigningCertURL + Signature).
 *
 * Mirrors the AWS HTTP-endpoint algorithm: HTTPS cert URL on an sns.<region>
 * Amazon host, PEM download, then RSA-SHA1 (v1) or RSA-SHA256 (v2) over the
 * type-specific canonical field list. Used by the delivery-event webhook
 * before any SubscriptionConfirmation fetch or bounce/complaint write.
 */
import { createVerify } from 'node:crypto'
import { safeFetch } from '@/lib/server/content/ssrf-guard'

export const SNS_ENVELOPE_TYPES = [
  'Notification',
  'SubscriptionConfirmation',
  'UnsubscribeConfirmation',
] as const

export type SnsEnvelopeType = (typeof SNS_ENVELOPE_TYPES)[number]

/** Named 4xx body when an SNS envelope fails cryptographic verification. */
export const INVALID_SNS_SIGNATURE = 'invalid_sns_signature'

export type SnsVerifyReason =
  | 'malformed'
  | 'missing_signature'
  | 'invalid_cert_url'
  | 'unsupported_signature_version'
  | 'cert_fetch_failed'
  | 'invalid_signature'

export type SnsVerifyResult = { ok: true } | { ok: false; reason: SnsVerifyReason }

export type FetchSnsCert = (url: string) => Promise<string>

export type VerifySnsDeps = {
  /** Test seam: return a PEM without touching the network. */
  fetchCert?: FetchSnsCert
}

const SNS_CERT_HOST = /^sns\.[a-zA-Z0-9-]{3,}\.amazonaws\.com(\.cn)?$/i

const REQUIRED_KEYS = [
  'Message',
  'MessageId',
  'Timestamp',
  'TopicArn',
  'Type',
  'Signature',
  'SignatureVersion',
] as const

const SUBSCRIPTION_EXTRA_KEYS = ['SubscribeURL', 'Token'] as const

const SIGNABLE_NOTIFICATION = [
  'Message',
  'MessageId',
  'Subject',
  'SubscribeURL',
  'Timestamp',
  'TopicArn',
  'Type',
] as const

const SIGNABLE_SUBSCRIPTION = [
  'Message',
  'MessageId',
  'Subject',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
] as const

const CERT_CACHE_LIMIT = 32
const certCache = new Map<string, string>()

function isSnsEnvelopeType(value: unknown): value is SnsEnvelopeType {
  return (
    value === 'Notification' ||
    value === 'SubscriptionConfirmation' ||
    value === 'UnsubscribeConfirmation'
  )
}

export function isSnsEnvelope(body: unknown): body is Record<string, unknown> & {
  Type: SnsEnvelopeType
} {
  return (
    Boolean(body) &&
    typeof body === 'object' &&
    isSnsEnvelopeType((body as { Type?: unknown }).Type)
  )
}

/** HTTPS sns.<region>.amazonaws.com host, no credentials, default port only. */
export function isAmazonSnsHttpsUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (parsed.port !== '' && parsed.port !== '443') return false
  return SNS_CERT_HOST.test(parsed.hostname)
}

/** SigningCertURL: Amazon SNS HTTPS host and a `.pem` path. */
export function isAmazonSnsCertUrl(raw: string): boolean {
  if (!isAmazonSnsHttpsUrl(raw)) return false
  try {
    return new URL(raw).pathname.endsWith('.pem')
  } catch {
    return false
  }
}

function stringField(rec: Record<string, unknown>, key: string): string | null {
  const value = rec[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function signingCertUrl(rec: Record<string, unknown>): string | null {
  return stringField(rec, 'SigningCertURL') ?? stringField(rec, 'SigningCertUrl')
}

export function snsCanonicalString(rec: Record<string, unknown>): string | null {
  const type = rec.Type
  if (!isSnsEnvelopeType(type)) return null
  const keys = type === 'Notification' ? SIGNABLE_NOTIFICATION : SIGNABLE_SUBSCRIPTION
  let canonical = ''
  for (const key of keys) {
    const value = rec[key]
    if (typeof value === 'string') canonical += `${key}\n${value}\n`
  }
  return canonical
}

async function defaultFetchCert(url: string): Promise<string> {
  const res = await safeFetch(url, {
    method: 'GET',
    timeoutMs: 5_000,
    maxResponseBytes: 16 * 1024,
    onOverflow: 'error',
  })
  if (!res.ok) throw new Error('cert_fetch_failed')
  const pem = await res.text()
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('cert_fetch_failed')
  return pem
}

async function resolveCert(url: string, fetchCert?: FetchSnsCert): Promise<string> {
  if (fetchCert) return fetchCert(url)
  const cached = certCache.get(url)
  if (cached) return cached
  const pem = await defaultFetchCert(url)
  if (certCache.size >= CERT_CACHE_LIMIT) {
    const oldest = certCache.keys().next().value
    if (oldest !== undefined) certCache.delete(oldest)
  }
  certCache.set(url, pem)
  return pem
}

export function clearSnsCertCache(): void {
  certCache.clear()
}

/**
 * Verify an SNS HTTP envelope. Fail-closed: missing fields, a non-Amazon cert
 * URL, an unsupported version, or a bad signature all return ok: false.
 */
export async function verifySnsMessageSignature(
  body: unknown,
  deps: VerifySnsDeps = {}
): Promise<SnsVerifyResult> {
  if (!isSnsEnvelope(body)) return { ok: false, reason: 'malformed' }
  const rec = body

  for (const key of REQUIRED_KEYS) {
    if (stringField(rec, key) === null) {
      return {
        ok: false,
        reason:
          key === 'Signature' || key === 'SignatureVersion' ? 'missing_signature' : 'malformed',
      }
    }
  }
  if (rec.Type !== 'Notification') {
    for (const key of SUBSCRIPTION_EXTRA_KEYS) {
      if (stringField(rec, key) === null) return { ok: false, reason: 'malformed' }
    }
  }

  const version = stringField(rec, 'SignatureVersion')
  if (version !== '1' && version !== '2') {
    return { ok: false, reason: 'unsupported_signature_version' }
  }

  const certUrl = signingCertUrl(rec)
  if (!certUrl) return { ok: false, reason: 'missing_signature' }
  if (!isAmazonSnsCertUrl(certUrl)) return { ok: false, reason: 'invalid_cert_url' }

  const canonical = snsCanonicalString(rec)
  const signature = stringField(rec, 'Signature')
  if (!canonical || !signature) return { ok: false, reason: 'malformed' }

  let pem: string
  try {
    pem = await resolveCert(certUrl, deps.fetchCert)
  } catch {
    return { ok: false, reason: 'cert_fetch_failed' }
  }
  if (!pem) return { ok: false, reason: 'cert_fetch_failed' }

  try {
    const verifier = createVerify(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
    verifier.update(canonical, 'utf8')
    if (!verifier.verify(pem, signature, 'base64')) {
      return { ok: false, reason: 'invalid_signature' }
    }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }

  return { ok: true }
}
