import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MessageSquare, BarChart3, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { db, workspace, workspaceDomain, eq } from '@/lib/db'

const APP_DOMAIN = process.env.APP_DOMAIN

// Force dynamic rendering since we check host header
export const dynamic = 'force-dynamic'

/**
 * Root Page - Main domain only
 *
 * After the migration to path-based tenant routing, this page only handles
 * main domain (APP_DOMAIN) requests. Tenant domain requests are rewritten
 * by the proxy to /s/[orgSlug]/ which has its own page.tsx.
 *
 * Main domain behavior:
 *   - If no workspaces exist: show setup wizard for new installation
 *   - If single workspace exists: redirect to that workspace
 *   - If multiple workspaces exist: show marketing landing page
 */
export default async function RootPage() {
  const headersList = await headers()
  const host = headersList.get('host')

  // Safety check: if somehow a tenant domain reaches here, throw error
  // (should never happen - proxy rewrites tenant requests to /s/[orgSlug]/)
  if (host !== APP_DOMAIN) {
    throw new Error(
      `Unexpected host "${host}" - tenant requests should be rewritten to /s/[orgSlug]/`
    )
  }

  // Query organizations (limit 2 to distinguish between 0, 1, or 2+)
  const orgs = await db.select().from(workspace).limit(2)

  // No workspaces exist - show setup page for new installation
  if (orgs.length === 0) {
    return <SetupPage />
  }

  // Exactly one workspace exists - redirect to it
  if (orgs.length === 1) {
    const singleOrg = orgs[0]

    // Get the primary domain for this workspace
    const domain = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.workspaceId, singleOrg.id),
      orderBy: (wd, { desc }) => [desc(wd.isPrimary)],
    })

    if (domain) {
      const protocol = headersList.get('x-forwarded-proto') || 'http'
      redirect(`${protocol}://${domain.domain}`)
    }
  }

  // Multiple workspaces exist - show marketing landing page
  return <MarketingPage />
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

/**
 * Marketing page for multi-workspace installations
 *
 * Shown when multiple workspaces exist - directs users to quackback.io
 * for creating their own feedback portal.
 */
function MarketingPage() {
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

          {/* CTA Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm space-y-6">
            <div className="space-y-2 text-center">
              <h2 className="text-xl font-semibold">Want to collect customer feedback?</h2>
              <p className="text-sm text-muted-foreground">
                Create your own feedback portal with public boards, roadmaps, and changelogs.
              </p>
            </div>

            <a
              href="https://quackback.io"
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <Button size="lg" className="w-full group">
                Get started at quackback.io
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </a>
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
