import { Link } from '@tanstack/react-router'

/** Breadcrumb for a settings page nested under a hub list. */
export function SettingsCrumb({
  to,
  parent,
  page,
}: {
  to: '/admin/settings/channels' | '/admin/settings/boards'
  parent: string
  page: string
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link to={to} className="text-muted-foreground hover:text-foreground hover:underline">
        {parent}
      </Link>
      <span className="text-muted-foreground/50" aria-hidden>
        /
      </span>
      <span className="font-medium text-foreground">{page}</span>
    </nav>
  )
}

/** Breadcrumb for a channel settings page nested under the Channels hub. */
export function ChannelSettingsCrumb({ page }: { page: string }) {
  return <SettingsCrumb to="/admin/settings/channels" parent="Channels" page={page} />
}

/** Breadcrumb for a board settings page nested under the Boards hub. */
export function BoardSettingsCrumb({ page }: { page: string }) {
  return <SettingsCrumb to="/admin/settings/boards" parent="Boards" page={page} />
}
