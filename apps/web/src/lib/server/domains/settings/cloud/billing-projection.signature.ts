import { parseBillingProjection, type BillingProjection } from './billing-projection'
import { verifyWorkspaceProjectionToken } from './workspace-projection.signature'

export const BILLING_PROJECTION_ISSUER = 'quackback-control-plane'
export const BILLING_PROJECTION_AUDIENCE = 'quackback-workspace-billing-projection'
export const BILLING_PROJECTION_TYPE = 'billing-projection+jwt'

export interface VerifiedBillingProjection {
  workspaceKey: string
  projection: BillingProjection
}

/** The signed token is both delivery authentication and cross-workspace binding. */
export async function verifyBillingProjectionToken(
  token: string,
  publicKeyPem = process.env.QUACKBACK_CP_PROJECTION_PUBLIC_KEY
): Promise<VerifiedBillingProjection> {
  return verifyWorkspaceProjectionToken({
    token,
    publicKeyPem,
    audience: BILLING_PROJECTION_AUDIENCE,
    type: BILLING_PROJECTION_TYPE,
    claim: 'projection',
    parse: parseBillingProjection,
    errorPrefix: 'billing_projection',
  })
}
