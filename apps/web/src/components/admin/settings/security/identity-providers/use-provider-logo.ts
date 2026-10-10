/**
 * Upload / remove a custom OIDC provider's logo.
 *
 * Follows the IdP settings pattern (see `use-provider-save.ts`): a local hook
 * over `useServerFn` that invalidates `IDENTITY_PROVIDERS_KEY` on success, not a
 * `lib/client/mutations/` module. Unlike the workspace-logo flow it has no
 * favicon step — one PUT, then persist the key.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { getIdentityProviderLogoUploadUrlFn } from '@/lib/server/functions/uploads'
import {
  saveIdentityProviderLogoFn,
  deleteIdentityProviderLogoFn,
} from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY } from './provider-shared'

export function useProviderLogo(provider: IdentityProvider) {
  const queryClient = useQueryClient()
  const getUploadUrl = useServerFn(getIdentityProviderLogoUploadUrlFn)
  const saveLogo = useServerFn(saveIdentityProviderLogoFn)
  const deleteLogo = useServerFn(deleteIdentityProviderLogoFn)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)

  const upload = async (blob: Blob): Promise<boolean> => {
    setUploading(true)
    try {
      const contentType = blob.type || 'image/png'
      const { uploadUrl, key } = await getUploadUrl({
        data: { filename: 'logo.png', contentType, fileSize: blob.size },
      })
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
      })
      if (!res.ok) throw new Error('Failed to upload the logo to storage.')
      await saveLogo({ data: { providerId: provider.id, key } })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Logo updated.')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload the logo.')
      return false
    } finally {
      setUploading(false)
    }
  }

  const remove = async (): Promise<boolean> => {
    setRemoving(true)
    try {
      await deleteLogo({ data: { providerId: provider.id } })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Logo removed.')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the logo.')
      return false
    } finally {
      setRemoving(false)
    }
  }

  return { uploading, removing, upload, remove }
}
