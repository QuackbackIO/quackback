/**
 * The header's overflow menu — where Remove lives.
 *
 * Removing does not need a card of its own: it is one action, taken rarely,
 * and the confirmation dialog states what it costs before offering it. Both
 * refusals here mirror server-side invariants, not UI politeness: the service
 * refuses to delete a provider with linked accounts, and the "keep one sign-in
 * method" guard refuses to remove the last working one.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EllipsisHorizontalIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { settingsQueries } from '@/lib/client/queries/settings'
import { deleteIdentityProviderFn } from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IDENTITY_PROVIDERS_KEY, SIGN_IN_TAB } from './provider-shared'

export function ProviderMenu({
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
      ? `${accountCount} ${accountCount === 1 ? 'person signs' : 'people sign'} in through this provider. Disable it instead, or remove those accounts first.`
      : null

  const handleDelete = async () => {
    setPending(true)
    try {
      await remove({ data: { id: provider.id } })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Identity provider removed.')
      await navigate(SIGN_IN_TAB)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the identity provider.')
      setPending(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Provider actions">
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => (blockedReason ? toast.error(blockedReason) : setConfirmOpen(true))}
            disabled={pending}
            variant="destructive"
            className="gap-2"
          >
            <TrashIcon className="h-4 w-4" />
            Remove provider
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  )
}
