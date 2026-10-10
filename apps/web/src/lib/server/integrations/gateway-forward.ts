import { createHmac, timingSafeEqual } from 'node:crypto'

export function signGatewayForward(rawBody: string, timestamp: string, secret: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}
export function verifyGatewayForward(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string | undefined,
  now = Date.now()
): boolean {
  if (!secret || !timestamp || !/^\d+$/.test(timestamp) || !signature) return false
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false
  const expected = Buffer.from(signGatewayForward(rawBody, timestamp, secret))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Purpose-separated attestation of when the gateway verified the provider. */
export function signGatewayReceipt(rawBody: string, receivedAt: string, secret: string): string {
  return signGatewayForward(`receipt:${rawBody}`, receivedAt, secret)
}
export function verifyGatewayReceipt(
  rawBody: string,
  receivedAt: string | null,
  signature: string | null,
  secret: string | undefined,
  now = Date.now()
): number | null {
  if (!receivedAt || !/^\d+$/.test(receivedAt)) return null
  const at = Number(receivedAt) * 1000
  // Bound delayed delivery to one hour; never let a signed receipt live forever.
  if (!Number.isSafeInteger(at) || now - at > 3_600_000 || at > now + 300_000) return null
  return verifyGatewayForward(`receipt:${rawBody}`, receivedAt, signature, secret, at) ? at : null
}
