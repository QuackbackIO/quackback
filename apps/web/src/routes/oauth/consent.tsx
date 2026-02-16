import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, ExternalLink, Globe, ShieldCheck } from 'lucide-react'

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

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  openid: { label: 'User ID', description: 'Access your user identifier' },
  profile: { label: 'Profile', description: 'View your name and avatar' },
  email: { label: 'Email', description: 'View your email address' },
  'read:feedback': {
    label: 'Read feedback',
    description: 'Read posts, comments, boards, and roadmaps',
  },
  'write:feedback': {
    label: 'Write feedback',
    description: 'Create posts, add comments, and vote',
  },
  'write:changelog': {
    label: 'Write changelogs',
    description: 'Create and publish changelog entries',
  },
  offline_access: {
    label: 'Offline access',
    description: "Stay connected when you're not actively using it",
  },
}

/** Scopes that are standard OIDC plumbing — not worth showing to users */
const HIDDEN_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access'])

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
  const allScopes: string[] = search.scope?.split(' ').filter(Boolean) ?? []
  const visibleScopes = allScopes.filter((s) => !HIDDEN_SCOPES.has(s))
  const [submitting, setSubmitting] = useState<'accept' | 'deny' | null>(null)

  const clientName = client?.client_name || 'An application'
  const clientDomain = (() => {
    if (!client?.client_uri) return null
    try {
      return new URL(client.client_uri).hostname
    } catch {
      return null
    }
  })()

  async function handleConsent(accept: boolean) {
    setSubmitting(accept ? 'accept' : 'deny')
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
      const redirectTo = data.uri ?? data.redirectUrl
      if (redirectTo) {
        window.location.href = redirectTo
      }
    } catch {
      setSubmitting(null)
    }
  }

  // Show nothing while loading client info to avoid flash
  if (client === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted animate-pulse" />
            <div className="mx-auto h-5 w-48 rounded bg-muted animate-pulse" />
            <div className="mx-auto mt-2 h-4 w-64 rounded bg-muted animate-pulse" />
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Client identity */}
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            {client.logo_uri ? (
              <img
                src={client.logo_uri}
                alt={clientName}
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              <Globe className="h-7 w-7 text-muted-foreground" />
            )}
          </div>

          <CardTitle className="text-xl">{clientName}</CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">wants to access your account</p>

          {clientDomain && (
            <p className="mt-1 text-xs text-muted-foreground">
              {client.client_uri ? (
                <a
                  href={client.client_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {clientDomain}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                clientDomain
              )}
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Permissions */}
          {visibleScopes.length > 0 && (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                This will allow {client.client_name || 'the application'} to:
              </p>
              <ul className="space-y-2.5">
                {visibleScopes.map((s) => {
                  const scope = SCOPE_LABELS[s]
                  return (
                    <li key={s} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <div>
                        <p className="text-sm font-medium">{scope?.label ?? s}</p>
                        {scope?.description && (
                          <p className="text-xs text-muted-foreground">{scope.description}</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Authorization notice */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>You can revoke this access at any time from your account settings.</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={submitting !== null}
              onClick={() => handleConsent(false)}
            >
              {submitting === 'deny' ? 'Denying...' : 'Deny'}
            </Button>
            <Button
              className="flex-1"
              disabled={submitting !== null}
              onClick={() => handleConsent(true)}
            >
              {submitting === 'accept' ? 'Authorizing...' : 'Authorize'}
            </Button>
          </div>

          {/* Legal links */}
          {(client.tos_uri || client.policy_uri) && (
            <p className="text-center text-xs text-muted-foreground">
              {'By authorizing, you agree to '}
              {client.tos_uri && (
                <a
                  href={client.tos_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Terms of Service
                </a>
              )}
              {client.tos_uri && client.policy_uri && ' and '}
              {client.policy_uri && (
                <a
                  href={client.policy_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Privacy Policy
                </a>
              )}
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
