import { requireTenantRole } from '@/lib/tenant'
import { Shield, Mail } from 'lucide-react'

export default async function SecurityPage({ params }: { params?: Promise<{}> }) {
  // Settings is validated in root layout
  // Only owners and admins can access security settings
  const { settings } = await requireTenantRole(['owner', 'admin'])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Authentication</h1>
          <p className="text-sm text-muted-foreground">
            Manage authentication methods for {settings.name}
          </p>
        </div>
      </div>

      {/* Current Auth Method */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium">Email Magic Link</h3>
            <p className="text-sm text-muted-foreground">
              Users sign in with a one-time code sent to their email
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">Enabled by default</span>
        </div>
      </div>

      {/* OAuth Info */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h3 className="font-medium">Social Login</h3>
        <p className="text-sm text-muted-foreground">
          Google and GitHub OAuth can be enabled by setting the following environment variables:
        </p>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>
            <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_CLIENT_ID</code> and{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_CLIENT_SECRET</code>
          </li>
          <li>
            <code className="text-xs bg-muted px-1 py-0.5 rounded">GITHUB_CLIENT_ID</code> and{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">GITHUB_CLIENT_SECRET</code>
          </li>
        </ul>
      </div>
    </div>
  )
}
