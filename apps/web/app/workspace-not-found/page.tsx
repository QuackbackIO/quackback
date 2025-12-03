import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:3000'

/**
 * Workspace Not Found Page
 *
 * This page is shown when a user visits a subdomain that doesn't exist.
 * Used by the proxy to rewrite requests for non-existent workspaces.
 */
export default function WorkspaceNotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertCircle className="h-10 w-10 text-destructive" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Workspace Not Found</h1>
          <p className="text-muted-foreground">
            This workspace doesn&apos;t exist or may have been removed.
          </p>
        </div>

        <div className="space-y-4 pt-4">
          <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">What you can do:</p>
            <ul className="space-y-1 text-left">
              <li>• Check the URL for typos</li>
              <li>• Contact your workspace administrator</li>
              <li>• Create a new workspace</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href={`http://${APP_DOMAIN}/create-workspace`}>
              <Button className="w-full sm:w-auto">Create Workspace</Button>
            </Link>
            <Link href={`http://${APP_DOMAIN}`}>
              <Button variant="outline" className="w-full sm:w-auto">
                Go to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// Return 404 status
export const metadata = {
  title: 'Workspace Not Found',
}
