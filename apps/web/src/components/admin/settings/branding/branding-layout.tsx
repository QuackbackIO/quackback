import { cn } from '@/lib/shared/utils'

interface BrandingLayoutProps {
  children: React.ReactNode
}

/**
 * Main layout for branding page - side-by-side on xl screens, stacked on smaller
 */
export function BrandingLayout({ children }: BrandingLayoutProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr,400px]">{children}</div>
    </div>
  )
}

interface BrandingControlsPanelProps {
  children: React.ReactNode
  className?: string
}

/**
 * Left panel containing all branding controls
 */
export function BrandingControlsPanel({ children, className }: BrandingControlsPanelProps) {
  return (
    <div
      className={cn(
        'xl:border-r border-border flex flex-col min-w-0 divide-y divide-border',
        className
      )}
    >
      {children}
    </div>
  )
}

interface BrandingPreviewPanelProps {
  children: React.ReactNode
  label?: string
  headerRight?: React.ReactNode
}

/**
 * Right panel showing live preview - sticky on desktop
 */
export function BrandingPreviewPanel({
  children,
  label = 'Preview',
  headerRight,
}: BrandingPreviewPanelProps) {
  return (
    <div className="border-t xl:border-t-0 border-border xl:sticky xl:top-4 xl:self-start p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium">{label}</span>
        {headerRight}
      </div>
      {children}
    </div>
  )
}
