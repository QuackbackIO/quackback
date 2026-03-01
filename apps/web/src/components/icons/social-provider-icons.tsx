/**
 * SVG icons for the top 10 Better Auth social providers.
 * Reuses existing icons where possible, adds new ones from Simple Icons (MIT).
 */

import type { ComponentType } from 'react'
import { DiscordIcon, GitLabIcon } from './integration-icons'

export { DiscordIcon, GitLabIcon }

interface IconProps {
  className?: string
}

export function GitHubIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

export function GoogleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  )
}

export function AppleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 1.092.049 1.543.104v3.218h-1.135c-1.488 0-2.065.563-2.065 2.031v2.205h3.094l-.531 3.667h-2.563v8.168C18.62 23.069 24 18.082 24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.625 3.872 10.35 9.101 11.691" />
    </svg>
  )
}

export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

export function MicrosoftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 0h11.377v11.377H0zm12.623 0H24v11.377H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623" />
    </svg>
  )
}

export function RedditIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 6.628 5.373 12 12 12s12-5.372 12-12c0-6.627-5.373-12-12-12zm6.526 14.558c-.072.413-.265.78-.529 1.075.07.32.106.653.106.994 0 3.404-3.96 6.165-8.845 6.165S.413 20.03.413 16.627c0-.352.037-.697.11-1.03a2.015 2.015 0 0 1-.472-1.028 2.02 2.02 0 0 1 .593-1.633 2.02 2.02 0 0 1 1.633-.593c.396.026.775.177 1.09.43 1.527-1.02 3.513-1.648 5.676-1.694l1.275-4.319a.476.476 0 0 1 .582-.313l3.447.82a1.68 1.68 0 0 1 3.155.793c0 .927-.752 1.68-1.68 1.68s-1.68-.753-1.68-1.68l-3.087-.735-1.112 3.77c2.14.06 4.097.69 5.594 1.696.318-.262.705-.418 1.11-.445a2.02 2.02 0 0 1 1.633.593c.434.452.63 1.07.593 1.633zM8.24 14.136c-.927 0-1.68.753-1.68 1.68s.753 1.68 1.68 1.68 1.68-.753 1.68-1.68-.753-1.68-1.68-1.68zm7.68 1.68c0-.927-.753-1.68-1.68-1.68s-1.68.753-1.68 1.68.753 1.68 1.68 1.68 1.68-.753 1.68-1.68zm-.448 3.477c-.86.86-2.487 1.154-3.473 1.154s-2.612-.293-3.472-1.154a.438.438 0 0 1 .62-.62c.624.623 1.913.842 2.852.842.94 0 2.228-.219 2.852-.842a.438.438 0 1 1 .62.62z" />
    </svg>
  )
}

export function TwitterIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  )
}

export function CustomOidcIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.4 9.07-7 10.16-3.6-1.09-7-5.33-7-10.16V6.3l7-3.12zM11 7v2H9v2h2v2h2v-2h2V9h-2V7h-2z" />
    </svg>
  )
}

// Map from auth provider ID to icon component
export const AUTH_PROVIDER_ICON_MAP: Record<string, ComponentType<IconProps>> = {
  apple: AppleIcon,
  discord: DiscordIcon,
  facebook: FacebookIcon,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  google: GoogleIcon,
  linkedin: LinkedInIcon,
  microsoft: MicrosoftIcon,
  reddit: RedditIcon,
  twitter: TwitterIcon,
  'custom-oidc': CustomOidcIcon,
}

export type { IconProps }
