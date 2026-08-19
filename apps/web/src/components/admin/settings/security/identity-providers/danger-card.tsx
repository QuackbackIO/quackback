/**
 * #danger — removing the provider.
 *
 * Its own card rather than a ghost button next to Save, because it is not the
 * same class of action as the four saves above it and does not undo. It states
 * what a removal would cost before offering it: sign-in through the provider
 * stops, its verified domains are released, and every identity already linked
 * to it is orphaned.
 *
 * Both refusals here are mirrors of server-side invariants, not UI politeness:
 * the service refuses to delete a provider with linked accounts, and the "keep
 * one sign-in method" guard refuses to remove the last working one.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TrashIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { settingsQueries } from '@/lib/client/queries/settings'
import { deleteIdentityProviderFn } from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY } from './provider-shared'

export function DangerCard({
  provider,
  isOnlyMethod,
}: {
  provider: IdentityProvider
  /** True when this provider is the workspace's only working sign-in method —
   *  removing it would lock everyone out. */
  isOnlyMethod: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const remove = useServerFn(deleteIdentityProviderFn)
  const { data } = useSuspenseQuery(settingsQueries.providerAccountCount(provider.id))
  const accountCount = data.count

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const blockedReason = isOnlyMethod
    ? 'This is the only enabled sign-in method. Enable another before removing it.'
    : accountCount > 0
      ? `${accountCount} ${accountCount === 1 ? 'person signs' : 'people sign'} in through this provider. Removing it would orphan ${accountCount === 1 ? 'their account' : 'their accounts'}. Disable it instead, or remove those accounts first.`
      : null

  const handleDelete = async () => {
    setPending(true)
    try {
      await remove({ data: { id: provider.id } })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Identity provider removed.')
      await navigate({
        to: '/admin/settings/security/authentication',
        search: { tab: 'sign-in' },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the identity provider.')
      setPending(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div id="danger" className="scroll-mt-6">
      <SettingsCard
        title="Remove this provider"
        description="Sign-in through this provider stops working and its verified domains are released."
        variant="danger"
        contentClassName="space-y-4"
      >
        <p className="text-sm text-muted-foreground">
          {accountCount === 0
            ? 'Nobody signs in through this provider yet.'
            : `${accountCount} ${accountCount === 1 ? 'account is' : 'accounts are'} linked to this provider.`}
        </p>
        {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
        <div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={pending || !!blockedReason}
          >
            <TrashIcon className="mr-1.5 h-4 w-4" />
            Remove
          </Button>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${provider.label}?`}
        description="Sign-in through this provider stops working and its verified domains are released."
        variant="destructive"
        confirmLabel="Remove"
        isPending={pending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
