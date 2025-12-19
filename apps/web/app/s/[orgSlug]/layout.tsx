import { redirect } from 'next/navigation'
import { getWorkspaceBySlug } from '@/lib/tenant'

/**
 * Root Workspace Layout (Slug-Based Routing)
 *
 * This layout validates the workspace exists for the given slug.
 * Middleware resolves the domain to the workspace slug before routing here.
 *
 * Auth validation and UI shell are handled by child layouts:
 * - (portal)/ routes: public portal with PortalHeader (/, /roadmap, /b/...)
 * - (auth)/ routes: login/signup forms
 * - admin/ routes: admin dashboard with AdminNav
 * - settings/ routes: user settings with PortalHeader
 * - onboarding/ routes: minimal wizard layout
 */
interface WorkspaceLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { orgSlug } = await params

  // Validate workspace exists for the given slug
  const currentWorkspace = await getWorkspaceBySlug(orgSlug)
  if (!currentWorkspace) {
    redirect('/workspace-not-found')
  }

  return <>{children}</>
}
