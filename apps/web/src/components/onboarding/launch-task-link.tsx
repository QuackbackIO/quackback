import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { LaunchTask } from '@/lib/shared/launch-checklist'
import { openGoingLiveSheet } from './going-live-events'

/**
 * A launch step as a link: its sheet opens in place, otherwise its page opens.
 * Null children fall back to nothing for a step with neither, so callers can
 * render it as text instead.
 */
export function LaunchTaskLink({
  task,
  className,
  children,
}: {
  task: LaunchTask
  className?: string
  children: ReactNode
}) {
  if (task.sheet) {
    const sheet = task.sheet
    return (
      <button type="button" className={className} onClick={() => openGoingLiveSheet(sheet)}>
        {children}
      </button>
    )
  }
  if (task.href) {
    return (
      <Link to={task.href} search={task.search as never} className={className}>
        {children}
      </Link>
    )
  }
  return <span className={className}>{children}</span>
}
