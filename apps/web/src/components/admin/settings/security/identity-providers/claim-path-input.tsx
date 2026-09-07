/**
 * Creatable claim-path autocomplete shared by the identity claim fields,
 * role mapping, and attribute map. Suggestions come from the last matching
 * test sign-in; free text is always allowed.
 */

import { Autocomplete } from '@/components/ui/autocomplete'
import { deriveAttributeClaimPaths, deriveClaimSuggestions } from '@/lib/shared/claim-suggestions'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'

function fixtureFor(
  registrationId: string,
  capture: SsoTestCapture | null | undefined
): SsoTestCapture | null {
  if (capture && capture.registrationId === registrationId) return capture
  return null
}

/** Prefer a mapping-failure capture over an earlier success for the same provider. */
export function matchingSessionCapture(
  registrationId: string,
  lastCapture: SsoTestCapture | null | undefined,
  lastSuccess: SsoTestCapture | null | undefined
): SsoTestCapture | null {
  return fixtureFor(registrationId, lastCapture) ?? fixtureFor(registrationId, lastSuccess)
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
}: {
  value: string
  onChange: (next: string) => void
  registrationId: string
  canTest: boolean
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
  /** Session or persisted fixture. Falls back to the sitting's lastCapture. */
  capture?: SsoTestCapture | null
  /** Role suggestions are array-of-string paths; attribute suggestions are
   *  scalar and array leaves, including profile claims. */
  suggestionsFor?: 'role' | 'attribute'
}) {
  const { lastSuccess, lastCapture } = useSsoTestSignIn()
  const fixture =
    matchingSessionCapture(registrationId, lastCapture, lastSuccess) ??
    fixtureFor(registrationId, capture)
  const pathSuggestions = fixture
    ? suggestionsFor === 'attribute'
      ? deriveAttributeClaimPaths(fixture.claims).map((s) => ({
          value: s.path,
          description: s.description,
        }))
      : deriveClaimSuggestions(fixture.claims).paths.map((p) => ({ value: p }))
    : []

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
    matchingSessionCapture(registrationId, lastCapture, lastSuccess) ??
    fixtureFor(registrationId, capture)
  if (!fixture) return null
  return deriveClaimSuggestions(fixture.claims)
}
