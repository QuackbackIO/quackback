import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/help/$')({
  beforeLoad: ({ params }) => {
    const splat = params._splat ?? ''
    throw redirect({ to: `/hc/${splat}` as string as '/', replace: true })
  },
})
