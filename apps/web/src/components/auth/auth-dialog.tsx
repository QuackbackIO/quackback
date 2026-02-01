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
import type { PublicOIDCConfig } from '@/lib/server/domains/settings'

interface OrgAuthConfig {
  found: boolean
  oauth: {
    google: boolean
    github: boolean
  }
  oidc?: PublicOIDCConfig | null
  openSignup?: boolean
}

interface AuthDialogProps {
  authConfig?: OrgAuthConfig | null
  orgSlug: string
}

/**
 * Auth Dialog Component
 *
 * A modal dialog that contains the inline OTP auth form.
 * Opens when triggered via useAuthPopover context.
 * Listens for auth success via BroadcastChannel.
 */
export function AuthDialog({ authConfig, orgSlug }: AuthDialogProps) {
  const { isOpen, mode, closeAuthPopover, setMode, onAuthSuccess } = useAuthPopover()

  // Listen for auth success broadcasts from popup windows
  // The onAuthSuccess callback handles session updates via router.invalidate()
  useAuthBroadcast({
    onSuccess: onAuthSuccess,
    enabled: isOpen,
  })

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
        <PortalAuthFormInline
          mode={mode}
          authConfig={authConfig}
          orgSlug={orgSlug}
          onModeSwitch={setMode}
        />
      </DialogContent>
    </Dialog>
  )
}
