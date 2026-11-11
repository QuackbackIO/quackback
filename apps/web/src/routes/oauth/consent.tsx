import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DomainAccessPicker } from '@/components/domain-access-picker'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import {
  ACCESS_DOMAINS,
  domainAccessLevels,
  scopesFromDomainLevels,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import {
  CLIENT_REQUESTED_SCOPE_PARAM,
  clientRequestedFromConsentSearch,
  consentGrantScope,
  consentPreset,
  consentPresetLevels,
  defaultSelectedScopes,
  type ConsentPreset,
} from '@/lib/shared/mcp-consent-scopes'
import { cn } from '@/lib/shared/utils'
import { ChevronRight, ExternalLink, Globe, ShieldCheck } from 'lucide-react'

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
  component: ConsentRoute,
})

function ConsentRoute() {
  // This standalone route uses English copy and sits outside the portal/admin providers.
  return (
    <PortalIntlProvider locale={DEFAULT_LOCALE}>
      <ConsentPage />
    </PortalIntlProvider>
  )
}

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

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** One sentence saying what the current selection lets the client do. */
function accessSummary(
  clientName: string,
  preset: ConsentPreset,
  levels: DomainAccessLevels
): string {
  if (preset === 'full') {
    return `${clientName} can read and make changes across your workspace, including settings, up to what your role allows.`
  }
  if (preset === 'read') {
    return `${clientName} can search and read. It cannot post, reply, publish or change settings.`
  }
  const writes = ACCESS_DOMAINS.filter((d) => ['read_write', 'write'].includes(levels[d.domain]))
  const reads = ACCESS_DOMAINS.filter((d) => levels[d.domain] === 'read')
  if (writes.length + reads.length === 0) return 'Select at least one area to continue.'
  const parts: string[] = []
  if (writes.length > 0) {
    parts.push(`${clientName} can change ${joinWords(writes.map((d) => d.label))}.`)
  }
  if (reads.length > 0) {
    parts.push(
      `${writes.length > 0 ? 'It' : clientName} can only read ${joinWords(reads.map((d) => d.label))}.`
    )
  }
  return parts.join(' ')
}

function AccessChoice({
  value,
  selected,
  title,
  description,
  recommended,
  disabled,
  onSelect,
}: {
  value: ConsentPreset
  selected: boolean
  title: string
  description: string
  recommended?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
        'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring',
        selected ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-border',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <input
        type="radio"
        name="access-level"
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 appearance-none rounded-full border border-muted-foreground/60 bg-transparent outline-none checked:border-[5px] checked:border-foreground"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {recommended && (
            <span className="text-[11px] font-medium text-muted-foreground">Recommended</span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

function ConsentPage() {
  const search = Route.useSearch()
  const context = Route.useRouteContext() as {
    session?: { user?: { email?: string | null } | null } | null
    settings?: { name?: string | null } | null
  }
  const signedInAs = context.session?.user?.email ?? null
  const workspaceName = context.settings?.name ?? null
  const client = useClientInfo(search.client_id)
  const clientRequested = clientRequestedFromConsentSearch({
    requested: search[CLIENT_REQUESTED_SCOPE_PARAM],
    scope: search.scope,
  })
  const defaults = defaultSelectedScopes(clientRequested)
  const [levels, setLevels] = useState(() => domainAccessLevels(defaults))
  // A narrower prefill (a step-up) opens the detail so the person sees what is being asked.
  const [showDetail, setShowDetail] = useState(
    () => consentPreset(domainAccessLevels(defaults)) === 'custom'
  )
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

  const preset = consentPreset(levels)
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

          <p className="text-sm text-muted-foreground">
            wants to access {workspaceName ?? 'your account'}
          </p>

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
          <div role="radiogroup" aria-label="Access level" className="space-y-2">
            <AccessChoice
              value="full"
              selected={preset === 'full'}
              title="Full access"
              description="Read and make changes, up to what your role allows"
              recommended
              disabled={submitting !== null}
              onSelect={() => setLevels(consentPresetLevels('full'))}
            />
            <AccessChoice
              value="read"
              selected={preset === 'read'}
              title="Read only"
              description="Search and look things up. No changes."
              disabled={submitting !== null}
              onSelect={() => setLevels(consentPresetLevels('read'))}
            />
            {preset === 'custom' && (
              <AccessChoice
                value="custom"
                selected
                title="Custom"
                description="Your own selection below"
                disabled={submitting !== null}
                onSelect={() => {}}
              />
            )}
          </div>

          <button
            type="button"
            aria-expanded={showDetail}
            aria-controls="consent-access-detail"
            onClick={() => setShowDetail((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-sm px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', showDetail && 'rotate-90')}
              aria-hidden
            />
            Choose what {clientName} can access
          </button>

          {showDetail && (
            <div
              id="consent-access-detail"
              className="rounded-xl border border-border/50 bg-card overflow-hidden"
            >
              <DomainAccessPicker
                levels={levels}
                onChange={setLevels}
                disabled={submitting !== null}
                flagHighImpact
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
          )}

          <p className="text-xs text-muted-foreground px-1" aria-live="polite">
            {accessSummary(clientName, preset, levels)}
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
            <p>
              {signedInAs ? `Signed in as ${signedInAs}. ` : ''}Revoke any time in account settings
            </p>
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
