'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { OTPAuthFormInline } from './otp-auth-form-inline'
import { useAuthPopover } from './auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'

interface SsoProviderInfo {
  providerId: string
  issuer: string
  domain: string
}

interface OrgAuthConfig {
  found: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  microsoftEnabled?: boolean
  openSignupEnabled?: boolean
  ssoProviders?: SsoProviderInfo[]
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
}

/**
 * Auth Dialog Component
 *
 * A modal dialog that contains the inline OTP auth form.
 * Opens when triggered via useAuthPopover context.
 * Listens for auth success via BroadcastChannel.
 */
export function AuthDialog({ authConfig }: AuthDialogProps) {
  const { isOpen, mode, closeAuthPopover, setMode, onAuthSuccess } = useAuthPopover()

  // Listen for auth success broadcasts from popup windows
  // Note: We don't call router.refresh() here to avoid disrupting other dialogs
  // Components that need updated auth state should use useSession with refetch
  useAuthBroadcast({
    onSuccess: onAuthSuccess,
    enabled: isOpen,
  })

  const handleModeSwitch = (newMode: 'login' | 'signup') => {
    setMode(newMode)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeAuthPopover()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'login' ? 'Welcome back' : 'Create an account'}</DialogTitle>
          <DialogDescription>
            {mode === 'login'
              ? 'Sign in to your account to vote and comment'
              : 'Sign up to vote and comment on feedback'}
          </DialogDescription>
        </DialogHeader>
        <OTPAuthFormInline mode={mode} authConfig={authConfig} onModeSwitch={handleModeSwitch} />
      </DialogContent>
    </Dialog>
  )
}
