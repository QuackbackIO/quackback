import { createFileRoute, notFound } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/hc/articles/$categorySlug/')({
  beforeLoad: () => {
    throw notFound()
  },
})
