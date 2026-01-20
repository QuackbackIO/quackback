import { createFileRoute, Outlet, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    // Trust parent context - requestContext is already set by __root.tsx
    // Only allow app-domain requests to access this route group
    if (context.requestContext?.type !== 'app-domain') {
      throw notFound()
    }
  },
  component: () => <Outlet />,
})
