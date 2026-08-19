import type { ComponentType } from 'react'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import { INTEGRATION_UI } from '@/components/admin/settings/integrations/integration-ui'
import { cn } from '@/lib/shared/utils'

// Custom icons for non-integration source types

function ApiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
    </svg>
  )
}

function CsvIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
      <path d="M8 15.01V13h2v-1H8v-1h3v3.01H9V15h2v1H8z" />
    </svg>
  )
}

function EmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
    </svg>
  )
}

/** Source type → icon component (merges custom icons with existing integration icons) */
const SOURCE_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  // widget/quackback uses the logo image, not an SVG icon — handled separately in SourceTypeIcon
  api: ApiIcon,
  csv: CsvIcon,
  email: EmailIcon,
  ...INTEGRATION_ICON_MAP,
}

/** Source types that use the Quackback logo image instead of an SVG icon */
const LOGO_SOURCE_TYPES = new Set(['quackback'])

/** Intrinsic (non-integration) source types — their badge colors live here;
 *  every provider's color is derived from the shared integration manifest. */
const INTRINSIC_SOURCE_COLORS: Record<string, string> = {
  quackback: 'bg-yellow-100 dark:bg-yellow-900/80',
  api: 'bg-violet-100 dark:bg-violet-900/80 text-violet-600 dark:text-violet-400',
  csv: 'bg-amber-100 dark:bg-amber-900/80 text-amber-600 dark:text-amber-400',
  email: 'bg-rose-100 dark:bg-rose-900/80 text-rose-600 dark:text-rose-400',
}

/** Source type → badge color, merging intrinsic sources with manifest-derived provider colors. */
const SOURCE_TYPE_COLORS: Record<string, string> = {
  ...INTRINSIC_SOURCE_COLORS,
  ...Object.fromEntries(
    Object.entries(INTEGRATION_UI)
      .filter(([, m]) => m.badge)
      .map(([id, m]) => [id, m.badge as string])
  ),
}

/** Intrinsic source-type labels; provider labels are derived from the manifest. */
const INTRINSIC_SOURCE_LABELS: Record<string, string> = {
  quackback: 'Quackback',
  api: 'API',
  csv: 'CSV Import',
  email: 'Email',
}

/** Human-readable label for source types (intrinsic + manifest-derived providers). */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  ...INTRINSIC_SOURCE_LABELS,
  ...Object.fromEntries(Object.entries(INTEGRATION_UI).map(([id, m]) => [id, m.displayName])),
}

interface SourceTypeIconProps {
  sourceType: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

const SIZE_CLASSES = {
  xs: { box: 'h-5 w-5', icon: 'h-2.5 w-2.5', logo: 'h-3 w-3', fallback: 'text-xs' },
  sm: { box: 'h-6 w-6', icon: 'h-3 w-3', logo: 'h-4 w-4', fallback: 'text-xs' },
  md: { box: 'h-8 w-8', icon: 'h-4 w-4', logo: 'h-5 w-5', fallback: 'text-xs' },
} as const

/** Renders a source type as a colored icon badge */
export function SourceTypeIcon({ sourceType, size = 'md', className }: SourceTypeIconProps) {
  const isLogo = LOGO_SOURCE_TYPES.has(sourceType)
  const Icon = SOURCE_TYPE_ICONS[sourceType]
  const colorClass = SOURCE_TYPE_COLORS[sourceType] ?? 'bg-muted text-muted-foreground'

  const s = SIZE_CLASSES[size]

  return (
    <div
      className={cn(
        'rounded-md flex items-center justify-center shrink-0',
        s.box,
        colorClass,
        className
      )}
      title={SOURCE_TYPE_LABELS[sourceType] ?? sourceType}
    >
      {isLogo && <img src="/logo.png" alt="Quackback" className={cn('rounded-sm', s.logo)} />}
      {!isLogo && Icon && <Icon className={s.icon} />}
      {!isLogo && !Icon && (
        <span className={cn('font-semibold', s.fallback)}>
          {sourceType.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}

interface SourceTypeStackProps {
  sourceTypes: string[]
  maxVisible?: number
  className?: string
}

/**
 * Renders overlapping source type icons arranged in rows of max 2.
 * Uses both horizontal and vertical space for a compact, scannable layout.
 */
export function SourceTypeStack({ sourceTypes, maxVisible = 4, className }: SourceTypeStackProps) {
  const unique = [...new Set(sourceTypes)]
  const visible = unique.slice(0, maxVisible)
  const remaining = unique.length - maxVisible
  const allItems = remaining > 0 ? [...visible, '+'] : visible

  if (unique.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center h-6 w-6 rounded-md bg-muted', className)}
      >
        <span className="text-xs text-muted-foreground">&mdash;</span>
      </div>
    )
  }

  // Scale icon size: 1 = md (32px), 2+ = sm (24px)
  const iconSize: 'sm' | 'md' = unique.length === 1 ? 'md' : 'sm'
  const overlap = -8

  if (unique.length === 1) {
    return <SourceTypeIcon sourceType={unique[0]} size={iconSize} className={className} />
  }

  // Split into rows of 2
  const rows: (string | '+')[][] = []
  for (let i = 0; i < allItems.length; i += 2) {
    rows.push(allItems.slice(i, i + 2))
  }

  return (
    <div className={cn('inline-flex flex-col', className)}>
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center justify-center"
          style={{ marginTop: rowIdx === 0 ? 0 : overlap, zIndex: rows.length - rowIdx }}
        >
          {row.map((item, i) => {
            if (item === '+') {
              return (
                <div
                  key="+overflow"
                  className={cn(
                    'relative rounded-md bg-muted flex items-center justify-center',
                    SIZE_CLASSES[iconSize].box
                  )}
                  style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: row.length - i }}
                >
                  <span
                    className={cn(
                      'font-medium text-muted-foreground',
                      SIZE_CLASSES[iconSize].fallback
                    )}
                  >
                    +{remaining}
                  </span>
                </div>
              )
            }
            return (
              <div
                key={item}
                className="relative rounded-md"
                style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: row.length - i }}
              >
                <SourceTypeIcon sourceType={item} size={iconSize} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
