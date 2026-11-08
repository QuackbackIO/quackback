import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ReviewPublishDialog } from '@/components/admin/settings/appearance/review-publish-dialog'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { designerPublished } from '@/lib/client/builder-events'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalAddress } from '@/lib/shared/design/portal-address'
import { opensFullReview, publishSummary } from '@/lib/shared/design/publish-summary'
import { newWorkspaceLogo } from '@/lib/shared/design/workspace-logo'
import { fullReviewReason, PublishSummaryDialog } from './publish-summary-dialog'

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
      return openFull(draft.canPublish ? fullReviewReason(count, failingChecks) : undefined)
    setStep('summary')
  }
  const publish = async (
    fullReview: boolean,
    message: string | undefined,
    options: { workspaceLogo: boolean }
  ) => {
    const offered = newLogo
    const outcome = await draft.publish(message, options)
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
  const dialogs = (
    <>
      <PublishSummaryDialog
        open={step === 'summary'}
        onOpenChange={(open) => !open && setStep(null)}
        count={count}
        summary={summary ?? { menu: [], look: [], overrides: [] }}
        newLogo={newLogo}
        checks={checks}
        onShowCheck={(part) => {
          setStep(null)
          onShowCheck(part)
        }}
        onSeeEverything={() => void openFull()}
        onPublish={(options) => publish(false, undefined, options)}
      />
      <ReviewPublishDialog
        open={step === 'full'}
        onOpenChange={(open) => !open && setStep(null)}
        changes={draft.changes}
        menu={summary?.menu ?? []}
        report={draft.report}
        newLogo={newLogo}
        reason={reason}
        onPublish={(message, options) => publish(true, message, options)}
        canPublish={draft.canPublish}
        compare={step === 'full' ? compare() : null}
      />
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
