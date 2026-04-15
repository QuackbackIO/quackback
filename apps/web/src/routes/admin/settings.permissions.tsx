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

  // Portal access
  const [publicView, setPublicView] = useState(features?.publicView ?? true)

  // Action toggles — signed-in + anonymous per action
  const [submissions, setSubmissions] = useState(features?.submissions ?? true)
  const [anonPosting, setAnonPosting] = useState(features?.anonymousPosting ?? false)
  const [comments, setComments] = useState(features?.comments ?? true)
  const [anonCommenting, setAnonCommenting] = useState(features?.anonymousCommenting ?? false)
  const [voting, setVoting] = useState(features?.voting ?? true)
  const [anonVoting, setAnonVoting] = useState(features?.anonymousVoting ?? true)

  // Content toggles
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
        description="Control who can access your portal and what they can do."
      />

      <SettingsCard title="Portal access" description="Who can see your feedback portal.">
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="public-view"
            label="Public view"
            description="Let anyone browse posts without signing in."
            checked={publicView}
            saving={savingField === 'publicView'}
            onCheckedChange={(checked) => {
              setPublicView(checked)
              updateFeature('publicView', checked, () => setPublicView(!checked))
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Submissions" description="Who can create new posts.">
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="submissions"
            label="Signed-in users can submit"
            description="Allow users to submit new posts."
            checked={submissions}
            saving={savingField === 'submissions'}
            onCheckedChange={(checked) => {
              setSubmissions(checked)
              updateFeature('submissions', checked, () => setSubmissions(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="anon-posting"
            label="Anonymous users can submit"
            description="Let visitors submit without an account."
            checked={anonPosting}
            saving={savingField === 'anonymousPosting'}
            onCheckedChange={(checked) => {
              setAnonPosting(checked)
              updateFeature('anonymousPosting', checked, () => setAnonPosting(!checked))
            }}
            disabled={isBusy || !submissions}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Comments" description="Who can comment on posts.">
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="comments"
            label="Signed-in users can comment"
            description="Allow users to comment on posts."
            checked={comments}
            saving={savingField === 'comments'}
            onCheckedChange={(checked) => {
              setComments(checked)
              updateFeature('comments', checked, () => setComments(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="anon-commenting"
            label="Anonymous users can comment"
            description="Let visitors comment without an account."
            checked={anonCommenting}
            saving={savingField === 'anonymousCommenting'}
            onCheckedChange={(checked) => {
              setAnonCommenting(checked)
              updateFeature('anonymousCommenting', checked, () => setAnonCommenting(!checked))
            }}
            disabled={isBusy || !comments}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Voting" description="Who can upvote posts.">
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="voting"
            label="Signed-in users can vote"
            description="Allow users to upvote posts."
            checked={voting}
            saving={savingField === 'voting'}
            onCheckedChange={(checked) => {
              setVoting(checked)
              updateFeature('voting', checked, () => setVoting(!checked))
            }}
            disabled={isBusy}
          />
          <PermissionToggle
            id="anon-voting"
            label="Anonymous users can vote"
            description="Let visitors upvote without an account."
            checked={anonVoting}
            saving={savingField === 'anonymousVoting'}
            onCheckedChange={(checked) => {
              setAnonVoting(checked)
              updateFeature('anonymousVoting', checked, () => setAnonVoting(!checked))
            }}
            disabled={isBusy || !voting}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Post content" description="What users can add to their posts.">
        <div className="divide-y divide-border/50">
          <PermissionToggle
            id="rich-media-in-posts"
            label="Allow images in posts"
            description="Let users attach images when writing posts."
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
            label="Allow videos in posts"
            description="Let users embed YouTube and other videos in posts."
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
