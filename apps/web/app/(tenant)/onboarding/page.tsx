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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-2xl">
        <OnboardingWizard
          organizationName={organization.name}
          organizationId={organization.id}
          userName={user.name}
        />
      </div>
    </div>
  )
}
