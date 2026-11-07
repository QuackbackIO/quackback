import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClientOnly, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { PortalPreview } from '@/components/admin/settings/branding/portal-preview'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { switchPortalDesignFn } from '@/lib/server/functions/portal-design'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'

interface Issue {
  message: string
  line?: number
}

const NO_DRAFT: PortalPreviewDraft = {}

/** The card's anchor, which the portal header's Customise button links to. */
const DESIGN_SWITCH_ID = 'design-switch'

function Issues({ label, issues }: { label: string; issues: readonly Issue[] }) {
  if (issues.length === 0) return null
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium">{label}</h3>
      <ul aria-label={label} className="space-y-1 text-xs text-muted-foreground">
        {issues.map((issue, index) => (
          <li key={`${issue.line}-${index}`}>
            {issue.line ? `Line ${issue.line}: ` : ''}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A portal with its own CSS stays on its old theme until someone switches.
 * The card compares the portal as it is with the portal switched, reports
 * what becomes of the CSS, and switches. Refused CSS has to be fixed in
 * Advanced CSS first.
 */
export function DesignSwitchCard({
  workspaceName,
  faviconUrl,
}: {
  workspaceName: string
  faviconUrl: string | null
}) {
  const state = useQuery(portalDesignQueries.switch())
  const router = useRouter()
  const queryClient = useQueryClient()
  const [comparing, setComparing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const available = state.data?.available === true
  const section = useRef<HTMLElement>(null)
  // The portal header's Customise button links here; the card loads after the page does.
  useEffect(() => {
    if (available && window.location.hash === `#${DESIGN_SWITCH_ID}`) {
      section.current?.scrollIntoView({ block: 'start' })
    }
  }, [available])
  if (!state.data?.available) return null
  const { report, canPublish } = state.data
  const blocked = report.errors.length > 0 || !canPublish

  async function switchNow() {
    setSwitching(true)
    setRefusal(null)
    const outcome = await switchPortalDesignFn()
    if (outcome.ok) {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await router.invalidate()
    } else {
      setRefusal(outcome.message)
    }
    setSwitching(false)
  }

  const frame = (switched: boolean) => (
    <ClientOnly>
      <PortalPreview
        theme="light"
        refreshKey={switched ? 'switched' : 'today'}
        draftCss=""
        cssDirty={false}
        draft={NO_DRAFT}
        draftDirty={false}
        viewport="desktop"
        workspaceName={workspaceName}
        faviconUrl={faviconUrl}
        scaleToDesktop
        switched={switched}
      />
    </ClientOnly>
  )

  return (
    <section
      ref={section}
      id={DESIGN_SWITCH_ID}
      aria-labelledby="design-switch-title"
      className="space-y-4 rounded-lg border border-border/60 bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p id="design-switch-title" className="min-w-0 flex-1 text-sm font-medium">
          Your portal uses custom CSS. Switch to the new design system.
        </p>
        <Button variant="outline" size="sm" onClick={() => setComparing(!comparing)}>
          {comparing ? 'Hide comparison' : 'Compare'}
        </Button>
        <Button size="sm" disabled={blocked || switching} onClick={() => void switchNow()}>
          Switch
        </Button>
      </div>
      {!canPublish && (
        <p className="text-[13px] text-muted-foreground">
          Switching needs permission to publish the design.
        </p>
      )}
      {refusal && (
        <p role="alert" className="text-[13px] text-destructive">
          {refusal}
        </p>
      )}
      <Issues label="Fix in Advanced CSS before switching" issues={report.errors} />
      <Issues label="Moves into the design" issues={report.carried} />
      <Issues label="Check after switching" issues={report.warnings} />
      {comparing && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <figure className="min-w-0 space-y-2">
            <figcaption className="text-xs font-medium text-muted-foreground">Today</figcaption>
            {frame(false)}
          </figure>
          <figure className="min-w-0 space-y-2">
            <figcaption className="text-xs font-medium text-muted-foreground">
              After switching
            </figcaption>
            {frame(true)}
          </figure>
        </div>
      )}
    </section>
  )
}
