import { useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { LockClosedIcon, GlobeAltIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { PortalPrivacyDialog } from '@/components/admin/settings/portal-privacy-dialog'
import { updatePortalAccessFn } from '@/lib/server/functions/portal-access'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/settings/access')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: AccessPage,
})

// ---------------------------------------------------------------------------
// Visibility card
// ---------------------------------------------------------------------------

interface VisibilityOption {
  value: 'public' | 'private'
  label: string
  description: string
  icon: typeof LockClosedIcon
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your portal without signing in.',
    icon: GlobeAltIcon,
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Visitors must be authorized to view the portal.',
    icon: LockClosedIcon,
  },
]

function AccessPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const [isPending, startTransition] = useTransition()

  const current = (portalConfigQuery.data.access?.visibility ?? 'public') as 'public' | 'private'
  const [visibility, setVisibility] = useState<'public' | 'private'>(current)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Holds the pending value while the confirmation dialog is open
  const [pendingVisibility, setPendingVisibility] = useState<'public' | 'private' | null>(null)

  const isBusy = saving || isPending

  async function applyVisibility(next: 'public' | 'private') {
    const prev = visibility
    setVisibility(next)
    setSaving(true)
    try {
      await updatePortalAccessFn({ data: { visibility: next } })
      startTransition(() => {
        router.invalidate()
      })
    } catch {
      // Revert optimistic update on error
      setVisibility(prev)
    } finally {
      setSaving(false)
    }
  }

  function handleSelect(next: 'public' | 'private') {
    if (next === visibility || isBusy) return

    if (next === 'private') {
      // Show confirmation before switching to private
      setPendingVisibility('private')
      setDialogOpen(true)
    } else {
      void applyVisibility('public')
    }
  }

  function handleConfirmPrivate() {
    setDialogOpen(false)
    if (pendingVisibility === 'private') {
      setPendingVisibility(null)
      void applyVisibility('private')
    }
  }

  function handleCancelDialog(open: boolean) {
    if (!open) {
      setPendingVisibility(null)
    }
    setDialogOpen(open)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={LockClosedIcon}
        title="Portal access"
        description="Control who can see your portal."
      />

      {/* Portal visibility — phase 1 */}
      <SettingsCard
        title="Portal visibility"
        description="Choose whether your portal is open to anyone or restricted to authorized visitors."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const isSelected = visibility === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                disabled={isBusy}
                className={cn(
                  'relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border/50 bg-card hover:border-border hover:bg-muted/30',
                  isBusy && 'cursor-not-allowed opacity-60'
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isSelected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                  {saving && isSelected && (
                    <ArrowPathIcon className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      {/*
       * Phase 2 seam — allowed email domains section will be added here.
       * It will only be visible when visibility === 'private'.
       */}

      <PortalPrivacyDialog
        open={dialogOpen}
        onOpenChange={handleCancelDialog}
        onConfirm={handleConfirmPrivate}
      />
    </div>
  )
}
