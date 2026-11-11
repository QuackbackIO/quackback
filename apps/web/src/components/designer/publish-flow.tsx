import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ReviewPublishDialog } from '@/components/admin/settings/appearance/review-publish-dialog'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { designerPublished } from '@/lib/client/builder-events'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalAddress } from '@/lib/shared/design/portal-address'
import { useOpenedOnce } from '@/lib/client/hooks/use-opened-once'
import {
  fullReviewReason,
  opensFullReview,
  publishSummary,
} from '@/lib/shared/design/publish-summary'
import { newWorkspaceLogo } from '@/lib/shared/design/workspace-logo'
import { PublishSummaryDialog } from './publish-summary-dialog'

/** A summary with nothing in it, until there is one to show. */
const NO_SUMMARY = { menu: [], look: [], overrides: [] }

/** What publishing reads from the draft. */
export type PublishDraft = Pick<
  ReturnType<typeof useDesignDraft>,
  'live' | 'design' | 'changes' | 'report' | 'canPublish' | 'published' | 'publish' | 'flush'
>

/**
 * Publish's two steps: a short summary, or the full review when there is
 * too much to sum up, a check fails, or someone asks to see everything.
 * Returns what starts it and the dialogs to render.
 */
export function usePublishFlow({
  draft,
  gates,
  failingChecks,
  checks = [],
  onShowCheck = () => {},
  compare,
}: {
  draft: PublishDraft
  gates: PortalPageGates
  /** How many of the server's checks the draft fails, which only the full review shows. */
  failingChecks: number
  /** Things to check before publishing, which the summary lists. */
  checks?: readonly DesignCheck[]
  /** "Show me" on a check: picks the part that fixes it. */
  onShowCheck?: (part: Selection) => void
  /** The page as visitors see it and as it will be, while the full review is open. */
  compare: () => ReactNode
}) {
  const [step, setStep] = useState<'summary' | 'full' | null>(null)
  const [published, setPublished] = useState<PortalAddress | null>(null)
  const [reason, setReason] = useState<string | undefined>()
  const newLogo = !!newWorkspaceLogo(draft.live, draft.design)
  const count = draft.changes.length

  // The full review lists the draft once the last change has saved.
  const openFull = async (why?: string) => {
    await draft.flush()
    setReason(why)
    setStep('full')
  }
  const start = async () => {
    if (!draft.canPublish || opensFullReview(count, failingChecks))
      return openFull(draft.canPublish ? fullReviewReason(failingChecks) : undefined)
    setStep('summary')
  }
  const publish = async (
    fullReview: boolean,
    message: string | undefined,
    options: { workspaceLogo: boolean }
  ) => {
    const offered = newLogo
    const outcome = await draft.publish(message, options)
    // Another version went live after the draft started, such as by a restore: review
    // the draft against it in full. The summary closes; publishing waits for the review.
    if (!outcome.ok && outcome.changed && !fullReview) {
      setReason(outcome.message)
      setStep('full')
      return { ok: true as const }
    }
    if (outcome.ok) {
      // The live address on Publish itself; a toast only when the server sent none.
      if (outcome.address) setPublished(outcome.address)
      else toast.success('Published. Visitors see it now.')
      designerPublished(draft, { ...options, logoOffered: offered, fullReview })
    }
    return outcome
  }

  const summary = useMemo(
    () => (step ? publishSummary(draft.live, draft.design, draft.changes, gates) : null),
    [step, draft.live, draft.design, draft.changes, gates]
  )
  // What the dialogs show while open, kept as it was while one closes: publishing empties
  // the draft's changes, and a dialog fading out with its content gone collapses to a stub.
  const current = {
    count,
    summary: summary ?? NO_SUMMARY,
    changes: draft.changes,
    report: draft.report,
    newLogo,
    design: draft.design,
    compare: step === 'full' ? compare() : null,
  }
  const kept = useRef(current)
  useLayoutEffect(() => {
    if (step) kept.current = current
  })
  const shown = step ? current : kept.current
  const summaryOpened = useOpenedOnce(step === 'summary')
  const fullOpened = useOpenedOnce(step === 'full')
  // Neither is drawn until Publish first opens it; after that it stays, so closing can animate.
  const dialogs = (
    <>
      {summaryOpened && (
        <PublishSummaryDialog
          open={step === 'summary'}
          onOpenChange={(open) => !open && setStep((now) => (now === 'summary' ? null : now))}
          count={shown.count}
          summary={shown.summary}
          newLogo={shown.newLogo}
          checks={checks}
          onShowCheck={(part) => {
            setStep(null)
            onShowCheck(part)
          }}
          onSeeEverything={() => void openFull()}
          onPublish={(options) => publish(false, undefined, options)}
        />
      )}
      {fullOpened && (
        <ReviewPublishDialog
          open={step === 'full'}
          onOpenChange={(open) => !open && setStep(null)}
          changes={shown.changes}
          menu={shown.summary.menu}
          summary={[...shown.summary.look, ...shown.summary.overrides]}
          report={shown.report}
          newLogo={shown.newLogo}
          reason={reason}
          onPublish={(message, options) => publish(true, message, options)}
          canPublish={draft.canPublish}
          compare={shown.compare}
          design={shown.design}
        />
      )}
    </>
  )
  return {
    start,
    reviewing: step === 'full',
    dialogs,
    /** Where the portal went live, for the popover on Publish; null once it closes. */
    published,
    closePublished: () => setPublished(null),
  }
}
