import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/hc/$categorySlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: `/hc/categories/${params.categorySlug}` as '/', replace: true })
  },
})
