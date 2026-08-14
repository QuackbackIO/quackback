import { importSPKI, jwtVerify } from 'jose'
import { parseBillingProjection, type BillingProjection } from './billing-projection'

export const BILLING_PROJECTION_ISSUER = 'quackback-control-plane'
export const BILLING_PROJECTION_AUDIENCE = 'quackback-workspace-billing-projection'
export const BILLING_PROJECTION_TYPE = 'billing-projection+jwt'

export interface VerifiedBillingProjection {
  workspaceKey: string
  projection: BillingProjection
}

function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value
}

/** The signed token is both delivery authentication and cross-workspace binding. */
export async function verifyBillingProjectionToken(
  token: string,
  publicKeyPem = process.env.QUACKBACK_CP_PROJECTION_PUBLIC_KEY
): Promise<VerifiedBillingProjection> {
  if (!publicKeyPem) throw new Error('billing_projection_key_missing')
  const publicKey = await importSPKI(normalizePem(publicKeyPem), 'EdDSA')
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ['EdDSA'],
    issuer: BILLING_PROJECTION_ISSUER,
    audience: BILLING_PROJECTION_AUDIENCE,
    typ: BILLING_PROJECTION_TYPE,
    requiredClaims: ['iat', 'workspaceKey', 'projection'],
  })
  if (typeof payload.workspaceKey !== 'string' || payload.workspaceKey.length === 0) {
    throw new Error('billing_projection_workspace_missing')
  }
  const projection = parseBillingProjection(payload.projection)
  if (!projection) throw new Error('billing_projection_invalid')
  return { workspaceKey: payload.workspaceKey, projection }
}
