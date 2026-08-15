/**
 * Creatable claim-path autocomplete shared by the identity claim fields,
 * role mapping, and attribute map. Suggestions come from the last matching
 * test sign-in; free text is always allowed.
 */

import { Autocomplete } from '@/components/ui/autocomplete'
import { deriveClaimSuggestions } from '@/lib/shared/claim-suggestions'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'

export function ClaimPathInput({
  value,
  onChange,
  registrationId,
  canTest,
  placeholder,
  ariaLabel,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  registrationId: string
  canTest: boolean
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const { lastSuccess } = useSsoTestSignIn()
  const suggestions =
    lastSuccess && lastSuccess.registrationId === registrationId
      ? deriveClaimSuggestions(lastSuccess.claims)
      : null
  const pathSuggestions = (suggestions?.paths ?? []).map((p) => ({ value: p }))

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

export function useClaimSuggestions(registrationId: string) {
  const { lastSuccess } = useSsoTestSignIn()
  if (!lastSuccess || lastSuccess.registrationId !== registrationId) return null
  return deriveClaimSuggestions(lastSuccess.claims)
}
