import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      <Label htmlFor="snooze-natural-input">Type a time</Label>
      <Input
        id="snooze-natural-input"
        value={text}
        placeholder="tomorrow morning, next week, friday afternoon…"
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
          Couldn&apos;t read that time — try &quot;tomorrow morning&quot; or &quot;next week&quot;.
        </p>
      )}
      {resolved && (
        <p className="text-xs text-muted-foreground">
          Snoozes until{' '}
          {resolved.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
      )}
    </div>
  )
}
