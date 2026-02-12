import { useMemo } from 'react'
import {
  ChevronUpIcon,
  ChatBubbleLeftIcon,
  UserIcon,
  PlusIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
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
  logoUrl?: string | null
  workspaceName?: string
  /** Parsed CSS variables from the theme CSS (source of truth) */
  cssVariables: ParsedCssVariables
}

/** Component-level aliases that reference base CSS variables */
const COMPONENT_ALIASES: Record<string, string> = {
  '--header-background': 'var(--background)',
  '--header-foreground': 'var(--foreground)',
  '--header-border': 'var(--border)',
  '--post-card-background': 'var(--card)',
  '--post-card-border': 'var(--border)',
  '--post-card-voted-color': 'var(--primary)',
  '--nav-active-background': 'var(--muted)',
  '--nav-active-foreground': 'var(--foreground)',
  '--nav-inactive-color': 'var(--muted-foreground)',
  '--portal-button-background': 'var(--primary)',
  '--portal-button-foreground': 'var(--primary-foreground)',
}

const DEFAULT_FONT = '"Inter", ui-sans-serif, system-ui, sans-serif'

export function ThemePreview({
  previewMode,
  logoUrl,
  workspaceName = 'Acme Feedback',
  cssVariables,
}: ThemePreviewProps) {
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
        <PortalPreview logoUrl={logoUrl} displayName={workspaceName} />
      </div>
    </>
  )
}

/** Portal preview showing a realistic feedback portal */
function PortalPreview({ logoUrl, displayName }: { logoUrl?: string | null; displayName: string }) {
  return (
    <>
      {/* Header - Two rows */}
      <div className="portal-header py-1.5 border-b border-[var(--header-border)] bg-[var(--header-background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--header-background)]/60">
        {/* Row 1: Logo + Name + Auth */}
        <div>
          <div className="px-4 flex h-10 items-center justify-between">
            <a href="#" className="portal-header__logo flex items-center gap-2">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-7 w-7 object-cover [border-radius:calc(var(--radius)*0.6)]"
                />
              ) : (
                <div className="h-7 w-7 flex items-center justify-center font-semibold text-sm bg-[var(--primary)] text-[var(--primary-foreground)] [border-radius:calc(var(--radius)*0.6)]">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="portal-header__name font-semibold text-sm max-w-[14ch] line-clamp-1 text-[var(--header-foreground)]">
                {displayName}
              </span>
            </a>
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full flex items-center justify-center bg-[var(--muted)] text-[var(--muted-foreground)]">
                <UserIcon className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Navigation */}
        <div>
          <div className="px-4 flex items-center">
            <nav className="portal-nav flex items-center gap-1">
              <NavTab label="Feedback" active />
              <NavTab label="Roadmap" />
            </nav>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Feedback Header Banner */}
        <div
          className="rounded-lg px-5 py-4 shadow-sm"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
          }}
        >
          <h1 className="text-xl font-bold text-[var(--foreground)] tracking-tight">
            Share your feedback
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Help us improve {displayName} by sharing ideas, suggestions, or reporting issues.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          {/* Sort Pills */}
          <div className="flex items-center gap-1">
            <SortPill icon={ArrowTrendingUpIcon} label="Top" active />
            <SortPill icon={ClockIcon} label="New" />
            <SortPill icon={FireIcon} label="Trending" />
          </div>
          {/* Create Post Button */}
          <button className="portal-submit-button inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-[var(--portal-button-background)] text-[var(--portal-button-foreground)] hover:bg-[var(--portal-button-background)]/90">
            <PlusIcon className="h-4 w-4" />
            Create post
          </button>
        </div>

        {/* Post Cards Container */}
        <div
          className="rounded-lg overflow-hidden shadow-md"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
          }}
        >
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
            tags={['Feature', 'UI']}
          />
          {/* Divider between cards */}
          <div
            style={{ borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}
          />
          <PostCard
            votes={28}
            hasVoted={false}
            title="Mobile app improvements"
            description="The mobile experience could be smoother with better touch interactions and faster loading."
            status="Planned"
            comments={8}
            authorName="Emily Davies"
            timeAgo="5 days ago"
            boardName="Mobile"
          />
        </div>
      </div>
    </>
  )
}

function NavTab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <a
      href="#"
      className={cn(
        'portal-nav__item px-3 py-2 text-sm font-medium transition-colors [border-radius:calc(var(--radius)*0.8)]',
        active
          ? 'portal-nav__item--active bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
          : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
      )}
    >
      {label}
    </a>
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
  boardName,
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
  tags?: string[]
  boardName?: string
}) {
  return (
    <a
      href="#"
      className="post-card flex transition-colors bg-[var(--post-card-background)] hover:bg-[var(--post-card-background)]/80"
    >
      {/* Vote section */}
      <button
        type="button"
        className={cn(
          'post-card__vote flex flex-col items-center justify-center w-16 shrink-0 border-r transition-colors',
          hasVoted
            ? 'post-card__vote--voted text-[var(--post-card-voted-color)]'
            : 'text-[var(--muted-foreground)]'
        )}
        style={{
          borderColor: 'color-mix(in srgb, var(--post-card-border) 30%, transparent)',
        }}
      >
        <ChevronUpIcon
          className={cn('h-5 w-5', hasVoted && 'fill-[var(--post-card-voted-color)]')}
        />
        <span className={cn('text-sm font-bold', hasVoted ? '' : 'text-[var(--foreground)]')}>
          {votes}
        </span>
      </button>

      {/* Content section */}
      <div className="post-card__content flex-1 min-w-0 px-4 py-3">
        {/* Status badge */}
        <div className="inline-flex items-center gap-1.5 text-xs font-medium mb-2">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{
              backgroundColor: statusColor || 'var(--muted-foreground)',
            }}
          />
          <span className="text-[var(--foreground)]">{status}</span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-[15px] text-[var(--foreground)] line-clamp-1 mb-1">
          {title}
        </h3>

        {/* Description */}
        <p
          className="text-sm line-clamp-2 mb-2"
          style={{ color: 'color-mix(in srgb, var(--muted-foreground) 80%, transparent)' }}
        >
          {description}
        </p>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-normal bg-[var(--secondary)] text-[var(--secondary-foreground)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2.5 text-xs text-[var(--muted-foreground)]">
          {/* Author avatar */}
          <div className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] bg-[var(--muted)] text-[var(--muted-foreground)]">
            {authorName.charAt(0).toUpperCase()}
          </div>
          {/* Author name */}
          <span
            className="font-medium"
            style={{ color: 'color-mix(in srgb, var(--foreground) 90%, transparent)' }}
          >
            {authorName}
          </span>
          {/* Separator */}
          <span className="text-[var(--muted-foreground)]">·</span>
          {/* Time */}
          <span>{timeAgo}</span>
          {/* Spacer */}
          <div className="flex-1" />
          {/* Comments */}
          <div
            className="flex items-center gap-1"
            style={{ color: 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)' }}
          >
            <ChatBubbleLeftIcon className="h-3.5 w-3.5" />
            <span>{comments}</span>
          </div>
          {/* Board name badge */}
          {boardName && (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-normal"
              style={{ backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)' }}
            >
              {boardName}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}
