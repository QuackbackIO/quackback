import { useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { ShieldCheckIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { updatePortalConfigFn, updateModerationDefaultFn } from '@/lib/server/functions/settings'
import {
  requireApprovalToToggles,
  togglesToRequireApproval,
  type ApprovalToggles,
} from '@/lib/shared/moderation-policy'

export const Route = createFileRoute('/admin/settings/moderation')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: ModerationPage,
})

interface PermissionToggleProps {
  id: string
  label: string
  description: string
  checked: boolean
  saving?: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

function PermissionToggle({
  id,
  label,
  description,
  checked,
  saving,
  onCheckedChange,
  disabled,
}: PermissionToggleProps) {
  return (
    <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
      <div className="pr-4">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  )
}

function ModerationPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const [isPending, startTransition] = useTransition()

  const features = portalConfigQuery.data.features

  // Workspace-wide master switch for anonymous interaction. Collapsed
  // in migration 0084 from the legacy anonymousVoting / Commenting /
  // Posting trio — per-board access tiers carry the finer-grained
  // restrictions now (see BoardAccessForm).
  const [allowAnonymous, setAllowAnonymous] = useState(features?.allowAnonymous ?? true)

  // Moderation toggles
  const [moderationToggles, setModerationToggles] = useState<ApprovalToggles>(() =>
    requireApprovalToToggles(portalConfigQuery.data.moderationDefault?.requireApproval ?? 'none')
  )

  const [savingField, setSavingField] = useState<string | null>(null)

  async function updateFeature(key: string, value: boolean, revert: () => void) {
    setSavingField(key)
    try {
      await updatePortalConfigFn({ data: { features: { [key]: value } } })
      startTransition(() => {
        router.invalidate()
      })
    } catch {
      revert()
    } finally {
      setSavingField(null)
    }
  }

  async function updateModeration(key: keyof ApprovalToggles, checked: boolean) {
    const prev = moderationToggles
    const next = { ...moderationToggles, [key]: checked }
    setModerationToggles(next)
    setSavingField(`moderation-${key}`)
    try {
      await updateModerationDefaultFn({
        data: { requireApproval: togglesToRequireApproval(next) },
      })
      startTransition(() => router.invalidate())
    } catch {
      setModerationToggles(prev)
    } finally {
      setSavingField(null)
    }
  }

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="Moderation"
        description="Anonymous access and approval rules for incoming posts."
      />

      <SettingsCard
        title="Anonymous access"
        description="Control whether visitors without an account can interact with your portal."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="allow-anonymous"
            label="Allow anonymous interaction"
            description="When off, all boards require sign-in for voting, commenting, and submitting posts."
            checked={allowAnonymous}
            saving={savingField === 'allowAnonymous'}
            onCheckedChange={(checked) => {
              setAllowAnonymous(checked)
              updateFeature('allowAnonymous', checked, () => setAllowAnonymous(!checked))
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Approval rules"
        description="Posts from the selected groups wait for review before publishing."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="moderate-anonymous"
            label="Require approval for anonymous posts"
            description="Posts from visitors without an account wait for review before they appear."
            checked={moderationToggles.anonymous}
            saving={savingField === 'moderation-anonymous'}
            onCheckedChange={(checked) => updateModeration('anonymous', checked)}
            disabled={isBusy}
          />
          <PermissionToggle
            id="moderate-authenticated"
            label="Require approval for signed-in posts"
            description="Posts from signed-in portal users wait for review before they appear."
            checked={moderationToggles.authenticated}
            saving={savingField === 'moderation-authenticated'}
            onCheckedChange={(checked) => updateModeration('authenticated', checked)}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>
    </div>
  )
}
