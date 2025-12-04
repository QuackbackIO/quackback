import Link from 'next/link'
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'

/**
 * Create Workspace Page
 *
 * Main domain page for self-service tenant provisioning.
 * Creates a new organization and owner user account.
 */
export default function CreateWorkspacePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-xl font-bold">
            Quackback
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Create your workspace</h1>
            <p className="mt-2 text-muted-foreground">Set up your feedback portal in seconds</p>
          </div>

          <CreateWorkspaceForm />

          <p className="text-center text-sm text-muted-foreground">
            Already have a workspace?{' '}
            <Link href="/" className="font-medium text-primary hover:underline">
              Find your workspaces
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
