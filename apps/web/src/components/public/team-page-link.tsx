import type { ComponentProps, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useSectionLinks } from '@/lib/client/hooks/use-root-context'
import { teamPageHref } from '@/lib/shared/section-links'

type TeamPagePath = '/admin' | '/admin/feedback/moderation'

/**
 * A portal link to one of the team's pages, which run on the primary domain
 * only. On a section host it is a plain link to the primary domain (the page
 * there is a full load, never a route change on this host); elsewhere it is
 * the usual router link. Props are passed through, so it works under
 * `asChild`.
 */
export function TeamPageLink({
  to,
  children,
  ...rest
}: { to: TeamPagePath; children: ReactNode } & Omit<ComponentProps<'a'>, 'href'>) {
  const href = teamPageHref(to, useSectionLinks())
  if (href) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} search={{}} {...rest}>
      {children}
    </Link>
  )
}
