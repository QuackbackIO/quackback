import { createFileRoute } from '@tanstack/react-router'

/** Parent beforeLoad 301s to /hc/{locale}/collections/{urlId}-{slug}. */
export const Route = createFileRoute('/_portal/hc/$locale/categories/$categorySlug/')({
  component: () => null,
})
