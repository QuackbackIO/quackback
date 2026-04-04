import { useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { GlobeAltIcon } from '@heroicons/react/24/solid'
import { settingsQueries } from '@/lib/client/queries/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'

export const Route = createFileRoute('/admin/settings/portal')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: PortalGeneralPage,
})

interface FeatureToggleProps {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

function FeatureToggle({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: FeatureToggleProps) {
  return (
    <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
      <div className="pr-4">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

function PortalGeneralPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const [isPending, startTransition] = useTransition()

  const features = portalConfigQuery.data.features

  const [publicView, setPublicView] = useState(features?.publicView ?? true)
  const [submissions, setSubmissions] = useState(features?.submissions ?? true)
  const [comments, setComments] = useState(features?.comments ?? true)
  const [voting, setVoting] = useState(features?.voting ?? true)

  async function updateFeature(key: string, value: boolean, revert: () => void) {
    try {
      await updatePortalConfigFn({ data: { features: { [key]: value } } })
      startTransition(() => {
        router.invalidate()
      })
    } catch {
      revert()
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={GlobeAltIcon}
        title="Portal"
        description="Configure the public feedback portal for your users"
      />

      <SettingsCard
        title="Visibility"
        description="Control who can access the feedback portal and what they can do."
      >
        <div className="divide-y divide-border/50">
          <FeatureToggle
            id="public-view"
            label="Public View"
            description="Allow unauthenticated visitors to view posts without signing in."
            checked={publicView}
            onCheckedChange={(checked) => {
              setPublicView(checked)
              updateFeature('publicView', checked, () => setPublicView(!checked))
            }}
            disabled={isPending}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="User Actions"
        description="Control what authenticated users can do in the portal."
      >
        <div className="divide-y divide-border/50">
          <FeatureToggle
            id="submissions"
            label="Submissions"
            description="Allow users to submit new feedback posts."
            checked={submissions}
            onCheckedChange={(checked) => {
              setSubmissions(checked)
              updateFeature('submissions', checked, () => setSubmissions(!checked))
            }}
            disabled={isPending}
          />
          <FeatureToggle
            id="comments"
            label="Comments"
            description="Allow users to comment on posts."
            checked={comments}
            onCheckedChange={(checked) => {
              setComments(checked)
              updateFeature('comments', checked, () => setComments(!checked))
            }}
            disabled={isPending}
          />
          <FeatureToggle
            id="voting"
            label="Voting"
            description="Allow users to vote on posts."
            checked={voting}
            onCheckedChange={(checked) => {
              setVoting(checked)
              updateFeature('voting', checked, () => setVoting(!checked))
            }}
            disabled={isPending}
          />
        </div>
      </SettingsCard>
    </div>
  )
}
