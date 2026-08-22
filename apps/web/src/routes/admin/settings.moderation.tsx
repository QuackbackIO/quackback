import { useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateModerationDefault } from '@/lib/client/mutations/settings'
import { ShieldCheckIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import {
  requireApprovalToToggles,
  togglesToRequireApproval,
  type ApprovalToggles,
} from '@/lib/shared/moderation-policy'
import { isProductEnabled } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/moderation')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MODERATION)

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: ModerationPage,
})

interface PermissionToggleProps {
  id: string
  label: string
  checked: boolean
  saving?: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

function PermissionToggle({
  id,
  label,
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
      </div>
      <div className="flex items-center gap-2">
        {saving && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  )
}

export function ModerationPage() {
  const router = useRouter()
  const updateModerationDefault = useUpdateModerationDefault()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const [isPending, startTransition] = useTransition()

  // Moderation toggles
  const [moderationToggles, setModerationToggles] = useState<ApprovalToggles>(() =>
    requireApprovalToToggles(portalConfigQuery.data.moderationDefault?.requireApproval ?? 'none')
  )
  const [holdImages, setHoldImages] = useState(
    portalConfigQuery.data.moderationDefault?.holdImages === true
  )
  const [holdLinks, setHoldLinks] = useState(
    portalConfigQuery.data.moderationDefault?.holdLinks === true
  )

  const [savingField, setSavingField] = useState<string | null>(null)

  async function updateModeration(key: keyof ApprovalToggles, checked: boolean) {
    const prev = moderationToggles
    const next = { ...moderationToggles, [key]: checked }
    setModerationToggles(next)
    setSavingField(`moderation-${key}`)
    try {
      await updateModerationDefault.mutateAsync({
        requireApproval: togglesToRequireApproval(next),
      })
      startTransition(() => router.invalidate())
    } catch {
      setModerationToggles(prev)
    } finally {
      setSavingField(null)
    }
  }

  async function updateContentHold(key: 'holdImages' | 'holdLinks', checked: boolean) {
    const setFlag = key === 'holdImages' ? setHoldImages : setHoldLinks
    setFlag(checked)
    setSavingField(`moderation-${key}`)
    try {
      await updateModerationDefault.mutateAsync({
        requireApproval: togglesToRequireApproval(moderationToggles),
        [key]: checked,
      })
      startTransition(() => router.invalidate())
    } catch {
      setFlag(!checked)
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
        description="Approval rules and content review for incoming posts and comments."
      />

      <SettingsCard
        title="Approval rules"
        description="Posts from the selected groups wait for review before publishing."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="moderate-anonymous"
            label="Require approval for anonymous posts"
            checked={moderationToggles.anonymous}
            saving={savingField === 'moderation-anonymous'}
            onCheckedChange={(checked) => updateModeration('anonymous', checked)}
            disabled={isBusy}
          />
          <PermissionToggle
            id="moderate-authenticated"
            label="Require approval for signed-in posts"
            checked={moderationToggles.authenticated}
            saving={savingField === 'moderation-authenticated'}
            onCheckedChange={(checked) => updateModeration('authenticated', checked)}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Content review"
        description="Hold submissions that include media or outbound links for review."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="moderate-images"
            label="Hold posts and comments that contain images"
            checked={holdImages}
            saving={savingField === 'moderation-holdImages'}
            onCheckedChange={(checked) => updateContentHold('holdImages', checked)}
            disabled={isBusy}
          />
          <PermissionToggle
            id="moderate-links"
            label="Hold posts and comments that contain links"
            checked={holdLinks}
            saving={savingField === 'moderation-holdLinks'}
            onCheckedChange={(checked) => updateContentHold('holdLinks', checked)}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>
    </div>
  )
}
