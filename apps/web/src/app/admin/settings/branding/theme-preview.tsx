'use client'

import { useMemo } from 'react'
import { ChevronUp, MessageSquare, Bell, User, Plus, TrendingUp, Clock, Flame } from 'lucide-react'
import { oklchToHex, type ThemeVariables } from '@/lib/theme'
import { cn } from '@/lib/utils'

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

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface ThemePreviewProps {
  lightVars: ThemeVariables
  darkVars: ThemeVariables
  previewMode: 'light' | 'dark'
  radius?: string
  fontFamily?: string
  logoUrl?: string | null
  workspaceName?: string
  headerLogoUrl?: string | null
  headerDisplayMode?: HeaderDisplayMode
  /** Custom display name (falls back to workspaceName) */
  headerDisplayName?: string | null
}

export function ThemePreview({
  lightVars,
  darkVars,
  previewMode,
  radius = '0.625rem',
  fontFamily,
  logoUrl,
  workspaceName = 'Acme Feedback',
  headerLogoUrl,
  headerDisplayMode = 'logo_and_name',
  headerDisplayName,
}: ThemePreviewProps) {
  // Use custom display name if provided, otherwise fall back to org name
  const displayName = headerDisplayName || workspaceName
  const vars = previewMode === 'light' ? lightVars : darkVars

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
      '--header-background': safeHex(vars.headerBackground, background),
      '--header-foreground': safeHex(vars.headerForeground, foreground),
      '--header-border': safeHex(vars.headerBorder, border),
      '--post-card-background': safeHex(vars.postCardBackground, card),
      '--post-card-border': safeHex(vars.postCardBorder, border),
      '--post-card-voted-color': safeHex(vars.postCardVotedColor, primary),
      '--nav-active-background': safeHex(vars.navActiveBackground, muted),
      '--nav-active-foreground': safeHex(vars.navActiveForeground, foreground),
      '--nav-inactive-color': safeHex(vars.navInactiveColor, mutedForeground),
      '--portal-button-background': safeHex(vars.portalButtonBackground, primary),
      '--portal-button-foreground': safeHex(vars.portalButtonForeground, primaryForeground),
    }
  }, [vars, previewMode, radius])

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
            ...cssVars,
            backgroundColor: 'var(--background)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
            fontFamily: fontFamily || 'Inter, ui-sans-serif, system-ui, sans-serif',
          } as React.CSSProperties
        }
      >
        <PortalPreview
          logoUrl={logoUrl}
          displayName={displayName}
          headerLogoUrl={headerLogoUrl}
          headerDisplayMode={headerDisplayMode}
        />
      </div>
    </>
  )
}

/** Portal preview showing a realistic feedback portal with BEM classes matching real portal */
function PortalPreview({
  logoUrl,
  displayName,
  headerLogoUrl,
  headerDisplayMode = 'logo_and_name',
}: {
  logoUrl?: string | null
  displayName: string
  headerLogoUrl?: string | null
  headerDisplayMode?: HeaderDisplayMode
}) {
  // Check if using two-row layout (custom header logo)
  const useTwoRowLayout = headerDisplayMode === 'custom_logo' && headerLogoUrl

  // User/auth controls for the header
  const HeaderControls = () => (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded text-[var(--muted-foreground)]">
        <Bell className="h-4 w-4" />
      </div>
      <div className="h-6 w-6 rounded-full flex items-center justify-center bg-[var(--muted)] text-[var(--muted-foreground)]">
        <User className="h-3.5 w-3.5" />
      </div>
    </div>
  )

  // Navigation tabs - using same BEM classes as real portal
  const NavTabs = () => (
    <nav className="portal-nav flex items-center gap-1">
      <NavTab label="Feedback" active />
      <NavTab label="Roadmap" />
    </nav>
  )

  return (
    <>
      {useTwoRowLayout ? (
        // Two-row layout for custom logo: header + nav bar below (matching real portal)
        <div className="portal-header portal-header--two-row bg-[var(--header-background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--header-background)]/60">
          {/* Main header with logo */}
          <header className="portal-header__main border-b border-[var(--header-border)]">
            <div className="px-4">
              <div className="flex h-14 items-center justify-between">
                <a href="#" className="portal-header__logo flex items-center">
                  <img
                    src={headerLogoUrl}
                    alt={displayName}
                    className="h-10 max-w-[240px] object-contain"
                  />
                </a>
                <HeaderControls />
              </div>
            </div>
          </header>
          {/* Navigation below header */}
          <nav className="portal-header__nav-row">
            <div className="px-4">
              <div className="flex items-center py-2">
                <NavTabs />
              </div>
            </div>
          </nav>
        </div>
      ) : (
        // Single-row header matching real portal exactly
        <header className="portal-header border-b border-[var(--header-border)] bg-[var(--header-background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--header-background)]/60">
          <div className="px-4 flex h-14 items-center">
            {/* Logo / Org Name */}
            <a href="#" className="portal-header__logo flex items-center gap-2 mr-6">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-8 w-8 object-cover [border-radius:calc(var(--radius)*0.6)]"
                />
              ) : (
                <div className="h-8 w-8 flex items-center justify-center font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] [border-radius:calc(var(--radius)*0.6)]">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              {(headerDisplayMode === 'logo_and_name' || headerDisplayMode === 'custom_logo') && (
                <span className="portal-header__name font-semibold max-w-[18ch] line-clamp-2 text-[var(--header-foreground)]">
                  {displayName}
                </span>
              )}
            </a>

            {/* Navigation Tabs */}
            <NavTabs />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Auth Controls */}
            <HeaderControls />
          </div>
        </header>
      )}

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Feedback Header Banner - matching FeedbackHeader */}
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

        {/* Toolbar - matching FeedbackToolbar */}
        <div className="flex items-center justify-between gap-4">
          {/* Sort Pills */}
          <div className="flex items-center gap-1">
            <SortPill icon={TrendingUp} label="Top" active />
            <SortPill icon={Clock} label="New" />
            <SortPill icon={Flame} label="Trending" />
          </div>
          {/* Create Post Button */}
          <button className="portal-submit-button inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-[var(--portal-button-background)] text-[var(--portal-button-foreground)] hover:bg-[var(--portal-button-background)]/90">
            <Plus className="h-4 w-4" />
            Create post
          </button>
        </div>

        {/* Post Cards Container - matching real portal structure with same visual treatment */}
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
            authorName="Sarah Chen"
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
            authorName="Alex Kim"
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
      {/* Vote section - matching real portal exactly */}
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
        <ChevronUp className={cn('h-5 w-5', hasVoted && 'fill-[var(--post-card-voted-color)]')} />
        <span className={cn('text-sm font-bold', hasVoted ? '' : 'text-[var(--foreground)]')}>
          {votes}
        </span>
      </button>

      {/* Content section - matching real portal exactly */}
      <div className="post-card__content flex-1 min-w-0 px-4 py-3">
        {/* Status badge - matching StatusBadge component */}
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

        {/* Footer - matching real portal exactly */}
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
            <MessageSquare className="h-3.5 w-3.5" />
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
