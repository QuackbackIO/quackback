import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace-not-found')({
  component: WorkspaceNotFound,
})

function WorkspaceNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Workspace Not Found</h1>
        <p className="text-muted-foreground mt-4">
          The workspace you're looking for doesn't exist or you don't have access to it.
        </p>
        <Link
          to="/onboarding"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create a Workspace
        </Link>
      </div>
    </div>
  )
}
