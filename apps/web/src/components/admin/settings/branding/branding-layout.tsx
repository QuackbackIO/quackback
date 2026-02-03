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
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">{children}</div>
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
        'lg:border-r border-border flex flex-col min-w-0 divide-y divide-border',
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
    <div className="border-t lg:border-t-0 border-border lg:sticky lg:top-4 lg:self-start p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium">{label}</span>
        {headerRight}
      </div>
      {children}
    </div>
  )
}
