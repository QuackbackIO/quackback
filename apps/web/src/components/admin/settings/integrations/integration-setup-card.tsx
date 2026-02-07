import type { ReactNode } from 'react'

interface IntegrationSetupCardProps {
  icon: ReactNode
  title: string
  description: string
  steps: ReactNode[]
  connectionForm: ReactNode
}

export function IntegrationSetupCard({
  icon,
  title,
  description,
  steps,
  connectionForm,
}: IntegrationSetupCardProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div>
          <h3 className="font-medium text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="mt-6 space-y-4 text-sm text-muted-foreground">
        {steps.map((step, index) => (
          <div key={index} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {index + 1}
            </span>
            <div>{step}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-border/50 pt-6">{connectionForm}</div>
    </div>
  )
}
