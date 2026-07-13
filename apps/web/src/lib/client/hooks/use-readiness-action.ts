import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { launchChecklistSummary } from '@/lib/shared/launch-checklist'
import { useIntl } from 'react-intl'

/** The first actionable, unblocked prerequisite from the canonical readiness model. */
export function useReadinessAction() {
  const intl = useIntl()
  const query = useQuery(adminQueries.onboardingStatus())
  if (!query.data) return null
  const summary = launchChecklistSummary(query.data)
  const task = summary.tasks.find(
    (candidate) =>
      candidate.classification === 'prerequisite' &&
      !candidate.isCompleted &&
      !candidate.isDismissed &&
      candidate.availability === 'available' &&
      candidate.href
  )
  return task?.href
    ? {
        href: task.href,
        label: intl.formatMessage({
          id: `activation.task.${summary.outcome}.${task.id}.action`,
          defaultMessage: task.actionLabel ?? task.title,
        }),
        outcome: summary.outcome,
      }
    : null
}
