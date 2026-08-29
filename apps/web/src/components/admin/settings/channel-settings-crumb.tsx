import { Link } from '@tanstack/react-router'

/** Breadcrumb for a channel settings page nested under the Channels hub. */
export function ChannelSettingsCrumb({ page }: { page: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link
        to="/admin/settings/channels"
        className="text-muted-foreground hover:text-foreground hover:underline"
      >
        Channels
      </Link>
      <span className="text-muted-foreground/50" aria-hidden>
        /
      </span>
      <span className="font-medium text-foreground">{page}</span>
    </nav>
  )
}
