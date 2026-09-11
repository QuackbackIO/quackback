import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DomainAccessPicker } from '@/components/domain-access-picker'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { domainAccessLevels, scopesFromDomainLevels } from '@/lib/shared/api-key-scopes'
import {
  CLIENT_REQUESTED_SCOPE_PARAM,
  clientRequestedFromConsentSearch,
  consentGrantScope,
  defaultSelectedScopes,
} from '@/lib/shared/mcp-consent-scopes'
import { ExternalLink, Globe, ShieldCheck } from 'lucide-react'

const searchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
  [CLIENT_REQUESTED_SCOPE_PARAM]: z.string().optional(),
  redirect_uri: z.string().optional(),
  state: z.string().optional(),
  response_type: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  prompt: z.string().optional(),
  exp: z.union([z.string(), z.number()]).optional(),
  sig: z.string().optional(),
  resource: z.string().optional(),
})

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: searchSchema,
  component: ConsentPage,
})

interface OAuthClientInfo {
  client_name?: string
  client_uri?: string
  logo_uri?: string
  policy_uri?: string
  tos_uri?: string
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function useClientInfo(clientId: string) {
  const [client, setClient] = useState<OAuthClientInfo | null>(null)

  useEffect(() => {
    fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setClient(data ?? {}))
      .catch(() => setClient({}))
  }, [clientId])

  return client
}

function ConsentPage() {
  const search = Route.useSearch()
  const client = useClientInfo(search.client_id)
  const clientRequested = clientRequestedFromConsentSearch({
    requested: search[CLIENT_REQUESTED_SCOPE_PARAM],
    scope: search.scope,
  })
  const defaults = defaultSelectedScopes(clientRequested)
  const [levels, setLevels] = useState(() => domainAccessLevels(defaults))
  const [offlineAccess, setOfflineAccess] = useState(() => defaults.includes('offline_access'))
  const [submitting, setSubmitting] = useState<'accept' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clientName = client?.client_name || 'An application'
  const clientDomain = (() => {
    if (!client?.client_uri || !isSafeUrl(client.client_uri)) return null
    try {
      return new URL(client.client_uri).hostname
    } catch {
      return null
    }
  })()

  const capabilityScopes = scopesFromDomainLevels(levels)
  const canAuthorize = capabilityScopes.length > 0

  async function handleConsent(accept: boolean) {
    setSubmitting(accept ? 'accept' : 'deny')
    setError(null)
    try {
      const oauthQuery = window.location.search.replace(/^\?/, '')
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accept,
          scope: accept
            ? consentGrantScope(
                offlineAccess ? [...capabilityScopes, 'offline_access'] : capabilityScopes
              )
            : search.scope,
          oauth_query: oauthQuery,
        }),
      })

      if (response.redirected) {
        window.location.href = response.url
        return
      }

      const data = await response.json()
      const redirectTo = data.url ?? data.uri ?? data.redirectUrl
      if (redirectTo) {
        window.location.href = redirectTo
      }
    } catch {
      setSubmitting(null)
      setError('Something went wrong. Please try again.')
    }
  }

  if (client === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-muted animate-pulse" />
            <div className="h-5 w-52 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-40 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-border/50 bg-muted/50">
            {client.logo_uri && isSafeUrl(client.logo_uri) ? (
              <img
                src={client.logo_uri}
                alt={clientName}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <Globe className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <h1 className="text-xl font-semibold">{clientName}</h1>

          <p className="text-sm text-muted-foreground">wants to access your account</p>

          {clientDomain && (
            <p className="text-xs text-muted-foreground/70">
              {client.client_uri ? (
                <a
                  href={client.client_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
                >
                  {clientDomain}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                clientDomain
              )}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <DomainAccessPicker
              levels={levels}
              onChange={setLevels}
              disabled={submitting !== null}
            />
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
              <div className="min-w-0 pr-4">
                <p className="text-sm font-medium">Stay signed in</p>
                <p className="text-xs text-muted-foreground">
                  Let {clientName} refresh access without asking again
                </p>
              </div>
              <Switch
                checked={offlineAccess}
                onCheckedChange={setOfflineAccess}
                disabled={submitting !== null}
                aria-label="Stay signed in"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Read is on so {clientName} can search and look things up. Read and write includes that
            lookup. You can add writes now, or when a tool asks later.
          </p>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={submitting !== null}
              onClick={() => handleConsent(false)}
            >
              {submitting === 'deny' ? 'Denying...' : 'Deny'}
            </Button>
            <Button
              size="lg"
              className="flex-1"
              disabled={submitting !== null || !canAuthorize}
              onClick={() => handleConsent(true)}
            >
              {submitting === 'accept' ? 'Authorizing...' : 'Authorize'}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <p>Revoke any time in account settings</p>
          </div>

          {(() => {
            const hasTos = !!client.tos_uri && isSafeUrl(client.tos_uri)
            const hasPolicy = !!client.policy_uri && isSafeUrl(client.policy_uri)
            if (!hasTos && !hasPolicy) return null
            return (
              <p className="text-center text-xs text-muted-foreground/60">
                {'By authorizing, you agree to '}
                {hasTos && (
                  <a
                    href={client.tos_uri!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-muted-foreground transition-colors"
                  >
                    Terms of Service
                  </a>
                )}
                {hasTos && hasPolicy && ' and '}
                {hasPolicy && (
                  <a
                    href={client.policy_uri!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-muted-foreground transition-colors"
                  >
                    Privacy Policy
                  </a>
                )}
                .
              </p>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
