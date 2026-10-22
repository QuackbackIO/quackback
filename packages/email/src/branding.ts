import { createContext, createElement, useContext, type ReactNode } from 'react'

/**
 * Workspace branding that applies to every email, resolved once per send.
 *
 * `wordmarkUrl` is the portal's horizontal header logo, set when the workspace
 * shows a custom logo in its portal header. When present, the email header
 * shows it instead of the square logo, so emails carry the same brand mark as
 * the portal.
 */
export interface EmailBranding {
  wordmarkUrl: string | null
}

const DEFAULT_BRANDING: EmailBranding = { wordmarkUrl: null }

const EmailBrandingContext = createContext<EmailBranding>(DEFAULT_BRANDING)

export function EmailBrandingProvider(props: { value: EmailBranding; children: ReactNode }) {
  return createElement(EmailBrandingContext.Provider, { value: props.value }, props.children)
}

export function useEmailBranding(): EmailBranding {
  return useContext(EmailBrandingContext)
}

const resolver = {
  current: async (): Promise<EmailBranding> => DEFAULT_BRANDING,
}

/** Installed by the workspace process so each send can read the live branding settings. */
export function setEmailBrandingResolver(fn: () => Promise<EmailBranding>): void {
  resolver.current = fn
}

/** Never fails a send over branding: a resolver error falls back to the square logo. */
export async function resolveEmailBranding(): Promise<EmailBranding> {
  try {
    return await resolver.current()
  } catch {
    return DEFAULT_BRANDING
  }
}
