import { useMemo } from 'react'
import {
  ChevronUpIcon,
  ChatBubbleLeftIcon,
  ListBulletIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
  PencilIcon,
} from '@heroicons/react/24/solid'
import type { ParsedCssVariables } from '@/lib/shared/theme'
import { cn } from '@/lib/shared/utils'

/** Map font family names to Google Fonts URL */
const GOOGLE_FONT_MAP: Record<string, string> = {
  '"Inter"': 'Inter',
  '"Roboto"': 'Roboto',
  '"Open Sans"': 'Open+Sans',
  '"Lato"': 'Lato',
  '"Montserrat"': 'Montserrat',
  '"Poppins"': 'Poppins',
  '"Nunito"': 'Nunito',
  '"DM Sans"': 'DM+Sans',
  '"Plus Jakarta Sans"': 'Plus+Jakarta+Sans',
  '"Geist"': 'Geist',
  '"Work Sans"': 'Work+Sans',
  '"Raleway"': 'Raleway',
  '"Source Sans 3"': 'Source+Sans+3',
  '"Outfit"': 'Outfit',
  '"Manrope"': 'Manrope',
  '"Space Grotesk"': 'Space+Grotesk',
  '"Playfair Display"': 'Playfair+Display',
  '"Merriweather"': 'Merriweather',
  '"Lora"': 'Lora',
  '"Crimson Text"': 'Crimson+Text',
  '"Fira Code"': 'Fira+Code',
  '"JetBrains Mono"': 'JetBrains+Mono',
}

function getGoogleFontsUrl(fontFamily: string | undefined): string | null {
  if (!fontFamily) return null
  for (const [cssName, googleName] of Object.entries(GOOGLE_FONT_MAP)) {
    if (fontFamily.includes(cssName)) {
      return `https://fonts.googleapis.com/css2?family=${googleName}:wght@400;500;600;700&display=swap`
    }
  }
  return null
}

interface ThemePreviewProps {
  previewMode: 'light' | 'dark'
  /** Parsed CSS variables from the theme CSS (source of truth) */
  cssVariables: ParsedCssVariables
}

/** Component-level aliases that reference base CSS variables */
const COMPONENT_ALIASES: Record<string, string> = {
  '--post-card-background': 'var(--card)',
  '--post-card-border': 'var(--border)',
  '--post-card-voted': 'var(--primary)',
  '--portal-button-background': 'var(--primary)',
  '--portal-button-foreground': 'var(--primary-foreground)',
}

const DEFAULT_FONT = '"Inter", ui-sans-serif, system-ui, sans-serif'

export function ThemePreview({ previewMode, cssVariables }: ThemePreviewProps) {
  const modeVars = cssVariables[previewMode === 'dark' ? 'dark' : 'light']

  const cssVars = useMemo(() => ({ ...modeVars, ...COMPONENT_ALIASES }), [modeVars])

  const fontFamily = modeVars['--font-sans'] || DEFAULT_FONT
  const googleFontsUrl = useMemo(() => getGoogleFontsUrl(fontFamily), [fontFamily])

  return (
    <>
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      <div
        className="rounded-lg border overflow-hidden"
        style={
          {
            ...cssVars,
            backgroundColor: 'var(--background)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
            fontFamily,
          } as React.CSSProperties
        }
      >
        <PortalPreview />
      </div>
    </>
  )
}

/** Portal preview — mirrors the real feedback page layout from
 *  apps/web/src/components/public/feedback/feedback-container.tsx */
function PortalPreview() {
  return (
    <div className="p-4 bg-[var(--background)]">
      <div className="flex gap-4">
        {/* Main column */}
        <div className="flex-1 min-w-0">
          {/* "What's your idea?" collapsed feedback header */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-sm mb-5">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="shrink-0 w-9 h-9 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
                <PencilIcon className="w-4 h-4 text-[var(--primary)]" />
              </div>
              <span className="flex-1 text-base font-semibold text-[var(--muted-foreground)]/60">
                What&apos;s your idea?
              </span>
            </div>
          </div>

          {/* Toolbar: sort pills + Search + Filter */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1">
              <SortPill icon={ArrowTrendingUpIcon} label="Top" active />
              <SortPill icon={ClockIcon} label="New" />
              <SortPill icon={FireIcon} label="Trending" />
            </div>
            <div className="flex items-center gap-2">
              <OutlineButton icon={MagnifyingGlassIcon} label="Search" />
              <OutlineButton icon={AdjustmentsHorizontalIcon} label="Filter" />
            </div>
          </div>

          {/* Posts list — each in its own card */}
          <div className="space-y-3 mt-3">
            <PostCard
              votes={42}
              hasVoted
              title="Add dark mode support"
              description="Would love to have dark mode for better accessibility and reduced eye strain during night usage."
              status="In Progress"
              statusColor="var(--primary)"
              comments={12}
              authorName="James Wilson"
              timeAgo="2 days ago"
              tags={[
                { name: 'Feature', color: '#3b82f6' },
                { name: 'UI', color: '#8b5cf6' },
              ]}
            />
            <PostCard
              votes={28}
              hasVoted={false}
              title="Mobile app improvements"
              description="The mobile experience could be smoother with better touch interactions and faster loading."
              status="Planned"
              statusColor="#f59e0b"
              comments={8}
              authorName="Emily Davies"
              timeAgo="5 days ago"
            />
          </div>
        </div>

        {/* Sidebar — boards list */}
        <aside className="w-52 shrink-0 hidden sm:block">
          <div className="bg-[var(--card)] border border-[var(--border)]/50 rounded-lg shadow-sm overflow-hidden">
            <h2 className="font-semibold text-xs uppercase tracking-wider text-[var(--muted-foreground)] px-4 pt-4 pb-3">
              Boards
            </h2>
            <nav className="space-y-1 px-4 pb-4">
              <BoardPill icon={ListBulletIcon} label="View all posts" active count={42} />
              <BoardPill icon={ChatBubbleLeftIcon} label="Feature Requests" count={18} />
              <BoardPill icon={ChatBubbleLeftIcon} label="Bugs" count={9} />
              <BoardPill icon={ChatBubbleLeftIcon} label="Mobile" count={5} />
            </nav>
          </div>

          {/* Powered by — matches apps/web/src/components/public/feedback/feedback-sidebar.tsx */}
          <div className="flex justify-center mt-3">
            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)] px-2.5 py-1 rounded-full bg-[var(--muted)]/50 border border-transparent">
              <img src="/logo.png" alt="" width={14} height={14} className="-mt-px opacity-60" />
              <span>
                Powered by <span className="font-semibold">Quackback</span>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function SortPill({
  icon: Icon,
  label,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
        active
          ? 'bg-[var(--muted)] text-[var(--foreground)] font-medium'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active && 'text-[var(--primary)]')} />
      {label}
    </button>
  )
}

function OutlineButton({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium border border-[var(--border)]/50 bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)]/40 transition-colors"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function BoardPill({
  icon: Icon,
  label,
  count,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer w-full text-left',
        active
          ? 'bg-[var(--muted)] text-[var(--foreground)] font-medium'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-[var(--primary)]')} />
      <span className="truncate min-w-0 flex-1">{label}</span>
      <span
        className={cn(
          'text-[10px] font-semibold tabular-nums shrink-0',
          active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'
        )}
      >
        {count}
      </span>
    </button>
  )
}

function PostCard({
  votes,
  hasVoted,
  title,
  description,
  status,
  statusColor,
  comments,
  authorName,
  timeAgo,
  tags,
}: {
  votes: number
  hasVoted: boolean
  title: string
  description: string
  status: string
  statusColor?: string
  comments: number
  authorName: string
  timeAgo: string
  tags?: { name: string; color: string }[]
}) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)]/40 rounded-lg overflow-hidden">
      <div className="flex items-start p-4 gap-4">
        {/* Vote button — small rectangle matching the real portal */}
        <button
          type="button"
          className={cn(
            'flex flex-col items-center justify-center shrink-0 rounded-md border transition-colors',
            'w-12 py-2 gap-0.5',
            hasVoted
              ? 'text-[var(--post-card-voted)] border-[var(--post-card-voted)]/60'
              : 'bg-[var(--muted)]/40 text-[var(--muted-foreground)] border-[var(--border)]/50'
          )}
          style={
            hasVoted
              ? {
                  backgroundColor: 'color-mix(in srgb, var(--post-card-voted) 15%, transparent)',
                }
              : undefined
          }
        >
          <ChevronUpIcon className={cn('h-4 w-4', hasVoted && 'fill-[var(--post-card-voted)]')} />
          <span
            className={cn(
              'font-semibold tabular-nums text-sm',
              !hasVoted && 'text-[var(--foreground)]'
            )}
          >
            {votes}
          </span>
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Status badge — matches StatusBadge component */}
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] mb-1">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: statusColor || 'var(--muted-foreground)' }}
            />
            {status}
          </span>

          {/* Title */}
          <h3 className="font-semibold text-base text-[var(--foreground)] line-clamp-1">{title}</h3>

          {/* Description */}
          <p className="text-sm text-[var(--muted-foreground)]/60 line-clamp-1 mt-1">
            {description}
          </p>

          {/* Tags */}
          {tags && tags.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              {tags.map((tag) => (
                <span
                  key={tag.name}
                  className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mt-2.5">
            <span className="text-[var(--foreground)]/80">{authorName}</span>
            <span className="text-[var(--muted-foreground)]/40">·</span>
            <span className="text-[var(--muted-foreground)]/70">{timeAgo}</span>
            <span className="flex items-center gap-1 text-[var(--muted-foreground)]/50 ms-auto">
              <ChatBubbleLeftIcon className="h-3.5 w-3.5" />
              {comments}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
