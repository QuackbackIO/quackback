import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PortalHeader } from '@/components/public/portal-header'
import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { BackButton } from '@/app/back-button'

/**
 * Generic Not Found (404)
 *
 * Shown when a user visits a route that doesn't exist.
 */
export default async function NotFound() {
  // Try to get org info if on a tenant domain
  const [org, userRole] = await Promise.all([
    getCurrentOrganization().catch(() => null),
    getCurrentUserRole().catch(() => null),
  ])

  return (
    <div className="min-h-screen bg-background">
      {/* Show portal header if on a valid workspace */}
      {org && <PortalHeader orgName={org.name} orgLogo={org.logo} userRole={userRole} />}

      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
        <div className="w-full max-w-lg space-y-8 text-center">
          <div className="space-y-6">
            <div className="text-[10rem] font-black leading-none tracking-tighter text-muted-foreground/20">
              404
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-tight">Well, this is awkward...</h1>
              <p className="text-muted-foreground">
                This page flew the coop. Let&apos;s get you back on track.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/">
              <Button size="lg" className="w-full sm:w-auto">
                Go to Home
              </Button>
            </Link>
            <BackButton />
          </div>
        </div>
      </div>
    </div>
  )
}
