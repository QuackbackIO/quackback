/**
 * Freshdesk OAuth utilities.
 * Freshdesk uses API key + subdomain auth, not traditional OAuth.
 * We use the PreAuthField pattern to collect the subdomain.
 */

/**
 * Generate the Freshdesk "OAuth" URL.
 * Freshdesk doesn't have true OAuth — we redirect to a custom flow.
 */
export function getFreshdeskOAuthUrl(
  state: string,
  redirectUri: string,
  fields?: Record<string, string>,
  _credentials?: Record<string, string>
): string {
  const subdomain = fields?.subdomain
  if (!subdomain) {
    throw new Error('Freshdesk subdomain is required')
  }

  // Redirect back to our callback with the subdomain info
  const params = new URLSearchParams({
    state,
    redirect_uri: redirectUri,
    subdomain,
  })

  return `${redirectUri}?${params}`
}

/**
 * Exchange — for Freshdesk this validates the API key and returns config.
 */
export async function exchangeFreshdeskCode(
  code: string,
  _redirectUri: string,
  fields?: Record<string, string>,
  _credentials?: Record<string, string>
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const subdomain = fields?.subdomain
  if (!subdomain) {
    throw new Error('Freshdesk subdomain is required')
  }

  // The "code" is the API key for Freshdesk
  const apiKey = code

  // Verify the key works
  const response = await fetch(`https://${subdomain}.freshdesk.com/api/v2/settings/helpdesk`, {
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Freshdesk authentication failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as { name?: string }

  return {
    accessToken: apiKey,
    config: {
      subdomain,
      workspaceName: data.name || `${subdomain}.freshdesk.com`,
    },
  }
}
