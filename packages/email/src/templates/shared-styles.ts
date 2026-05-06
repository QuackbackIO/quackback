/**
 * Shared email styles for Quackback emails
 *
 * Ensures consistent branding across all email templates.
 * Colors are derived from the app's design system.
 */

export const DEFAULT_LOGO_URL = 'https://quackback.io/logo.png'

// Brand colors (converted from oklch to hex for email compatibility)
export const colors = {
  // Primary gold - oklch(0.886 0.176 86) ≈ #FFD43B
  primary: '#FFD43B',
  primaryDark: '#F2C230',

  // Text colors
  heading: '#0f172a', // slate-900
  text: '#334155', // slate-700
  textMuted: '#64748b', // slate-500
  textLight: '#94a3b8', // slate-400

  // Background colors
  background: '#f8fafc', // slate-50
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9', // slate-100

  // Border
  border: '#e2e8f0', // slate-200
}

// Common layout styles
export const layout = {
  main: {
    backgroundColor: colors.background,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  container: {
    backgroundColor: colors.surface,
    padding: '48px 32px',
    maxWidth: '560px',
    borderRadius: '12px',
  },
}

// Typography styles
export const typography = {
  h1: {
    color: colors.heading,
    fontSize: '24px',
    fontWeight: '700' as const,
    lineHeight: '32px',
    marginTop: '0',
    marginBottom: '8px',
  },
  h2: {
    color: colors.heading,
    fontSize: '20px',
    fontWeight: '600' as const,
    lineHeight: '28px',
    marginTop: '0',
    marginBottom: '8px',
  },
  text: {
    color: colors.text,
    fontSize: '16px',
    lineHeight: '26px',
    marginTop: '0',
    marginBottom: '24px',
  },
  textSmall: {
    color: colors.textMuted,
    fontSize: '14px',
    lineHeight: '22px',
    marginTop: '0',
    marginBottom: '16px',
  },
  footer: {
    color: colors.textLight,
    fontSize: '13px',
    lineHeight: '20px',
    marginTop: '32px',
    marginBottom: '0',
    textAlign: 'center' as const,
  },
}

// Button styles
export const button = {
  primary: {
    backgroundColor: colors.primary,
    borderRadius: '8px',
    color: '#09090b',
    fontSize: '16px',
    fontWeight: '600',
    padding: '14px 28px',
    textDecoration: 'none',
    display: 'inline-block',
  },
}

// Utility styles
export const utils = {
  divider: {
    borderTop: `1px solid ${colors.border}`,
    marginTop: '32px',
    marginBottom: '32px',
  },
  link: {
    color: '#b45309',
    textDecoration: 'none',
  },
  codeBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: '8px',
    border: `1px solid ${colors.border}`,
    padding: '24px',
    textAlign: 'center' as const,
  },
  code: {
    color: colors.heading,
    fontSize: '32px',
    fontWeight: '700' as const,
    letterSpacing: '0.2em',
    fontFamily: 'monospace',
    marginTop: '0',
    marginBottom: '0',
  },
}

// Logo/branding
export const branding = {
  logoContainer: {
    textAlign: 'center' as const,
    paddingBottom: '32px',
  },
  logo: {
    width: 48,
    height: 48,
    display: 'block' as const,
    margin: '0 auto',
  },
  appName: {
    color: colors.heading,
    fontSize: '18px',
    fontWeight: '700',
    marginTop: '12px',
    marginBottom: '0',
    textAlign: 'center' as const,
  },
}
