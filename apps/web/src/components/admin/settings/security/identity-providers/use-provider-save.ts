/**
 * One card, one save. Each card on the provider detail page owns a slice of
 * the row and persists only that slice; the server's patch semantics leave
 * every column a caller omits untouched, so two cards can never clobber each
 * other's fields.
 *
 * The validator still requires the identity columns on every write
 * (`registrationId` / `label` / `clientId`), so they are resent unchanged
 * unless the caller is the card that actually edits them. Resending an
 * identical value is not a change, so it does not restamp `detailsChangedAt`
 * or invalidate a good connection test.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { upsertIdentityProviderFn } from '@/lib/server/functions/sso'
import type {
  IdentityProvider,
  UpsertIdentityProviderInput,
} from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY } from './provider-shared'

export type ProviderPatch = Partial<Omit<UpsertIdentityProviderInput, 'id' | 'registrationId'>>

export function useProviderSave(provider: IdentityProvider) {
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const [saving, setSaving] = useState(false)

  /** Returns true when the write landed, so a card can clear its drafts. */
  const save = async (patch: ProviderPatch, successMessage = 'Saved.'): Promise<boolean> => {
    setSaving(true)
    try {
      await upsert({
        data: {
          id: provider.id,
          registrationId: provider.registrationId,
          label: provider.label,
          clientId: provider.clientId,
          ...patch,
        },
      })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success(successMessage)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the identity provider.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return { saving, save }
}
