/**
 * Brand SVGs for the OIDC identity providers we list in the SSO setup
 * empty-state and surface in the configured-form header. SVG paths
 * come from Simple Icons (CC0 / brand-fair-use marks). Microsoft is
 * the official multicolour 4-square mark; Google is the wordmark "G".
 */

import type { ComponentType } from 'react'
import { cn } from '@/lib/shared/utils'

interface IconProps {
  className?: string
}

type IdpKind = 'okta' | 'auth0' | 'keycloak' | 'entra' | 'google' | 'other'

export function OktaIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.389 0 0 5.35 0 12s5.35 12 12 12 12-5.35 12-12S18.611 0 12 0zm0 18c-3.325 0-6-2.675-6-6s2.675-6 6-6 6 2.675 6 6-2.675 6-6 6z" />
    </svg>
  )
}

export function Auth0Icon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.98 7.448L19.62 0H4.347L2.02 7.448c-1.352 4.312.03 9.206 3.815 12.015L12.007 24l6.157-4.552c3.755-2.81 5.182-7.688 3.815-12.015l-6.16 4.58 2.343 7.45-6.157-4.597-6.158 4.58 2.358-7.433-6.188-4.55 7.63-.045L12.008 0l2.356 7.404 7.615.044z" />
    </svg>
  )
}

export function KeycloakIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="m18.742 1.182-12.493.002C4.155 4.784 2.079 8.393 0 12.002c2.071 3.612 4.162 7.214 6.252 10.816l12.49-.004 3.089-5.404h2.158v-.002H24L23.996 6.59h-2.168zM8.327 4.792h2.081l1.04 1.8-3.12 5.413 3.117 5.403-1.035 1.81H8.327a2047.566 2047.566 0 0 0-4.168-7.204C5.547 9.606 6.937 7.2 8.327 4.792Zm6.241 0 2.086.003c1.393 2.405 2.78 4.813 4.166 7.222l-4.167 7.2h-2.08c-.382-.562-1.038-1.808-1.038-1.808l3.123-5.405-3.124-5.413z" />
    </svg>
  )
}

export function MicrosoftEntraIcon({ className }: IconProps) {
  // The Microsoft 4-square brand mark — the canonical mark across all
  // Microsoft SSO docs (Entra, Azure AD).
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

export function GoogleWorkspaceIcon({ className }: IconProps) {
  // The Google "G" mark — same shape Google Workspace uses in their
  // brand guidelines. Multi-coloured by default.
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

/** Generic placeholder for "Other OIDC" / unrecognised provider names. */
export function GenericOidcIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 1l3.09 6.26L22 8.27l-5 4.87 1.18 6.88L12 16.77l-6.18 3.25L7 13.14 2 8.27l6.91-1.01L12 1z" />
    </svg>
  )
}

/**
 * Map an `IdpKind` (already inferred from the discovery URL by
 * `inferIdpKind`) to a brand icon. Returns `null` for `'other'` so
 * the caller falls back to a letter avatar.
 *
 * Keyed on the structured kind rather than user-typed display names
 * so "Acme Okta" / "Microsoft Login" don't accidentally match the
 * wrong brand by substring.
 */
export const IDP_KIND_ICONS: Partial<
  Record<'okta' | 'auth0' | 'keycloak' | 'entra' | 'google', ComponentType<IconProps>>
> = {
  okta: OktaIcon,
  auth0: Auth0Icon,
  keycloak: KeycloakIcon,
  entra: MicrosoftEntraIcon,
  google: GoogleWorkspaceIcon,
}

/** Brand tint for the monochrome marks. Entra + Google carry their own
 *  multicolour fills; Keycloak + Custom OIDC stay on the foreground colour. */
export const IDP_KIND_ICON_COLOR: Partial<Record<IdpKind, string>> = {
  okta: 'text-[#007DC1]',
  auth0: 'text-[#EB5424]',
}

/** Resolve the brand mark for a kind; `other` (and any unknown) gets the
 *  generic OIDC glyph. */
export function getIdpKindIcon(kind: IdpKind): ComponentType<IconProps> {
  return IDP_KIND_ICONS[kind as keyof typeof IDP_KIND_ICONS] ?? GenericOidcIcon
}

/**
 * Brand logo in a rounded tile — shared by the IdP shortcut picker and the
 * provider list so a given IdP looks identical in both places. Size the tile
 * via `className` and the glyph via `iconClassName`.
 */
export function IdpLogo({
  kind,
  className,
  iconClassName,
}: {
  kind: IdpKind
  className?: string
  iconClassName?: string
}) {
  const Icon = getIdpKindIcon(kind)
  return (
    <span
      className={cn('flex items-center justify-center rounded-lg bg-muted', className)}
      aria-hidden
    >
      <Icon className={cn(IDP_KIND_ICON_COLOR[kind], iconClassName)} />
    </span>
  )
}
