import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FriendlyShell } from './error-page'

/**
 * A team member whose seat is paused: the plan includes fewer team seats than
 * the workspace has members. Only the admin is closed to them, so the way out
 * is the public site or signing out (to sign in as someone else).
 */
export default function SeatPausedPage({ fullPage = true }: { fullPage?: boolean }) {
  const [signingOut, setSigningOut] = useState(false)
  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      const { signOut } = await import('@/lib/client/auth-client')
      await signOut()
    } finally {
      window.location.href = '/'
    }
  }

  return (
    <FriendlyShell fullPage={fullPage}>
      <h1 className="text-2xl font-semibold tracking-tight">Your admin access is paused</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This workspace&apos;s plan includes fewer team members than it has. Someone who manages
        billing can give you access again or upgrade.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button onClick={handleSignOut} disabled={signingOut}>
          Sign out
        </Button>
        <Button variant="outline" asChild>
          <a href="/">View public site</a>
        </Button>
      </div>
    </FriendlyShell>
  )
}
