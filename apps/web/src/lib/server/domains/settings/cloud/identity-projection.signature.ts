import { parseIdentityProjection, type IdentityProjection } from './identity-projection'
import { verifyWorkspaceProjectionToken } from './workspace-projection.signature'

export const IDENTITY_PROJECTION_AUDIENCE = 'quackback-workspace-identity-projection'
export const IDENTITY_PROJECTION_TYPE = 'identity-projection+jwt'

export function verifyIdentityProjectionToken(
  token: string,
  publicKeyPem = process.env.QUACKBACK_CP_PROJECTION_PUBLIC_KEY
): Promise<{ workspaceKey: string; projection: IdentityProjection }> {
  return verifyWorkspaceProjectionToken({
    token,
    publicKeyPem,
    audience: IDENTITY_PROJECTION_AUDIENCE,
    type: IDENTITY_PROJECTION_TYPE,
    claim: 'identityProjection',
    parse: parseIdentityProjection,
    errorPrefix: 'identity_projection',
  })
}
