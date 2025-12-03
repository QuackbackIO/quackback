import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getPublicBoardsWithStats, getRoadmapPosts } from '@quackback/db/queries/public'
import { BoardCard } from '@/components/public/board-card'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { PortalHeader } from '@/components/public/portal-header'
import type { PostStatus } from '@quackback/db'

const APP_DOMAIN = process.env.APP_DOMAIN
const DEFAULT_ROADMAP_STATUSES: PostStatus[] = ['planned', 'in_progress', 'complete']

/**
 * Root Page - handles both main domain and tenant domains
 *
 * Main domain (APP_DOMAIN): Shows landing page
 * Tenant domain: Shows tenant portal home with boards & roadmap
 */
export default async function RootPage() {
  const headersList = await headers()
  const host = headersList.get('host')

  // Main domain - show landing page
  if (host === APP_DOMAIN) {
    return <LandingPage />
  }

  // Tenant domain - show portal home
  const [org, userRole] = await Promise.all([getCurrentOrganization(), getCurrentUserRole()])

  if (!org) {
    redirect('/login?error=workspace_not_found')
  }

  return <TenantHomePage orgId={org.id} orgName={org.name} orgLogo={org.logo} userRole={userRole} />
}

/**
 * Landing page for main domain
 */
function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">Quackback</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/create-workspace">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="max-w-3xl space-y-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Customer feedback that <span className="text-primary">drives product decisions</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Collect, organize, and act on user feedback with public boards, roadmaps, and
            changelogs. Open-source and self-hostable.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/create-workspace">
              <Button size="lg" className="w-full sm:w-auto">
                Create your workspace
              </Button>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          <p>Open-source customer feedback platform</p>
        </div>
      </footer>
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
}: {
  orgId: string
  orgName: string
  orgLogo?: string | null
  userRole: 'owner' | 'admin' | 'member' | null
}) {
  const [boards, roadmapPosts] = await Promise.all([
    getPublicBoardsWithStats(orgId),
    getRoadmapPosts(orgId, DEFAULT_ROADMAP_STATUSES),
  ])

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader orgName={orgName} orgLogo={orgLogo} userRole={userRole} />

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

          <RoadmapBoard posts={roadmapPosts} />
        </section>
      </main>
    </div>
  )
}
