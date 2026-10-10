import { LocalDate } from '@/components/ui/local-date'

/**
 * "Mon, Oct 12, 2:00 PM GMT+1": the copy around it is English. The zone is
 * named because the first render is in UTC until the page hydrates.
 */
export const CHOICE_DUE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}

/**
 * When the rest of admin starts waiting on a plan choice, in the viewer's own
 * time. Loaded only for an ended-trial strip that carries a deadline, so the
 * admin layout does not.
 */
export default function ChoiceDue({ at }: { at: Date }) {
  return (
    <>
      <span className="text-white/80">·</span>
      <span className="font-medium text-white">
        Choose by <LocalDate date={at} options={CHOICE_DUE_FORMAT} locale="en-US" />
      </span>
    </>
  )
}
