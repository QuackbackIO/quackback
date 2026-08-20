/**
 * Human-readable messages for the `?error=<code>` values a sign-in can
 * land with. Two producers feed this map:
 *
 *  - our own pre-checks (`handleSignInPreCheck` / `auth-restrictions`),
 *    which 302 to the login surface with a code, and
 *  - Better-Auth's OAuth/OIDC callback pipeline (`redirectOnError`),
 *    whose codes arrive on the `errorCallbackURL`.
 *
 * Shared (not server-only) because client-bundled route files render
 * these messages directly (popup landing, login toast).
 */

/** Closed set of codes the producers emit. Adding a producer-side code
 *  without listing it here makes the auth client fall back to the
 *  generic message — TypeScript won't catch that for you because the
 *  producer side types these as `error?: string`. Keep both sides in
 *  sync. */
export type AuthBlockCode =
  | 'password_method_not_allowed'
  | 'magic_link_method_not_allowed'
  | 'oauth_method_not_allowed'
  | 'auth_method_blocked'
  | 'rate_limited'
  | 'verified_domain_requires_sso'
  | 'require_two_factor'
  | 'token_expired'
  | 'invalid_token'
  | 'signup_disabled'
  | 'signup_not_allowed'
  | 'OAUTH_CALLBACK_ERROR'
  | 'oauth_signin_error'
  | 'not_team_member'
  | 'reserved_email_domain'
  // Better-Auth OAuth/OIDC callback codes (redirectOnError in the
  // generic-oauth plugin and the linking pipeline). These arrive as
  // `?error=<code>` on the errorCallbackURL, not from our pre-checks.
  | 'account_not_linked'
  // Better-Auth emits this code with a literal apostrophe.
  | "email_doesn't_match"
  | 'account_already_linked_to_different_user'
  | 'unable_to_link_account'
  | 'email_is_missing'
  | 'email_not_found'
  | 'state_mismatch'
  | 'please_restart_the_process'
  | 'oauth_code_verification_failed'
  | 'invalid_code'
  | 'no_code'
  | 'unable_to_create_user'
  // The magic-link plugin's own spelling of the same event. Better-Auth emits
  // `unable_to_create_user` from the OAuth callback and `failed_to_create_user`
  // from `/magic-link/verify`; both are real codes and both land on a browser.
  | 'failed_to_create_user'
  | 'unable_to_create_session'
  | 'oauth_provider_not_found'
  | 'handoff_failed'

export const AUTH_BLOCK_MESSAGES: Record<AuthBlockCode, string> = {
  password_method_not_allowed:
    "Password sign-in isn't enabled for this workspace. Try magic-link or SSO instead.",
  magic_link_method_not_allowed: "Magic-link sign-in isn't enabled for this workspace.",
  oauth_method_not_allowed: "That sign-in provider isn't enabled for this workspace.",
  auth_method_blocked: "That sign-in method isn't allowed for your account.",
  rate_limited: 'Too many sign-in attempts. Please wait a moment and try again.',
  reserved_email_domain:
    'That email domain is reserved and cannot be used to sign in. Use your own email address.',
  verified_domain_requires_sso:
    'Your email is on a domain that requires single sign-on. Use the SSO option to continue.',
  require_two_factor: 'Two-factor authentication is required. Please verify your second factor.',
  token_expired: 'Your login link has expired. Please request a new one.',
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  signup_disabled:
    "Your account isn't pre-provisioned for SSO. Ask an administrator to invite you first.",
  signup_not_allowed:
    "This workspace isn't accepting new accounts. Ask an admin to invite you, then sign in with the account they invite.",
  OAUTH_CALLBACK_ERROR:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  oauth_signin_error:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  not_team_member:
    "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator.",
  account_not_linked:
    'An account with this email already exists. Sign in with your original method (for example an emailed sign-in link) to confirm it, and your SSO login will be connected.',
  "email_doesn't_match":
    'The identity provider returned a different email than your account. Sign in with an IdP account that uses the same email address.',
  account_already_linked_to_different_user:
    'That identity is already connected to a different account. Sign in with a different IdP account, or contact your administrator.',
  unable_to_link_account: 'Something went wrong while connecting your sign-in. Please try again.',
  email_is_missing:
    "Your identity provider didn't share an email address. Ask your administrator to enable the email scope for this app.",
  email_not_found:
    "Your identity provider didn't share an email address. Ask your administrator to enable the email scope for this app.",
  state_mismatch: 'That sign-in attempt expired or was already used. Please try again.',
  please_restart_the_process: 'That sign-in attempt expired or was already used. Please try again.',
  oauth_code_verification_failed:
    "The sign-in couldn't be verified with your identity provider. Please try again.",
  invalid_code: "The sign-in couldn't be verified with your identity provider. Please try again.",
  no_code: "The sign-in couldn't be verified with your identity provider. Please try again.",
  unable_to_create_user: 'Something went wrong creating your account. Please try again.',
  failed_to_create_user:
    "We couldn't create an account for that link. It may have expired, or this workspace isn't accepting new accounts. Ask an admin to invite you, then use the link they send.",
  unable_to_create_session: 'Something went wrong signing you in. Please try again.',
  oauth_provider_not_found:
    "That sign-in provider isn't available right now. It may have been disabled by an administrator.",
  handoff_failed:
    'That workspace handoff expired or was already used. Sign in here, or reopen the workspace from Quackback.',
}
