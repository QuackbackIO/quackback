import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth/server'
import { auth } from '@/lib/auth/index'
import { buildOrgUrl } from '@/lib/routing'
import { OrgSelector } from './org-selector'

export default async function SelectOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}) {
  const session = await getSession()

  if (!session?.user) {
    redirect('/login')
  }

  // Get user's organizations
  const orgs = await auth.api.listOrganizations({
    headers: await headers(),
  })

  const { error, callbackUrl } = await searchParams

  // If user has no organizations, redirect to create one
  if (!orgs || orgs.length === 0) {
    redirect('/create-org')
  }

  // If user has only one org, redirect directly to it
  if (orgs.length === 1) {
    const targetUrl = callbackUrl || '/admin'
    const orgUrl = buildOrgUrl(orgs[0].slug, targetUrl)
    redirect(orgUrl)
  }

  // User has multiple orgs - show selector
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-foreground">
            Select Organization
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose which organization you want to access
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              {error === 'org_not_found'
                ? 'Organization not found'
                : error === 'not_a_member'
                  ? "You don't have access to that organization"
                  : 'An error occurred'}
            </p>
          </div>
        )}

        <OrgSelector organizations={orgs} callbackUrl={callbackUrl} />
      </div>
    </div>
  )
}
