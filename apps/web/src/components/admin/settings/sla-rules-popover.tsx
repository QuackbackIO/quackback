import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** The rules the SLA clock engine follows, one click away from the Default policy row. */
export function SlaRulesPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${INLINE_LINK} text-[13px]`}>
          How SLAs apply
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
          <li>
            A default policy can be applied when a conversation starts. Workflows can still apply a
            different policy through the Apply SLA action.
          </li>
          <li>
            A conversation carries one active SLA. Applying another policy replaces it and restarts
            the reply clocks; re-applying the same policy keeps the elapsed time.
          </li>
          <li>
            The time-to-resolve target runs on the linked customer ticket, not the conversation. A
            workflow applies it (Apply SLA, Linked ticket), or it is applied automatically when a
            customer ticket is linked to a conversation that already carries the policy.
          </li>
          <li>
            Targets are snapshotted at apply time. Editing a policy affects future applications
            only, never clocks already running.
          </li>
          <li>
            Clocks count only your workspace office hours when they are configured, and holidays
            pause them too. Otherwise they run around the clock.
          </li>
          <li>
            Archived policies can no longer be applied, but they stay on conversations that already
            carry them and in reports.
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
