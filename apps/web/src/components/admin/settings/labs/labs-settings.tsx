import { BeakerIcon } from '@heroicons/react/24/solid'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/shared/page-header'
import { useSetWorkspaceExperimentEnabled } from '@/lib/client/mutations/settings'
import type { VisibleExperiment } from '@/lib/shared/labs'

interface LabsSettingsProps {
  experiments: VisibleExperiment[]
}

export function LabsSettings({ experiments }: LabsSettingsProps) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={BeakerIcon}
        title="Labs"
        description="Try features we’re still refining. You can turn them off at any time."
      />

      {experiments.length === 0 ? (
        <SettingsCard>
          <p className="text-sm text-muted-foreground">No experiments are available right now.</p>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <ul className="divide-y divide-border/50">
            {experiments.map((experiment) => (
              <li key={experiment.id}>
                <LabsExperimentRow experiment={experiment} />
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
    </div>
  )
}

function LabsExperimentRow({ experiment }: { experiment: VisibleExperiment }) {
  const router = useRouter()
  const mutation = useSetWorkspaceExperimentEnabled()
  const switchId = `labs-${experiment.id}`
  const pending = mutation.isPending

  return (
    <div className="flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={switchId} className="cursor-pointer text-sm font-medium">
          {experiment.title}
        </Label>
        <p className="text-sm text-muted-foreground">{experiment.description}</p>
        <p className="text-xs text-muted-foreground">
          Applies to your team, public portal, and Messenger.
        </p>
      </div>
      <Switch
        id={switchId}
        checked={experiment.enabled}
        disabled={pending}
        aria-label={experiment.title}
        aria-busy={pending}
        onCheckedChange={(enabled) => {
          if (pending || enabled === experiment.enabled) return
          mutation.mutate(
            { experimentId: experiment.id, enabled },
            {
              onSuccess: async () => {
                await router.invalidate()
              },
              onError: (error) => {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Couldn't update this experiment. Try again."
                )
              },
            }
          )
        }}
      />
    </div>
  )
}
