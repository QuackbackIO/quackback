import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalDate } from '@/components/ui/local-date'
import { parseSnoozeTime } from '@/lib/shared/snooze-parse'

interface SnoozeNaturalInputProps {
  /** Called with the parsed wake time when the phrase resolves. */
  onResolve: (date: Date) => void
  disabled?: boolean
}

/**
 * Natural-language snooze entry for the custom snooze dialog. Enter parses
 * the phrase deterministically (parseSnoozeTime) against the agent's locale;
 * unparseable input is flagged inline, never guessed at.
 */
export function SnoozeNaturalInput({ onResolve, disabled }: SnoozeNaturalInputProps) {
  const intl = useOptionalIntl()
  const [text, setText] = useState('')
  const [resolved, setResolved] = useState<Date | null>(null)
  const [failed, setFailed] = useState(false)

  function submit() {
    const date = parseSnoozeTime(text, { locale: navigator.language })
    if (!date) {
      setFailed(true)
      setResolved(null)
      return
    }
    setFailed(false)
    setResolved(date)
    onResolve(date)
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="snooze-natural-input">
        {intl.formatMessage({
          id: 'admin.inbox.snoozeNaturalInput.typeATime',
          defaultMessage: 'Type a time',
        })}
      </Label>
      <Input
        id="snooze-natural-input"
        value={text}
        placeholder={intl.formatMessage({
          id: 'admin.inbox.snoozeNaturalInput.tomorrowMorningNextWeek',
          defaultMessage: 'tomorrow morning, next week, friday afternoon…',
        })}
        onChange={(e) => {
          setText(e.target.value)
          setFailed(false)
          setResolved(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        disabled={disabled}
      />
      {failed && (
        <p className="text-xs text-destructive">
          {intl.formatMessage(
            {
              id: 'admin.inbox.snoozeNaturalInput.unreadable',
              defaultMessage: `Couldn't read that time. Try "{first}" or "{second}".`,
            },
            { first: 'tomorrow morning', second: 'next week' }
          )}
        </p>
      )}
      {resolved && (
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage(
            { id: 'admin.inbox.snoozeNaturalInput.until', defaultMessage: 'Snoozes until {date}' },
            {
              date: (
                <LocalDate
                  key="date"
                  date={resolved}
                  options={{
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }}
                />
              ),
            }
          )}
        </p>
      )}
    </div>
  )
}
