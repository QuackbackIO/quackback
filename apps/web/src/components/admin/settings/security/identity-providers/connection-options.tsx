/**
 * Connection options — everything about the OIDC request that standard
 * providers never need touched: scopes, the sign-in prompt, client
 * authentication, and (for custom providers only) manual endpoints.
 *
 * Collapsed by default so setup reads as connect → test → enable. It opens
 * itself when any value is off its default, because a non-standard
 * configuration must never sit hidden behind a closed panel.
 *
 * Scopes are tokens rather than a free-text field: a text box cannot show
 * WHICH scope an IdP rejected, and it lets someone delete `openid` without
 * noticing that doing so stops the request being an OIDC request at all.
 * A scope the discovery document does not advertise is flagged, never
 * removed silently — `scopes_supported` is only RECOMMENDED and may be
 * incomplete.
 */
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { WarningBox } from '@/components/shared/warning-box'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  REQUIRED_OIDC_SCOPE,
  normalizeScopesInput,
  parseScopes,
  supportedSubset,
  unsupportedScopes,
} from '@/lib/shared/oidc-scopes'
import {
  PROMPT_CHOICES,
  TOKEN_AUTH_CHOICES,
  normalizePromptInput,
  normalizeTokenAuthInput,
} from '@/lib/shared/oidc-request'
import { fetchDiscoveryScopesFn } from '@/lib/server/functions/sso'
import type { IdpKind } from '../idp-shortcuts'
import { Disclosure } from './disclosure'
import { ManualEndpointsFields, type ManualEndpoints } from './idp-discovery-fields'

export function ConnectionOptions({
  kind,
  scopes,
  prompt,
  tokenAuth,
  discoveryUrl,
  manual,
  disabled,
  onScopesChange,
  onPromptChange,
  onTokenAuthChange,
  onManualChange,
  children,
}: {
  kind: IdpKind
  scopes: string[]
  prompt: string
  tokenAuth: string
  discoveryUrl: string
  manual: ManualEndpoints
  disabled: boolean
  onScopesChange: (next: string[]) => void
  onPromptChange: (next: string) => void
  onTokenAuthChange: (next: string) => void
  onManualChange: (patch: Partial<ManualEndpoints>) => void
  /** Extra fields a caller wants in the same disclosure (the create page
   *  puts the display name here so the main flow stays short). */
  children?: React.ReactNode
}) {
  const hasManual = kind === 'other' && Object.values(manual).some((v) => v.trim() !== '')
  const [open, setOpen] = useState(
    () =>
      normalizeScopesInput(scopes) !== null ||
      normalizePromptInput(prompt) !== null ||
      normalizeTokenAuthInput(tokenAuth) !== null ||
      hasManual
  )
  const [draft, setDraft] = useState('')
  const fetchScopes = useServerFn(fetchDiscoveryScopesFn)
  const [supported, setSupported] = useState<string[] | null>(null)

  // Read the IdP's advertised scopes once the panel is open. Catching a
  // mismatch here is the difference between a warning at configuration time
  // and an opaque `invalid_scope` after a round trip through the IdP.
  useEffect(() => {
    if (!open || !discoveryUrl.trim()) return
    let cancelled = false
    void fetchScopes({ data: { discoveryUrl: discoveryUrl.trim() } })
      .then((r) => {
        if (!cancelled) setSupported(r.scopesSupported)
      })
      .catch(() => {
        // Unreachable discovery is reported by the connection test, not here.
      })
    return () => {
      cancelled = true
    }
  }, [open, discoveryUrl, fetchScopes])

  const unsupported = unsupportedScopes(scopes, supported)

  const addScope = (e: React.FormEvent) => {
    e.preventDefault()
    const next = parseScopes(draft)
    if (next.length === 0) return
    onScopesChange([...new Set([...scopes, ...next])])
    setDraft('')
  }

  return (
    <Disclosure
      title="Connection options"
      open={open}
      onOpenChange={setOpen}
      testId="connection-options"
    >
      <>
        {children}

        <div className="space-y-2">
          <Label>Scopes</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {scopes.map((scope) => (
              <span
                key={scope}
                data-testid={`scope-token-${scope}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-xs"
              >
                {scope}
                {scope === REQUIRED_OIDC_SCOPE ? (
                  <span className="text-[11px] text-muted-foreground">required</span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove scope ${scope}`}
                    disabled={disabled}
                    onClick={() => onScopesChange(scopes.filter((s) => s !== scope))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          <form onSubmit={addScope} data-testid="scope-add-form" className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a scope"
              aria-label="Add a scope"
              disabled={disabled}
              className="h-8 max-w-56 text-xs"
            />
            <Button type="submit" size="sm" variant="outline" disabled={disabled}>
              Add
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            Custom claims can require additional scopes.
          </p>
          {unsupported.length > 0 && (
            <div data-testid="scope-mismatch-warning" className="space-y-2">
              <WarningBox
                variant="warning"
                title={`Your provider does not advertise ${unsupported.join(', ')}`}
                description={
                  <>
                    Its discovery document lists{' '}
                    <span className="font-mono">{(supported ?? []).join(' ')}</span>. Sign-in may be
                    rejected until these are removed.
                  </>
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onScopesChange(supportedSubset(scopes, supported))}
              >
                Use advertised scopes
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="idp-prompt">Sign-in prompt</Label>
          <Select value={prompt} onValueChange={onPromptChange} disabled={disabled}>
            <SelectTrigger id="idp-prompt" size="sm" aria-label="Sign-in prompt">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value} data-testid={`prompt-choice-${c.value}`}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            <strong>Don&apos;t send a prompt</strong> lets your provider behave normally.{' '}
            <strong>Silent</strong> fails when nobody is signed in.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="idp-token-auth">Client authentication</Label>
          <Select value={tokenAuth} onValueChange={onTokenAuthChange} disabled={disabled}>
            <SelectTrigger id="idp-token-auth" size="sm" aria-label="Client authentication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOKEN_AUTH_CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Change this only if your provider rejects the token request.
          </p>
        </div>

        {kind === 'other' && (
          <div className="space-y-3 border-t border-border/40 pt-4">
            <div>
              <Label>Manual endpoints</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Only for a provider with no discovery document. Authorization and token URLs are
                enough to sign in; add the JWKS URI and issuer so the test can verify ID tokens.
              </p>
            </div>
            <ManualEndpointsFields values={manual} disabled={disabled} onChange={onManualChange} />
          </div>
        )}
      </>
    </Disclosure>
  )
}
