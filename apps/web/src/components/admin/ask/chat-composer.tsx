import { useEffect, useRef, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpIcon, StopIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface ChatComposerProps {
  query: string
  onQueryChange: (query: string) => void
  canAsk: boolean
  busy: boolean
  onAsk: (question: string) => void
  onStop: () => void
  autoFocus?: boolean
  footerActions?: ReactNode
}

export function ChatComposer({
  query,
  onQueryChange,
  canAsk,
  busy,
  onAsk,
  onStop,
  autoFocus = true,
  footerActions,
}: ChatComposerProps) {
  const intl = useIntl()
  const input = useRef<HTMLTextAreaElement>(null)
  const question = query.trim()
  const canSend = canAsk && !busy && question.length > 0
  const placeholder = intl.formatMessage({
    id: 'ask.composer.placeholder',
    defaultMessage: 'Ask or tell Quackback anything',
  })
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-float transition-[box-shadow,border-color,translate] duration-300 ease-out focus-within:-translate-y-px focus-within:border-muted-foreground focus-within:shadow-float-focus motion-reduce:transition-none motion-reduce:focus-within:translate-y-0">
      <Textarea
        ref={input}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={2}
        className="max-h-40 min-h-20 resize-none rounded-none border-0 px-2 py-1 text-base shadow-none focus:border-transparent md:text-base"
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          ) {
            event.preventDefault()
            if (canSend) onAsk(question)
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 ps-2">
        <span
          className={
            footerActions
              ? 'hidden text-[11px] text-muted-foreground sm:block'
              : 'text-[11px] text-muted-foreground'
          }
        >
          {intl.formatMessage({
            id: 'ask.chat.keyboardHint',
            defaultMessage: 'Enter to send · Shift+Enter for a new line',
          })}
        </span>
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {footerActions}
          {busy ? (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="shrink-0 rounded-full focus-visible:ring-muted-foreground"
              aria-label={intl.formatMessage({ id: 'ask.chat.stop', defaultMessage: 'Stop' })}
              onClick={onStop}
            >
              <StopIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="shrink-0 rounded-full focus-visible:ring-muted-foreground"
              aria-label={intl.formatMessage({
                id: 'ask.composer.ask',
                defaultMessage: 'Ask Copilot',
              })}
              disabled={!canSend}
              onClick={() => onAsk(question)}
            >
              <ArrowUpIcon className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
