import { useState } from 'react'
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
  customProviderNames?: Record<string, string>
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
}

import type { AuthFormStep } from './email-signin-types'

interface FormContext {
  step: AuthFormStep
  email: string
}

/** Wraps the inline auth form in a Radix dialog with a header that
 * adapts to the form's current step (e.g. flips to "Check your email"
 * after the user submits their email). */
export function AuthDialog({ authConfig }: AuthDialogProps) {
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
): { title: string; description: React.ReactNode } {
  if (ctx.step === 'code') {
    return {
      title: mode === 'signup' ? 'Almost there' : 'Check your email',
      description: (
        <>
          We sent a 6-digit code to <strong className="text-foreground">{ctx.email}</strong>.
        </>
      ),
    }
  }
  if (ctx.step === 'forgot') {
    return {
      title: 'Reset your password',
      description: "Enter your email and we'll send you a reset link.",
    }
  }
  if (ctx.step === 'reset') {
    return {
      title: 'Check your email',
      description: 'We sent you a password reset link.',
    }
  }
  return {
    title: mode === 'login' ? 'Welcome back' : 'Create an account',
    description:
      mode === 'login'
        ? 'Sign in to vote and comment on feedback.'
        : 'Sign up to vote and comment on feedback.',
  }
}
