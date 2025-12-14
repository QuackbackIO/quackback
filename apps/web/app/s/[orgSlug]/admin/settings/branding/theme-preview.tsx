'use client'

import { useMemo } from 'react'
import {
  ChevronUp,
  MessageSquare,
  Bell,
  User,
  LayoutList,
  Map,
  Megaphone,
  Plus,
  Search,
} from 'lucide-react'
import { oklchToHex, type ThemeVariables } from '@quackback/domain/theme'

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
  organizationName?: string
}

export function ThemePreview({
  lightVars,
  darkVars,
  previewMode,
  radius = '0.625rem',
  fontFamily,
  logoUrl,
  organizationName = 'Acme Feedback',
}: ThemePreviewProps) {
  const vars = previewMode === 'light' ? lightVars : darkVars

  // Convert OKLCH to hex for inline styles
  const colors = useMemo(() => {
    const safeHex = (oklch: string | undefined, fallback: string) => {
      if (!oklch) return fallback
      try {
        return oklchToHex(oklch)
      } catch {
        return fallback
      }
    }

    return {
      background: safeHex(vars.background, previewMode === 'light' ? '#ffffff' : '#0a0a0a'),
      foreground: safeHex(vars.foreground, previewMode === 'light' ? '#171717' : '#fafafa'),
      card: safeHex(vars.card, previewMode === 'light' ? '#ffffff' : '#171717'),
      cardForeground: safeHex(vars.cardForeground, previewMode === 'light' ? '#171717' : '#fafafa'),
      primary: safeHex(vars.primary, '#3b82f6'),
      primaryForeground: safeHex(vars.primaryForeground, '#ffffff'),
      secondary: safeHex(vars.secondary, previewMode === 'light' ? '#f5f5f5' : '#262626'),
      secondaryForeground: safeHex(
        vars.secondaryForeground,
        previewMode === 'light' ? '#171717' : '#fafafa'
      ),
      muted: safeHex(vars.muted, previewMode === 'light' ? '#f5f5f5' : '#262626'),
      mutedForeground: safeHex(
        vars.mutedForeground,
        previewMode === 'light' ? '#737373' : '#a3a3a3'
      ),
      border: safeHex(vars.border, previewMode === 'light' ? '#e5e5e5' : '#262626'),
      accent: safeHex(vars.accent, previewMode === 'light' ? '#f5f5f5' : '#262626'),
      destructive: safeHex(vars.destructive, '#ef4444'),
      success: safeHex(vars.success, '#22c55e'),
    }
  }, [vars, previewMode])

  const style = {
    '--preview-bg': colors.background,
    '--preview-fg': colors.foreground,
    '--preview-card': colors.card,
    '--preview-card-fg': colors.cardForeground,
    '--preview-primary': colors.primary,
    '--preview-primary-fg': colors.primaryForeground,
    '--preview-secondary': colors.secondary,
    '--preview-secondary-fg': colors.secondaryForeground,
    '--preview-muted': colors.muted,
    '--preview-muted-fg': colors.mutedForeground,
    '--preview-border': colors.border,
    '--preview-accent': colors.accent,
    '--preview-destructive': colors.destructive,
    '--preview-success': colors.success,
    '--preview-radius': radius,
    fontFamily: fontFamily || 'Inter, ui-sans-serif, system-ui, sans-serif',
  } as React.CSSProperties

  // Get Google Fonts URL for live preview
  const googleFontsUrl = useMemo(() => getGoogleFontsUrl(fontFamily), [fontFamily])

  return (
    <>
      {/* Load Google Font for preview */}
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          ...style,
          backgroundColor: 'var(--preview-bg)',
          borderColor: 'var(--preview-border)',
          color: 'var(--preview-fg)',
        }}
      >
        <PortalPreview
          colors={colors}
          radius={radius}
          logoUrl={logoUrl}
          organizationName={organizationName}
        />
      </div>
    </>
  )
}

/** Portal preview showing a realistic feedback portal */
function PortalPreview({
  colors,
  radius,
  logoUrl,
  organizationName,
}: {
  colors: Record<string, string>
  radius: string
  logoUrl?: string | null
  organizationName: string
}) {
  return (
    <>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <div
              className="h-6 w-6 rounded flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: colors.primary, color: colors.primaryForeground }}
            >
              {organizationName.charAt(0)}
            </div>
          )}
          <span className="font-semibold text-sm" style={{ color: colors.foreground }}>
            {organizationName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs"
            style={{ backgroundColor: colors.muted, color: colors.mutedForeground }}
          >
            <Search className="h-3 w-3" />
            <span>Search...</span>
          </div>
          <div className="p-1.5 rounded" style={{ color: colors.mutedForeground }}>
            <Bell className="h-4 w-4" />
          </div>
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: colors.muted, color: colors.mutedForeground }}
          >
            <User className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        className="flex items-center gap-1 px-4 py-2 border-b"
        style={{ borderColor: colors.border }}
      >
        <NavTab icon={LayoutList} label="Feedback" active colors={colors} radius={radius} />
        <NavTab icon={Map} label="Roadmap" colors={colors} radius={radius} />
        <NavTab icon={Megaphone} label="Changelog" colors={colors} radius={radius} />
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Post Card 1 */}
        <PostCard
          votes={42}
          hasVoted
          title="Add dark mode support"
          description="Would love to have dark mode for better accessibility..."
          status="In Progress"
          statusColor={colors.primary}
          comments={12}
          colors={colors}
          radius={radius}
        />

        {/* Post Card 2 */}
        <PostCard
          votes={28}
          hasVoted={false}
          title="Mobile app improvements"
          description="The mobile experience could be smoother..."
          status="Planned"
          statusColor={colors.mutedForeground}
          comments={8}
          colors={colors}
          radius={radius}
        />

        {/* Submit Button */}
        <button
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: colors.primary,
            color: colors.primaryForeground,
            borderRadius: radius,
          }}
        >
          <Plus className="h-4 w-4" />
          Submit Feedback
        </button>
      </div>
    </>
  )
}

function NavTab({
  icon: Icon,
  label,
  active = false,
  colors,
  radius,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  colors: Record<string, string>
  radius: string
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium"
      style={{
        backgroundColor: active ? colors.muted : 'transparent',
        color: active ? colors.foreground : colors.mutedForeground,
        borderRadius: radius,
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
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
  colors,
  radius,
}: {
  votes: number
  hasVoted: boolean
  title: string
  description: string
  status: string
  statusColor: string
  comments: number
  colors: Record<string, string>
  radius: string
}) {
  return (
    <div
      className="flex border"
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: radius,
      }}
    >
      {/* Vote section */}
      <div
        className="flex flex-col items-center justify-center px-3 py-2 border-r"
        style={{
          borderColor: colors.border,
          color: hasVoted ? colors.primary : colors.mutedForeground,
        }}
      >
        <ChevronUp className="h-4 w-4" style={hasVoted ? { fill: colors.primary } : undefined} />
        <span
          className="text-xs font-bold"
          style={{ color: hasVoted ? colors.primary : colors.foreground }}
        >
          {votes}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-2 min-w-0">
        {/* Status badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
          <span className="text-[10px] font-medium" style={{ color: colors.foreground }}>
            {status}
          </span>
        </div>

        {/* Title */}
        <h4 className="text-xs font-semibold truncate mb-0.5" style={{ color: colors.foreground }}>
          {title}
        </h4>

        {/* Description */}
        <p className="text-[10px] line-clamp-1 mb-1" style={{ color: colors.mutedForeground }}>
          {description}
        </p>

        {/* Comments */}
        <div className="flex items-center gap-1" style={{ color: colors.mutedForeground }}>
          <MessageSquare className="h-3 w-3" />
          <span className="text-[10px]">{comments}</span>
        </div>
      </div>
    </div>
  )
}
