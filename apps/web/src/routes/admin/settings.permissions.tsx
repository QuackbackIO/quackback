import { useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { ShieldCheckIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'

export const Route = createFileRoute('/admin/settings/permissions')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: PermissionsPage,
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
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  )
}

function PermissionsPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const [isPending, startTransition] = useTransition()

  const features = portalConfigQuery.data.features
  const [anonPosting, setAnonPosting] = useState(features?.anonymousPosting ?? false)
  const [anonCommenting, setAnonCommenting] = useState(features?.anonymousCommenting ?? false)
  const [anonVoting, setAnonVoting] = useState(features?.anonymousVoting ?? true)
  const [richMediaInPosts, setRichMediaInPosts] = useState(features?.richMediaInPosts ?? true)
  const [videoEmbedsInPosts, setVideoEmbedsInPosts] = useState(features?.videoEmbedsInPosts ?? true)
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

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="Permissions"
        description="Change who can post, comment and upvote under your organization."
      />

      <SettingsCard
        title="Anonymous Access"
        description="Control what actions visitors can take without signing in. Anonymous users cannot receive notifications."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="anon-posting"
            label="Anonymous Posting"
            description="Anyone can create submissions without authenticating."
            checked={anonPosting}
            saving={savingField === 'anonymousPosting'}
            onCheckedChange={(checked) => {
              setAnonPosting(checked)
              updateFeature('anonymousPosting', checked, () => setAnonPosting(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="anon-commenting"
            label="Anonymous Commenting"
            description="Users will be able to comment on posts without signing in."
            checked={anonCommenting}
            saving={savingField === 'anonymousCommenting'}
            onCheckedChange={(checked) => {
              setAnonCommenting(checked)
              updateFeature('anonymousCommenting', checked, () => setAnonCommenting(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="anon-voting"
            label="Anonymous Upvoting"
            description="Users will be able to upvote posts without having to sign in."
            checked={anonVoting}
            saving={savingField === 'anonymousVoting'}
            onCheckedChange={(checked) => {
              setAnonVoting(checked)
              updateFeature('anonymousVoting', checked, () => setAnonVoting(!checked))
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Content"
        description="Control what rich content types are available when creating and editing posts."
      >
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="rich-media-in-posts"
            label="Rich Media in Posts"
            description="Allow images, tables, and embedded videos when writing feedback posts."
            checked={richMediaInPosts}
            saving={savingField === 'richMediaInPosts'}
            onCheckedChange={(checked) => {
              setRichMediaInPosts(checked)
              updateFeature('richMediaInPosts', checked, () => setRichMediaInPosts(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="video-embeds-in-posts"
            label="Video Embeds in Posts"
            description="Allow YouTube and other video embeds inside post content. Only applies when rich media is enabled."
            checked={videoEmbedsInPosts}
            saving={savingField === 'videoEmbedsInPosts'}
            onCheckedChange={(checked) => {
              setVideoEmbedsInPosts(checked)
              updateFeature('videoEmbedsInPosts', checked, () => setVideoEmbedsInPosts(!checked))
            }}
            disabled={isBusy || !richMediaInPosts}
          />
        </div>
      </SettingsCard>
    </div>
  )
}
