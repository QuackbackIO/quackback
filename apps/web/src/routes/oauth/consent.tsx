import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, ShieldCheck } from 'lucide-react'

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

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Access your user ID',
  profile: 'View your name and avatar',
  email: 'View your email address',
  'read:feedback': 'Read feedback posts, comments, and boards',
  'write:feedback': 'Create and triage feedback posts, add comments',
  'write:changelog': 'Create changelog entries',
  offline_access: "Stay connected when you're not using it",
}

function ConsentPage() {
  const search = Route.useSearch()
  const scopes = search.scope?.split(' ').filter(Boolean) ?? []
  const [submitting, setSubmitting] = useState<'accept' | 'deny' | null>(null)

  async function handleConsent(accept: boolean) {
    setSubmitting(accept ? 'accept' : 'deny')
    try {
      // Pass oauth_query with the full signed query string from the URL.
      // The oauth-provider plugin's before hook uses this to restore OAuth state
      // (the state is request-scoped and doesn't persist across the redirect).
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
      if (data.redirect && data.uri) {
        window.location.href = data.uri
      } else if (data.redirectUrl) {
        window.location.href = data.redirectUrl
      }
    } catch {
      setSubmitting(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Authorize Access</CardTitle>
          <CardDescription>An application wants to access your account</CardDescription>
          {search.redirect_uri && (
            <p className="mt-1 text-xs text-muted-foreground break-all">
              Redirecting to: <code className="font-mono">{search.redirect_uri}</code>
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {scopes.length > 0 && (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">This will allow the application to:</p>
              <ul className="space-y-2">
                {scopes.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span>{SCOPE_LABELS[s] ?? s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
        </CardContent>
      </Card>
    </div>
  )
}
