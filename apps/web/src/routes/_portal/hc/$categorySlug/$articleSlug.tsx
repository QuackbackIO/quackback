import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/hc/$categorySlug/$articleSlug')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: `/hc/articles/${params.categorySlug}/${params.articleSlug}` as '/',
      replace: true,
    })
  },
})
