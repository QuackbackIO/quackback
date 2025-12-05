import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MessageSquare, BarChart3, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { getUserAvatarData, getBulkMemberAvatarData } from '@/lib/avatar'
import { theme } from '@quackback/shared'
import {
  getPublicBoardsWithStats,
  getPublicPostListAllBoards,
  getUserVotedPostIds,
} from '@quackback/db/queries/public'
import {
  db,
  organization,
  workspaceDomain,
  getStatusesByOrganization,
  eq,
  member,
  and,
} from '@quackback/db'
import { PortalHeader } from '@/components/public/portal-header'
import { PoweredByFooter } from '@/components/public/powered-by-footer'
import { FeedbackContainer } from '@/app/(tenant)/(public)/feedback-container'
import { getUserIdentifier, getMemberIdentifier } from '@/lib/user-identifier'

const APP_DOMAIN = process.env.APP_DOMAIN

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

interface RootPageProps {
  searchParams: Promise<{
    board?: string
    search?: string
    sort?: 'top' | 'new' | 'trending'
    page?: string
  }>
}

/**
 * Root Page - handles both main domain and tenant domains
 *
 * Main domain (APP_DOMAIN):
 *   - If single workspace exists: redirect to that workspace's login
 *   - Otherwise: show setup wizard for new installation
 * Tenant domain: Shows feedback portal with posts list
 */
export default async function RootPage({ searchParams }: RootPageProps) {
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

  // Tenant domain - show feedback portal (workspace validated in proxy.ts)
  const [org, userRole, session] = await Promise.all([
    getCurrentOrganization(),
    getCurrentUserRole(),
    getSession(),
  ])

  // Org is guaranteed to exist here due to proxy validation
  if (!org) {
    throw new Error('Organization should exist - validated in proxy')
  }

  // Generate theme CSS from org config
  const themeConfig = theme.parseThemeConfig(org.themeConfig)
  const themeStyles = themeConfig ? theme.generateThemeCSS(themeConfig) : ''

  const { board, search, sort = 'top', page = '1' } = await searchParams

  // Get user identifier - use member ID for authenticated users, anonymous cookie for others
  let userIdentifier = await getUserIdentifier()
  if (session?.user) {
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, org.id)),
    })
    if (memberRecord) {
      userIdentifier = getMemberIdentifier(memberRecord.id)
    }
  }

  // Fetch data in parallel
  const [boards, { items: posts, total, hasMore }, statuses] = await Promise.all([
    getPublicBoardsWithStats(org.id),
    getPublicPostListAllBoards({
      organizationId: org.id,
      boardSlug: board,
      search,
      sort,
      page: parseInt(page),
      limit: 20,
    }),
    getStatusesByOrganization(org.id),
  ])

  // Get user's voted posts
  const postIds = posts.map((p) => p.id)
  const votedPostIds = await getUserVotedPostIds(postIds, userIdentifier)

  // Get avatar URLs for post authors (base64 for SSR, no flicker)
  const postMemberIds = posts.map((p) => p.memberId)
  const postAvatarMap = await getBulkMemberAvatarData(postMemberIds)

  // Get avatar URL with base64 data for SSR (no flicker)
  const avatarData = session?.user
    ? await getUserAvatarData(session.user.id, session.user.image)
    : null

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={org.logo}
        userRole={userRole}
        userName={session?.user.name}
        userEmail={session?.user.email}
        userAvatarUrl={avatarData?.avatarUrl}
      />

      <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
        <FeedbackContainer
          organizationName={org.name}
          boards={boards}
          posts={posts}
          statuses={statuses}
          total={total}
          hasMore={hasMore}
          votedPostIds={Array.from(votedPostIds)}
          postAvatarUrls={Object.fromEntries(postAvatarMap)}
          currentBoard={board}
          currentSearch={search}
          currentSort={sort}
          currentPage={parseInt(page)}
          defaultBoardId={boards[0]?.id}
        />
      </main>
      <PoweredByFooter />
    </div>
  )
}

/**
 * Setup page for new Quackback installations
 *
 * Shown when no workspaces exist yet - guides user through initial setup.
 */
function SetupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-8">
          {/* Logo/Brand */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/10 rounded-full blur-2xl" />
              <Image src="/logo.png" alt="Quackback" width={80} height={80} className="relative" />
            </div>
            <div className="text-center space-y-1">
              <h1 className="text-3xl font-bold tracking-tight">Quackback</h1>
              <p className="text-muted-foreground">Open-source customer feedback platform</p>
            </div>
          </div>

          {/* Welcome Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Welcome!</h2>
              <p className="text-sm text-muted-foreground">
                Set up your feedback portal in under a minute.
              </p>
            </div>

            {/* Features */}
            <div className="grid gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Collect feedback</p>
                  <p className="text-xs text-muted-foreground">
                    Public boards for feature requests
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Track progress</p>
                  <p className="text-xs text-muted-foreground">Roadmaps and status updates</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Engage users</p>
                  <p className="text-xs text-muted-foreground">Voting, comments, and updates</p>
                </div>
              </div>
            </div>

            <Link href="/create-workspace" className="block">
              <Button size="lg" className="w-full group">
                Get started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>

          {/* Footer badges */}
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>Open-source</span>
            <span className="text-border">•</span>
            <span>Self-hostable</span>
            <span className="text-border">•</span>
            <span>Privacy-focused</span>
          </div>
        </div>
      </main>
    </div>
  )
}
