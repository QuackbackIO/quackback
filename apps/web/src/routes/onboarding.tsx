import { createFileRoute, redirect } from '@tanstack/react-router'
import { db, member, eq } from '@/lib/db'
import { OnboardingWizard } from '@/app/onboarding/onboarding-wizard'
import { generateId } from '@quackback/ids'
import type { UserId, MemberId } from '@quackback/ids'

export const Route = createFileRoute('/onboarding')({
  loader: async ({ context }) => {
    // Session and settings already available from root context
    const { session, settings } = context

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
          throw redirect({ to: '/auth/login' })
        }
      }

      // User is authenticated with member record
      if (settings) {
        // Settings exist - check if boards exist
        const existingBoards = await db.query.boards.findFirst()

        if (existingBoards) {
          // Everything is set up, redirect to admin
          throw redirect({ to: '/admin' })
        }

        // Need to create first board
        initialStep = 'create-board'
      } else {
        // Authenticated but no settings - need to set up workspace
        initialStep = 'setup-workspace'
      }
    }
    // else: Not authenticated - start with account creation

    return {
      initialStep,
      userName: session?.user?.name,
    }
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  const { initialStep, userName } = Route.useLoaderData()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <OnboardingWizard initialStep={initialStep} userName={userName} />
        </div>
      </main>
    </div>
  )
}
