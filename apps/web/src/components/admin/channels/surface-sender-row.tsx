/**
 * "Sent from" on the settings page of a product that emails people, so whoever
 * manages it sees the address before anything goes out. Chosen on Settings →
 * Email; this only shows it, with a way there for someone who may change it.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { Button } from '@/components/ui/button'
import { surfaceSenderQuery } from '@/lib/client/queries/channel-accounts'
import { useHasPermission } from '@/lib/client/hooks/use-root-context'
import {
  EMAIL_SENDING_PERMISSION,
  type ProductSenderSurface,
} from '@/lib/shared/email-sending-permissions'

export function SurfaceSenderRow({ surface }: { surface: ProductSenderSurface }) {
  const { data } = useQuery(surfaceSenderQuery(surface))
  const canChange = useHasPermission(EMAIL_SENDING_PERMISSION)
  if (!data?.from) return null
  return (
    <SettingRow
      label="Sent from"
      description={data.from}
      control={
        canChange ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/settings/email">Change</Link>
          </Button>
        ) : null
      }
    />
  )
}
