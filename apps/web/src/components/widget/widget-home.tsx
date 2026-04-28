import { lazy, Suspense } from 'react'
import { useIntl } from 'react-intl'
import { PencilIcon } from '@heroicons/react/24/solid'
import type { WidgetHomeProps } from './widget-home-animated'

// Defer framer-motion (~360KB minified) to a client-only chunk. The widget
// home form is interactive — it expands on input — so SSR only needs a
// static collapsed shell that matches the animated version's layout.
const WidgetHomeAnimated = lazy(() =>
  import('./widget-home-animated').then((m) => ({ default: m.WidgetHomeAnimated }))
)

function WidgetHomeFallback() {
  const intl = useIntl()
  return (
    <form className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="w-full px-3 pt-2 pb-3">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <PencilIcon className="w-3.5 h-3.5 text-primary" />
              </div>
              <input
                type="text"
                readOnly
                placeholder={intl.formatMessage({
                  id: 'widget.home.input.placeholder',
                  defaultMessage: "What's your idea?",
                })}
                className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/50"
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}

export function WidgetHome(props: WidgetHomeProps) {
  return (
    <Suspense fallback={<WidgetHomeFallback />}>
      <WidgetHomeAnimated {...props} />
    </Suspense>
  )
}
