import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { getPublicBoardsWithStats, getRoadmapPosts } from '@quackback/db/queries/public'
import { db, organization, workspaceDomain, getStatusesByOrganization, eq } from '@quackback/db'
import { BoardCard } from '@/components/public/board-card'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { PortalHeader } from '@/components/public/portal-header'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Root Page - handles both main domain and tenant domains
 *
 * Main domain (APP_DOMAIN):
 *   - If single workspace exists: redirect to that workspace's login
 *   - Otherwise: show setup wizard for new installation
 * Tenant domain: Shows tenant portal home with boards & roadmap
 */
export default async function RootPage() {
  const headersList = await headers()
  const host = headersList.get('host')

  // Main domain - check for single workspace or show landing page
  if (host === APP_DOMAIN) {
    // Query all organizations (limit 2 to check if there's exactly 1)
    const orgs = await db.select().from(organization).limit(2)

    // If exactly one workspace exists, redirect to its login page
    if (orgs.length === 1) {
      const singleOrg = orgs[0]

      // Get the primary domain for this workspace
      const domain = await db.query.workspaceDomain.findFirst({
        where: eq(workspaceDomain.organizationId, singleOrg.id),
        orderBy: (wd, { desc }) => [desc(wd.isPrimary)],
      })

      if (domain) {
        const protocol = headersList.get('x-forwarded-proto') || 'http'
        const loginUrl = `${protocol}://${domain.domain}/admin/login`
        redirect(loginUrl)
      }
    }

    // No workspaces exist - show setup page for new installation
    return <SetupPage />
  }

  // Tenant domain - show portal home (workspace validated in proxy.ts)
  const [org, userRole, session] = await Promise.all([
    getCurrentOrganization(),
    getCurrentUserRole(),
    getSession(),
  ])

  // Org is guaranteed to exist here due to proxy validation
  if (!org) {
    throw new Error('Organization should exist - validated in proxy')
  }

  return (
    <TenantHomePage
      orgId={org.id}
      orgName={org.name}
      orgLogo={org.logo}
      userRole={userRole}
      userName={session?.user.name}
      userEmail={session?.user.email}
      userImage={session?.user.image}
    />
  )
}

/**
 * Setup page for new Quackback installations
 *
 * Shown when no workspaces exist yet - guides user through initial setup.
 */
function SetupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/30">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg space-y-8 text-center">
          {/* Logo/Brand */}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold">Quackback</h1>
            <p className="text-muted-foreground">Customer feedback platform</p>
          </div>

          {/* Welcome Card */}
          <div className="rounded-xl border bg-card p-8 shadow-sm text-left space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Welcome!</h2>
              <p className="text-muted-foreground">
                Let&apos;s set up your feedback portal. This will only take a minute.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                  1
                </div>
                <div>
                  <p className="font-medium">Create your workspace</p>
                  <p className="text-sm text-muted-foreground">
                    Set up your organization and admin account
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">
                  2
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Configure your boards</p>
                  <p className="text-sm text-muted-foreground">
                    Create feedback boards for your products
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">
                  3
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Start collecting feedback</p>
                  <p className="text-sm text-muted-foreground">
                    Share your portal and gather insights
                  </p>
                </div>
              </div>
            </div>

            <Link href="/create-workspace" className="block">
              <Button size="lg" className="w-full">
                Get started
              </Button>
            </Link>
          </div>

          <p className="text-sm text-muted-foreground">
            Open-source &middot; Self-hostable &middot; Privacy-focused
          </p>
        </div>
      </main>
    </div>
  )
}

/**
 * Tenant portal home page
 */
async function TenantHomePage({
  orgId,
  orgName,
  orgLogo,
  userRole,
  userName,
  userEmail,
  userImage,
}: {
  orgId: string
  orgName: string
  orgLogo?: string | null
  userRole: 'owner' | 'admin' | 'member' | 'user' | null
  userName?: string
  userEmail?: string
  userImage?: string | null
}) {
  // Fetch statuses for the org
  const allStatuses = await getStatusesByOrganization(orgId)
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)
  const statusSlugs = roadmapStatuses.map((s) => s.slug)

  const [boards, roadmapPosts] = await Promise.all([
    getPublicBoardsWithStats(orgId),
    getRoadmapPosts(orgId, statusSlugs),
  ])

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        orgName={orgName}
        orgLogo={orgLogo}
        userRole={userRole}
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
      />

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Boards Section */}
        <section className="mb-12">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold">Boards</h2>
            <Link
              href="/boards"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all →
            </Link>
          </div>

          {boards.length === 0 ? (
            <p className="text-muted-foreground">No public boards available.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => (
                <BoardCard
                  key={board.id}
                  slug={board.slug}
                  name={board.name}
                  description={board.description}
                  postCount={board.postCount}
                />
              ))}
            </div>
          )}
        </section>

        {/* Roadmap Section */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold">Roadmap</h2>
            <Link
              href="/roadmap"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View full roadmap →
            </Link>
          </div>

          <RoadmapBoard posts={roadmapPosts} statuses={roadmapStatuses} />
        </section>
      </main>
    </div>
  )
}
