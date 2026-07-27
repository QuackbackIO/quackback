/**
 * Advanced connection settings — scopes, sign-in prompt, and client
 * authentication. Its own disclosure because it applies to every provider
 * kind, unlike the manual endpoints section which only renders for "other".
 *
 * Scopes are tokens rather than a free-text field for two reasons: a text box
 * cannot show WHICH scope an IdP rejected, and it lets someone delete `openid`
 * without noticing that doing so stops the request being an OIDC request at
 * all. `openid` therefore has no remove control.
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

export function AdvancedSection({
  scopes,
  prompt,
  tokenAuth,
  discoveryUrl,
  disabled,
  onChange,
  onPromptChange,
  onTokenAuthChange,
}: {
  scopes: string[]
  prompt: string
  tokenAuth: string
  discoveryUrl: string
  disabled: boolean
  onChange: (next: string[]) => void
  onPromptChange: (next: string) => void
  onTokenAuthChange: (next: string) => void
}) {
  // Auto-expand when ANY of these is off its default, so a non-default
  // configuration is never hidden behind a closed panel.
  const [open, setOpen] = useState(
    () =>
      normalizeScopesInput(scopes) !== null ||
      normalizePromptInput(prompt) !== null ||
      normalizeTokenAuthInput(tokenAuth) !== null
  )
  const [draft, setDraft] = useState('')
  const fetchScopes = useServerFn(fetchDiscoveryScopesFn)
  const [supported, setSupported] = useState<string[] | null>(null)

  // Read the IdP's advertised scopes once the panel is open. Catching a
  // mismatch here is the difference between a warning at configuration time and
  // an opaque `invalid_scope` after a round trip through the IdP — which is
  // exactly how this failure was reported.
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
    onChange([...new Set([...scopes, ...next])])
    setDraft('')
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span>Advanced</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/40 px-3 py-3">
          <div className="space-y-2">
            <Label className="text-xs">Scopes</Label>
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
                      onClick={() => onChange(scopes.filter((s) => s !== scope))}
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
            <p className="text-xs text-muted-foreground">
              Requested as <code className="font-mono">{scopes.join(' ')}</code>. Your IdP lists
              what it accepts under <code className="font-mono">scopes_supported</code> in its
              discovery document.
            </p>
            <div className="space-y-2 border-t border-border/40 pt-3">
              <Label htmlFor="idp-prompt" className="text-xs">
                Sign-in prompt
              </Label>
              <Select value={prompt} onValueChange={onPromptChange} disabled={disabled}>
                <SelectTrigger id="idp-prompt" size="sm" aria-label="Sign-in prompt">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_CHOICES.map((c) => (
                    <SelectItem
                      key={c.value}
                      value={c.value}
                      data-testid={`prompt-choice-${c.value}`}
                    >
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                What your provider does when someone already has a session with it.{' '}
                <strong>Don&apos;t send a prompt</strong> leaves it to behave normally;{' '}
                <strong>Silent</strong> is different, and fails outright when nobody is signed in.
              </p>
            </div>

            <div className="space-y-2 border-t border-border/40 pt-3">
              <Label htmlFor="idp-token-auth" className="text-xs">
                Client authentication
              </Label>
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
              <p className="text-xs text-muted-foreground">
                How your client secret reaches the token endpoint. Some providers accept only one of
                the two.
              </p>
            </div>

            {unsupported.length > 0 && (
              <div data-testid="scope-mismatch-warning" className="space-y-2">
                <WarningBox
                  variant="warning"
                  title={`Your provider does not support ${unsupported.join(', ')}`}
                  description={
                    <>
                      It accepts only{' '}
                      <span className="font-mono">{(supported ?? []).join(' ')}</span>. Sign-in will
                      be rejected until these are removed.
                    </>
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(supportedSubset(scopes, supported))}
                >
                  Use supported scopes
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
