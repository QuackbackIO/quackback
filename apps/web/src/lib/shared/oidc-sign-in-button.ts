/**
 * One public OIDC sign-in button, as surfaced to the portal / widget / onboarding
 * sign-in forms.
 *
 * - `id` is the provider's `registrationId` — drives `signIn.oauth2({ providerId })`.
 * - `name` is its display label.
 * - `logoUrl` is the uploaded provider logo (absolutised public URL), or absent /
 *   null when none is set, in which case the form falls back to a brand glyph.
 *
 * Kept in one place so the ~6 structural annotations that used to inline
 * `{ id: string; name: string }` cannot drift apart.
 */
export interface OidcSignInButton {
  id: string
  name: string
  logoUrl?: string | null
}
