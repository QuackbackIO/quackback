/**
 * Feedback's email (comments, status changes and mentions on posts people
 * follow) has no settings of its own; this card only says which address it
 * comes from, as the Changelog and Status pages do.
 */
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRows } from '@/components/admin/settings/setting-row'
import { SurfaceSenderRow, useSurfaceSender } from '@/components/admin/channels/surface-sender-row'

export function FeedbackEmailCard() {
  if (!useSurfaceSender('feedback')) return null
  return (
    <SettingsCard title="Email" description="Updates to people who follow a post.">
      <SettingRows>
        <SurfaceSenderRow surface="feedback" />
      </SettingRows>
    </SettingsCard>
  )
}
