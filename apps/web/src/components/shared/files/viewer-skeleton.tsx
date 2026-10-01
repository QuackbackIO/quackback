/**
 * The viewer's one loading state: a page-ish block resting on the desk. The
 * shell shows it while the bytes arrive, and every engine shows the same one
 * until its content is ready, so a file never opens onto a blank area.
 */
import { useIntl } from 'react-intl'

export function ViewerSkeleton() {
  const intl = useIntl()
  return (
    <div
      role="status"
      aria-label={intl.formatMessage({
        id: 'files.viewer.loadingAria',
        defaultMessage: 'Loading file',
      })}
      className="flex flex-1 items-start justify-center overflow-hidden px-4 py-6 sm:px-16 sm:py-7"
    >
      <div className="aspect-[1/1.29] w-full max-w-[600px] animate-pulse rounded-[2px] bg-background/80 shadow-sm motion-reduce:animate-none" />
    </div>
  )
}
