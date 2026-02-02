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
import { oklchToHex, type ThemeVariables, type ParsedCssVariables } from '@/lib/shared/theme'
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
  lightVars: ThemeVariables
  darkVars: ThemeVariables
  previewMode: 'light' | 'dark'
  radius?: string
  fontFamily?: string
  logoUrl?: string | null
  workspaceName?: string
  /** CSS variables extracted from custom CSS (for advanced mode live preview) */
  customCssVariables?: ParsedCssVariables
}

export function ThemePreview({
  lightVars,
  darkVars,
  previewMode,
  radius = '0.625rem',
  fontFamily,
  logoUrl,
  workspaceName = 'Acme Feedback',
  customCssVariables,
}: ThemePreviewProps) {
  const vars = previewMode === 'light' ? lightVars : darkVars
  const customVars = customCssVariables?.[previewMode] ?? {}

  // Convert OKLCH to hex for CSS custom properties
  const cssVars = useMemo(() => {
    const safeHex = (oklch: string | undefined, fallback: string) => {
      if (!oklch) return fallback
      try {
        return oklchToHex(oklch)
      } catch {
        return fallback
      }
    }

    // Base colors
    const background = safeHex(vars.background, previewMode === 'light' ? '#ffffff' : '#0a0a0a')
    const foreground = safeHex(vars.foreground, previewMode === 'light' ? '#171717' : '#fafafa')
    const card = safeHex(vars.card, previewMode === 'light' ? '#ffffff' : '#171717')
    const cardForeground = safeHex(
      vars.cardForeground,
      previewMode === 'light' ? '#171717' : '#fafafa'
    )
    const primary = safeHex(vars.primary, '#3b82f6')
    const primaryForeground = safeHex(vars.primaryForeground, '#ffffff')
    const muted = safeHex(vars.muted, previewMode === 'light' ? '#f5f5f5' : '#262626')
    const mutedForeground = safeHex(
      vars.mutedForeground,
      previewMode === 'light' ? '#737373' : '#a3a3a3'
    )
    const border = safeHex(vars.border, previewMode === 'light' ? '#e5e5e5' : '#262626')

    return {
      // Global variables
      '--background': background,
      '--foreground': foreground,
      '--card': card,
      '--card-foreground': cardForeground,
      '--primary': primary,
      '--primary-foreground': primaryForeground,
      '--secondary': safeHex(vars.secondary, previewMode === 'light' ? '#f5f5f5' : '#262626'),
      '--secondary-foreground': safeHex(
        vars.secondaryForeground,
        previewMode === 'light' ? '#171717' : '#fafafa'
      ),
      '--muted': muted,
      '--muted-foreground': mutedForeground,
      '--border': border,
      '--accent': safeHex(vars.accent, previewMode === 'light' ? '#f5f5f5' : '#262626'),
      '--destructive': safeHex(vars.destructive, '#ef4444'),
      '--success': safeHex(vars.success, '#22c55e'),
      '--radius': radius,
      // Component-level variables with fallbacks to global colors
      '--header-background': background,
      '--header-foreground': foreground,
      '--header-border': border,
      '--post-card-background': card,
      '--post-card-border': border,
      '--post-card-voted-color': primary,
      '--nav-active-background': muted,
      '--nav-active-foreground': foreground,
      '--nav-inactive-color': mutedForeground,
      '--portal-button-background': primary,
      '--portal-button-foreground': primaryForeground,
    }
  }, [vars, previewMode, radius])

  // Merge custom CSS variables (from advanced mode) with generated theme variables
  // Custom CSS variables take precedence to enable live preview in advanced mode
  const effectiveCssVars = useMemo(() => {
    return { ...cssVars, ...customVars }
  }, [cssVars, customVars])

  // Get Google Fonts URL for live preview
  const googleFontsUrl = useMemo(() => getGoogleFontsUrl(fontFamily), [fontFamily])

  return (
    <>
      {/* Load Google Font for preview */}
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      <div
        className="rounded-lg border overflow-hidden"
        style={
          {
            ...effectiveCssVars,
            backgroundColor: 'var(--background)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
            fontFamily: fontFamily || 'Inter, ui-sans-serif, system-ui, sans-serif',
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
