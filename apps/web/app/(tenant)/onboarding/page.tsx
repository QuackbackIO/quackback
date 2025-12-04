import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq } from '@quackback/db'
import { OnboardingWizard } from './onboarding-wizard'

export default async function OnboardingPage() {
  const { organization, user } = await requireTenant()

  // Check if org already has boards - if so, skip onboarding
  const existingBoards = await db.query.boards.findFirst({
    where: eq(boards.organizationId, organization.id),
  })

  if (existingBoards) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <OnboardingWizard
            organizationName={organization.name}
            organizationId={organization.id}
            userName={user.name}
          />
        </div>
      </main>
    </div>
  )
}
