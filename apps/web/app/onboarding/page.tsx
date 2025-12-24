import { redirect } from 'next/navigation'
import { db, member, eq } from '@/lib/db'
import { getSettings } from '@/lib/tenant'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { OnboardingWizard } from './onboarding-wizard'
import { generateId } from '@quackback/ids'
import type { UserId, MemberId } from '@quackback/ids'

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
    // Safety check: Ensure user has a member record
    // (databaseHooks should have created this, but this is a fallback)
    let memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })

    if (!memberRecord) {
      console.log('[Onboarding] Member record not found, checking if user should be owner')

      // Check if any owner exists
      const existingOwner = await db.query.member.findFirst({
        where: eq(member.role, 'owner'),
      })

      if (!existingOwner) {
        console.log('[Onboarding] Creating owner member record')

        // First user - create owner member record
        const [newMember] = await db
          .insert(member)
          .values({
            id: generateId('member') as MemberId,
            userId: session.user.id as UserId,
            role: 'owner',
            createdAt: new Date(),
          })
          .returning()

        memberRecord = newMember
      } else {
        // Not first user - they need an invitation
        console.log('[Onboarding] Owner exists, user needs invitation')
        redirect('/login?error=no_access')
      }
    }

    // User is authenticated with member record
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
          <OnboardingWizard initialStep={initialStep} userName={session?.user?.name} />
        </div>
      </main>
    </div>
  )
}
