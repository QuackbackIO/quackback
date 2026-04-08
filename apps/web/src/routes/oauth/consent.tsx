import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ExternalLink, Globe, ShieldCheck } from 'lucide-react'

const searchSchema = z.object({
  client_id: z.string(),
  scope: z.string().optional(),
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

// ============================================================================
// Scope grouping
// ============================================================================

interface ScopeGroup {
  label: string
  description: string
  read: boolean
  write: boolean
}

function groupScopes(scopes: string[]): ScopeGroup[] {
  const scopeSet = new Set(scopes)

  const groups: { read?: string; write?: string; label: string; description: string }[] = [
    {
      read: 'read:feedback',
      write: 'write:feedback',
      label: 'Feedback',
      description: 'Posts, comments, boards, and roadmaps',
    },
    {
      write: 'write:changelog',
      label: 'Changelog',
      description: 'Changelog entries and releases',
    },
    {
      read: 'read:help-center',
      write: 'write:help-center',
      label: 'Help Center',
      description: 'Categories and articles',
    },
  ]

  return groups
    .map((g) => ({
      label: g.label,
      description: g.description,
      read: g.read ? scopeSet.has(g.read) : false,
      write: g.write ? scopeSet.has(g.write) : false,
    }))
    .filter((g) => g.read || g.write)
}

const HIDDEN_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

// ============================================================================
// Client info hook
// ============================================================================

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

// ============================================================================
// Component
// ============================================================================

function ConsentPage() {
  const search = Route.useSearch()
  const client = useClientInfo(search.client_id)
  const allScopes: string[] = search.scope?.split(' ').filter(Boolean) ?? []
  const visibleScopes = allScopes.filter((s) => !HIDDEN_SCOPES.has(s))
  const scopeGroups = groupScopes(visibleScopes)
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
          scope: search.scope,
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

  // Loading skeleton
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
      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-border/50 bg-muted/50">
            {client.logo_uri ? (
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

        {/* Permissions */}
        {scopeGroups.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            {scopeGroups.map((group, i) => (
              <div
                key={group.label}
                className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-border/30' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{group.label}</p>
                  <p className="text-xs text-muted-foreground">{group.description}</p>
                </div>
                <div className="flex gap-1.5 shrink-0 ml-4">
                  {group.read && (
                    <span className="text-[11px] font-medium text-muted-foreground/80 border border-border/50 rounded-md px-1.5 py-0.5">
                      Read
                    </span>
                  )}
                  {group.write && (
                    <span className="text-[11px] font-medium text-muted-foreground/80 border border-border/50 rounded-md px-1.5 py-0.5">
                      Write
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
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
              disabled={submitting !== null}
              onClick={() => handleConsent(true)}
            >
              {submitting === 'accept' ? 'Authorizing...' : 'Authorize'}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <p>Revoke any time in account settings</p>
          </div>

          {/* Legal links */}
          {((client.tos_uri && isSafeUrl(client.tos_uri)) ||
            (client.policy_uri && isSafeUrl(client.policy_uri))) && (
            <p className="text-center text-xs text-muted-foreground/60">
              {'By authorizing, you agree to '}
              {client.tos_uri && isSafeUrl(client.tos_uri) && (
                <a
                  href={client.tos_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-muted-foreground transition-colors"
                >
                  Terms of Service
                </a>
              )}
              {client.tos_uri &&
                isSafeUrl(client.tos_uri) &&
                client.policy_uri &&
                isSafeUrl(client.policy_uri) &&
                ' and '}
              {client.policy_uri && isSafeUrl(client.policy_uri) && (
                <a
                  href={client.policy_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-muted-foreground transition-colors"
                >
                  Privacy Policy
                </a>
              )}
              .
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
