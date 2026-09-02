import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PortalAuthFormInline } from './portal-auth-form-inline'
import { headerForStep, type FormContext } from './auth-step-header'
import { hasDistinctSignup } from './oauth-buttons'
import { useAuthPopover } from './auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { signOut } from '@/lib/client/auth-client'

export interface OrgAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  oidcProviders?: { id: string; name: string }[]
  /** All registered auth provider ids — lets the form show the email input for
   *  a routed-only IdP that renders no public button. */
  registeredAuthProviders?: string[]
  /** Workspace requires 2FA — drives inline enrollment after password sign-in. */
  twoFactorRequired?: boolean
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
  workspaceName?: string
}

/** Wraps the inline auth form in a Radix dialog with a header that
 * adapts to the form's current step (e.g. flips to "Check your email"
 * after the user submits their email). */
export function AuthDialog({ authConfig, workspaceName }: AuthDialogProps) {
  const { isOpen, mode, callbackUrl, linkConflict, closeAuthPopover, setMode, onAuthSuccess } =
    useAuthPopover()
  const [formContext, setFormContext] = useState<FormContext>({ step: 'credentials', email: '' })

  // Sign-up mode only differs from login when password auth is on and signups
  // are open. Otherwise force login mode and drop the switch link, so a
  // `?auth=signup` deep link still lands on the (identical) login form.
  const distinctSignup = hasDistinctSignup(authConfig ?? {})
  const effectiveMode = distinctSignup ? mode : 'login'

  // Listen for auth success broadcasts from popup windows
  useAuthBroadcast({
    onSuccess: onAuthSuccess,
    enabled: isOpen,
  })

  const { title, description } = headerForStep(effectiveMode, formContext)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Abandoning the dialog mid-2FA (X / backdrop / Esc) must revoke the
          // session signIn.email already created — otherwise a required-2FA user
          // who never finishes enrollment keeps a valid, un-enrolled session and
          // bypasses the policy on the next navigation. Success closes via
          // reset() programmatically, which does NOT fire onOpenChange, so this
          // only runs on a genuine abandon.
          if (
            formContext.step === 'two-factor-enroll' ||
            formContext.step === 'two-factor-challenge'
          ) {
            void signOut().catch(() => {})
          }
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
          mode={effectiveMode}
          authConfig={authConfig}
          workspaceName={workspaceName}
          callbackUrl={callbackUrl}
          linkConflict={linkConflict}
          onModeSwitch={distinctSignup ? setMode : undefined}
          onContextChange={setFormContext}
        />
      </DialogContent>
    </Dialog>
  )
}
