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
import {
  saveIdentityProviderClaimMappingFn,
  upsertIdentityProviderFn,
} from '@/lib/server/functions/sso'
import type { ClaimMappingOperation } from '@/lib/shared/sso-claim-mapping-edit'
import type {
  IdentityProvider,
  UpsertIdentityProviderInput,
} from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY } from './provider-shared'

export type ProviderPatch = Partial<Omit<UpsertIdentityProviderInput, 'id' | 'registrationId'>>

export function useProviderSave(provider: IdentityProvider) {
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const saveMappingFn = useServerFn(saveIdentityProviderClaimMappingFn)
  const [saving, setSaving] = useState(false)

  /** Returns true when the write landed, so a card can clear its drafts.
   *  A null message saves quietly, for the first of two writes behind one Save. */
  const save = async (
    patch: ProviderPatch,
    successMessage: string | null = 'Saved.'
  ): Promise<boolean> => {
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
      if (successMessage) toast.success(successMessage)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the identity provider.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveClaimMapping = async (
    args: {
      operations: ClaimMappingOperation[]
      acknowledgeIdentifierChange?: boolean
      acknowledgeAdminRules?: boolean
    },
    successMessage: string | null = 'Claim mapping saved.',
    /** Shows a refusal where it belongs. Returns true when it did, so no toast follows. */
    onError?: (err: unknown) => boolean
  ): Promise<IdentityProvider | false> => {
    setSaving(true)
    try {
      const saved = (await saveMappingFn({
        data: {
          id: provider.id,
          expectedClaimMapping: provider.claimMapping,
          operations: args.operations,
          acknowledgeIdentifierChange: args.acknowledgeIdentifierChange,
          acknowledgeAdminRules: args.acknowledgeAdminRules,
        },
      })) as IdentityProvider | undefined
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      if (successMessage) toast.success(successMessage)
      return saved ?? (provider as IdentityProvider)
    } catch (err) {
      if (onError?.(err)) return false
      toast.error(err instanceof Error ? err.message : 'Could not save the identity provider.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return { saving, save, saveClaimMapping }
}
