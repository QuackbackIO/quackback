/**
 * The connection test for one provider, with its completion step attached,
 * and the newest capture that test produced.
 *
 * Setup is connect → test → enable. A passing test on a provider that is
 * still off therefore offers "Enable sign-in" right in the result view, so
 * the admin does not have to find the header toggle to finish. The offer is
 * omitted for a provider that is already enabled.
 */
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { selectMappingCapture } from '@/lib/shared/sso-mapping-preview'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { useSsoTestSignIn, type SsoTestSuccessAction } from '../sso/use-sso-test-sign-in'
import { useProviderSave } from './use-provider-save'

export function useConnectionTest(provider: IdentityProvider) {
  const { open } = useSsoTestSignIn()
  const { save } = useProviderSave(provider)

  const successAction: SsoTestSuccessAction | undefined = provider.enabled
    ? undefined
    : {
        label: 'Enable sign-in',
        doneMessage: 'Sign-in is enabled.',
        run: async () => {
          const ok = await save({ enabled: true }, 'Sign-in enabled.')
          if (!ok) throw new Error('Could not enable sign-in.')
        },
      }

  const openTest = () => open({ registrationId: provider.registrationId, successAction })

  return { openTest, successAction }
}

/** The newest test capture for this provider: this session's, or the one
 *  persisted with the row. Null when it has never been tested. */
export function useProviderCapture(provider: IdentityProvider): SsoTestCapture | null {
  const { lastSuccess, lastCapture } = useSsoTestSignIn()
  return selectMappingCapture({
    registrationId: provider.registrationId,
    sessionCapture:
      lastCapture?.registrationId === provider.registrationId
        ? lastCapture
        : lastSuccess?.registrationId === provider.registrationId
          ? lastSuccess
          : null,
    persistedCapture: provider.lastTestCapture,
  })
}
