import type { ReactNode } from 'react'
import { SettingsCard } from '@/components/admin/settings/settings-card'

interface IntegrationSetupCardProps {
  title: string
  description: string
  steps: ReactNode[]
  connectionForm?: ReactNode
}

export function IntegrationSetupCard({
  title,
  description,
  steps,
  connectionForm,
}: IntegrationSetupCardProps) {
  return (
    <SettingsCard title={title} description={description}>
      <div className="space-y-4 text-sm text-muted-foreground">
        {steps.map((step, index) => (
          <div key={index} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {index + 1}
            </span>
            <div>{step}</div>
          </div>
        ))}
      </div>

      {connectionForm ? (
        <div className="mt-6 border-t border-border/50 pt-6">{connectionForm}</div>
      ) : null}
    </SettingsCard>
  )
}
