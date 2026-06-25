import { FormattedMessage } from 'react-intl'
import type { AuthFormStep } from './email-signin-types'

export interface FormContext {
  step: AuthFormStep
  email: string
}

/** Where the auth form is mounted. Drives the base-step copy:
 *  - `dialog`         — the public portal sign-in modal ("vote and comment").
 *  - `private-portal` — the private-portal gate, where the page IS the login
 *    screen, so the copy frames the portal as private instead. */
export type AuthSurface = 'dialog' | 'private-portal'

interface HeaderOptions {
  surface?: AuthSurface
  /** Workspace name woven into the private-portal base-step copy. */
  workspaceName?: string
}

/**
 * Title + description for the auth form's current step, shared by the public
 * sign-in dialog and the private-portal gate so both read identically.
 *
 * Only the base step (`credentials`, plus the 2FA fallback) differs by surface;
 * the `code` / `forgot` / `reset` steps are step-specific and read the same
 * everywhere.
 */
export function headerForStep(
  mode: 'login' | 'signup',
  ctx: FormContext,
  opts?: HeaderOptions
): { title: React.ReactNode; description: React.ReactNode } {
  if (ctx.step === 'code') {
    return {
      title:
        mode === 'signup' ? (
          <FormattedMessage id="portal.auth.dialog.codeSignupTitle" defaultMessage="Almost there" />
        ) : (
          <FormattedMessage id="portal.auth.otp.title" defaultMessage="Check your email" />
        ),
      description: (
        <FormattedMessage
          id="portal.auth.otp.description"
          defaultMessage="We sent a 6-digit code to {email}."
          values={{ email: <strong className="text-foreground">{ctx.email}</strong> }}
        />
      ),
    }
  }
  if (ctx.step === 'forgot') {
    return {
      title: (
        <FormattedMessage id="portal.auth.forgot.title" defaultMessage="Reset your password" />
      ),
      description: (
        <FormattedMessage
          id="portal.auth.dialog.forgotDescription"
          defaultMessage="Enter your email and we'll send you a reset link."
        />
      ),
    }
  }
  if (ctx.step === 'reset') {
    return {
      title: <FormattedMessage id="portal.auth.reset.title" defaultMessage="Check your email" />,
      description: (
        <FormattedMessage
          id="portal.auth.dialog.resetDescription"
          defaultMessage="We sent you a password reset link."
        />
      ),
    }
  }

  // Base step. On the private-portal gate the copy frames the portal as private
  // rather than nudging the public "vote and comment" action.
  if (opts?.surface === 'private-portal') {
    const workspace = opts.workspaceName?.trim()
    return {
      title:
        mode === 'login' ? (
          workspace ? (
            <FormattedMessage
              id="portal.auth.private.loginTitle"
              defaultMessage="Sign in to access {workspace}"
              values={{ workspace }}
            />
          ) : (
            <FormattedMessage
              id="portal.auth.private.loginTitleGeneric"
              defaultMessage="Sign in to continue"
            />
          )
        ) : workspace ? (
          <FormattedMessage
            id="portal.auth.private.signupTitle"
            defaultMessage="Create your {workspace} account"
            values={{ workspace }}
          />
        ) : (
          <FormattedMessage
            id="portal.auth.private.signupTitleGeneric"
            defaultMessage="Create an account to continue"
          />
        ),
      description:
        mode === 'login' ? (
          <FormattedMessage
            id="portal.auth.private.loginTagline"
            defaultMessage="This portal is private. Sign in or create an account to continue."
          />
        ) : (
          <FormattedMessage
            id="portal.auth.private.signupTagline"
            defaultMessage="This portal is private. Create an account to continue."
          />
        ),
    }
  }

  return {
    title:
      mode === 'login' ? (
        <FormattedMessage id="portal.auth.welcomeBack" defaultMessage="Welcome back" />
      ) : (
        <FormattedMessage id="portal.auth.dialog.signupTitle" defaultMessage="Create an account" />
      ),
    description:
      mode === 'login' ? (
        <FormattedMessage
          id="portal.auth.login.tagline"
          defaultMessage="Sign in to vote and comment on feedback."
        />
      ) : (
        <FormattedMessage
          id="portal.auth.signup.tagline"
          defaultMessage="Sign up to vote and comment on feedback."
        />
      ),
  }
}
