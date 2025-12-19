import { redirect } from 'next/navigation'
import { requireTenantBySlug } from '@/lib/tenant'
import { db, boards, eq } from '@/lib/db'
import { OnboardingWizard } from './onboarding-wizard'

interface OnboardingPageProps {
  params: Promise<{ orgSlug: string }>
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { orgSlug } = await params
  const { workspace, user } = await requireTenantBySlug(orgSlug)

  // Check if org already has boards - if so, skip onboarding
  const existingBoards = await db.query.boards.findFirst({
    where: eq(boards.workspaceId, workspace.id),
  })

  if (existingBoards) {
    redirect('/admin')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <OnboardingWizard
            workspaceName={workspace.name}
            workspaceId={workspace.id}
            userName={user.name}
          />
        </div>
      </main>
    </div>
  )
}
