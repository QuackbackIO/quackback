import { redirect } from 'next/navigation'
import { db, boards } from '@/lib/db'
import { getSettings } from '@/lib/tenant'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { OnboardingWizard } from './onboarding-wizard'

export default async function OnboardingPage() {
  // Get current session (may be null)
  const headersList = await headers()
  const session = await auth.api.getSession({ headers: headersList })

  // Check what state we're in
  const settings = await getSettings()

  // Determine starting step based on state
  // Flow: create-account → setup-workspace → create-board → complete
  let initialStep: 'create-account' | 'setup-workspace' | 'create-board' = 'create-account'

  if (session?.user) {
    // User is authenticated
    if (settings) {
      // Settings exist - check if boards exist
      const existingBoards = await db.query.boards.findFirst()

      if (existingBoards) {
        // Everything is set up, redirect to admin
        redirect('/admin')
      }

      // Need to create first board
      initialStep = 'create-board'
    } else {
      // Authenticated but no settings - need to set up workspace
      initialStep = 'setup-workspace'
    }
  }
  // else: Not authenticated - start with account creation

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <OnboardingWizard
            initialStep={initialStep}
            workspaceName={settings?.name}
            userName={session?.user?.name}
          />
        </div>
      </main>
    </div>
  )
}
