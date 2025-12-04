import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'

/**
 * Create Workspace Page
 *
 * Main domain page for self-service tenant provisioning.
 * Creates a new organization and owner user account.
 */
export default function CreateWorkspacePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create your workspace</h1>
          <p className="mt-2 text-muted-foreground">Set up your feedback portal in seconds</p>
        </div>

        <CreateWorkspaceForm />
      </div>
    </div>
  )
}
