/**
 * Plain-English explanations for the OIDC error codes admins actually
 * hit. Each entry: "what the IdP told you" → "what's wrong + what to
 * change". Generated from real support tickets and the OIDC core spec.
 */

export function explainAuthorizeError(code: string, description?: string | null): string {
  const desc = description ? ` ${description}` : ''
  switch (code) {
    case 'invalid_request':
      return `${desc} Most often this is a redirect_uri mismatch. The redirect URI in the IdP's allowed-redirect list must match exactly, including the trailing slash and path.`
    case 'unauthorized_client':
      return `${desc} Your IdP application is not authorized to use the authorization_code grant. Enable it in the IdP application settings.`
    case 'access_denied':
      return `${desc} The IdP refused the request. Either the user clicked Deny, or an IdP policy (geo, MFA, device) blocked sign-in.`
    case 'unsupported_response_type':
      return `${desc} The IdP rejected response_type=code. Enable authorization code flow on the IdP application.`
    case 'invalid_scope':
      return `${desc} One of the requested scopes (openid email profile) is not registered. Add the missing scope to the IdP application's allowed scopes.`
    case 'server_error':
      return `${desc} The IdP hit an internal error. Retry the test; if persistent, check your IdP's status page.`
    case 'temporarily_unavailable':
      return `${desc} The IdP is temporarily refusing requests. Retry in a minute.`
    default:
      return `Unrecognized authorize error from IdP: ${code}.${desc}`
  }
}

export function explainTokenError(
  code: string | undefined,
  description: string | null | undefined,
  httpStatus: number
): string {
  const desc = description ? ` (${description})` : ''
  switch (code) {
    case 'invalid_grant':
      return `Authorization code rejected.${desc} Common causes: PKCE code_verifier mismatch (your IdP may not support PKCE for confidential clients — check IdP settings), authorization code already used, code expired (>10 min between authorize and callback), or redirect_uri differs between authorize and token requests.`
    case 'invalid_client':
      return `Client authentication failed.${desc} Either the client_secret is wrong, or the IdP expects a different client authentication method (basic auth vs POST body vs JWT). Re-paste the secret and check the IdP's 'Token Endpoint Authentication Method' setting.`
    case 'invalid_request':
      return `Malformed token request.${desc} If the test sign-in is the only path producing this, file a bug. Otherwise check that your redirect_uri exactly matches the value used at authorize time.`
    case 'unauthorized_client':
      return `The client is not authorized to use authorization_code.${desc} Enable that grant type on the IdP application.`
    case 'unsupported_grant_type':
      return `The IdP does not support authorization_code grant.${desc} This is unusual for OIDC providers; verify you're configured for OIDC, not pure OAuth.`
    default:
      return code
        ? `Unrecognized token error from IdP (${code}, HTTP ${httpStatus}).${desc}`
        : `Token endpoint returned HTTP ${httpStatus}.${desc} Check the IdP application's logs for details.`
  }
}
