/** Invitation id from a magic-link callback URL (`/complete-signup/…` or `/portal-invite/…`). */
export function parseInvitationId(callbackURL: string | undefined): string | null {
  if (!callbackURL) return null
  try {
    const path = new URL(callbackURL).pathname
    const match = path.match(/\/(?:complete-signup|portal-invite)\/(invite_[a-z0-9]+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}
