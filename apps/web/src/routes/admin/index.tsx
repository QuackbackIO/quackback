import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { analyticsQueries } from '@/lib/client/queries/analytics'
import { BriefingPage } from '@/components/admin/home/briefing-page'

const searchSchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('7d'),
})

export const Route = createFileRoute('/admin/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ deps, context }) => {
    await context.queryClient.ensureQueryData(analyticsQueries.briefing(deps.period))
  },
  component: HomePage,
})

function HomePage() {
  const { period } = Route.useSearch()
  return <BriefingPage period={period} />
}
