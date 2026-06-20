import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PortalAuthFormInline } from './portal-auth-form-inline'
import { useAuthPopover } from './auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'

interface OrgAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  oidcProviders?: { id: string; name: string }[]
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
  workspaceName?: string
}

import type { AuthFormStep } from './email-signin-types'

interface FormContext {
  step: AuthFormStep
  email: string
}

/** Wraps the inline auth form in a Radix dialog with a header that
 * adapts to the form's current step (e.g. flips to "Check your email"
 * after the user submits their email). */
export function AuthDialog({ authConfig, workspaceName }: AuthDialogProps) {
  const { isOpen, mode, closeAuthPopover, setMode, onAuthSuccess } = useAuthPopover()
  const [formContext, setFormContext] = useState<FormContext>({ step: 'credentials', email: '' })

  // Listen for auth success broadcasts from popup windows
  useAuthBroadcast({
    onSuccess: onAuthSuccess,
    enabled: isOpen,
  })

  const { title, description } = headerForStep(mode, formContext)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Reset context on close so the next open starts fresh
          setFormContext({ step: 'credentials', email: '' })
          closeAuthPopover()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <PortalAuthFormInline
          mode={mode}
          authConfig={authConfig}
          workspaceName={workspaceName}
          onModeSwitch={setMode}
          onContextChange={setFormContext}
        />
      </DialogContent>
    </Dialog>
  )
}

function headerForStep(
  mode: 'login' | 'signup',
  ctx: FormContext
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
