/**
 * Creatable claim-path autocomplete shared by the identity claim fields,
 * role mapping, and attribute map. Suggestions come from the last matching
 * test sign-in; free text is always allowed.
 */

import { Autocomplete } from '@/components/ui/autocomplete'
import {
  deriveAttributeClaimPaths,
  deriveClaimSuggestions,
  deriveIdentityClaimPaths,
} from '@/lib/shared/claim-suggestions'
import { captureSuggestionClaims, type SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'

function fixtureFor(
  registrationId: string,
  capture: SsoTestCapture | null | undefined
): SsoTestCapture | null {
  if (capture && capture.registrationId === registrationId) return capture
  return null
}

export function ClaimPathInput({
  value,
  onChange,
  registrationId,
  canTest,
  placeholder,
  ariaLabel,
  disabled,
  capture,
  suggestionsFor = 'role',
  providerKind,
  identityField,
}: {
  value: string
  onChange: (next: string) => void
  registrationId: string
  canTest: boolean
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
  /** Session or persisted fixture. Shared with the preview rail. */
  capture?: SsoTestCapture | null
  /** Role suggestions are array-of-string paths; attribute suggestions are
   *  scalar and array leaves, including profile claims. Identity includes
   *  `sub` and may mark array candidates unsuitable. */
  suggestionsFor?: 'role' | 'attribute' | 'identity'
  providerKind?: string | null
  identityField?: 'id' | 'email' | 'name'
}) {
  const { lastSuccess, lastCapture } = useSsoTestSignIn()
  const fixture =
    fixtureFor(registrationId, capture) ??
    fixtureFor(registrationId, lastCapture) ??
    fixtureFor(registrationId, lastSuccess)
  const pathSuggestions = (() => {
    if (suggestionsFor === 'identity') {
      const claims = fixture ? captureSuggestionClaims(fixture) : {}
      return deriveIdentityClaimPaths(claims, {
        kind: providerKind,
        field: identityField,
      }).map((s) => ({
        value: s.path,
        description: s.unsuitable
          ? [s.description, 'Not a scalar identity claim'].filter(Boolean).join(' · ')
          : s.description,
        disabled: s.unsuitable === true,
      }))
    }
    if (!fixture) return []
    const claims = captureSuggestionClaims(fixture)
    if (suggestionsFor === 'attribute') {
      return deriveAttributeClaimPaths(claims).map((s) => ({
        value: s.path,
        description: s.description,
      }))
    }
    return deriveClaimSuggestions(claims).paths.map((p) => ({ value: p }))
  })()

  return (
    <Autocomplete
      value={value}
      onValueChange={onChange}
      suggestions={pathSuggestions}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      size="sm"
      emptyHint={
        <div className="space-y-2 px-1 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            Run a test sign-in to discover your IdP&apos;s claims.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Or type a path like groups, realm_access.roles, or a namespaced claim.
          </p>
          <TestSignInButton registrationId={registrationId} disabled={disabled || !canTest} />
        </div>
      }
      disabled={disabled}
      className="w-full"
    />
  )
}

export function useClaimSuggestions(registrationId: string, capture?: SsoTestCapture | null) {
  const { lastSuccess, lastCapture } = useSsoTestSignIn()
  const fixture =
    fixtureFor(registrationId, lastCapture) ??
    fixtureFor(registrationId, lastSuccess) ??
    fixtureFor(registrationId, capture)
  if (!fixture) return null
  return deriveClaimSuggestions(captureSuggestionClaims(fixture))
}
