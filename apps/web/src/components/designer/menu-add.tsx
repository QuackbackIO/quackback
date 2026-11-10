import { useState } from 'react'
import { ArrowTopRightOnSquareIcon, LinkIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { menuParts, offParts, MENU_MAX } from '@/lib/shared/design/menu'
import { HEADER_COPY, MENU_COPY, menuStep } from '@/lib/shared/design/menu-actions'
import { Tag } from './tag'
import type { PageGateSettings, PortalPageGates } from '@/lib/shared/design/paths'
import { isSamplePage, type SamplePage } from '@/lib/shared/design/sample-pages'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { MenuLinkForm, type NamedUpdate } from './menu-link-form'

/** The parts "+" offers beside a link. */
const ADDABLE = ['support', 'status'] as const

/**
 * What "+" at the end of the menu adds: Support and Status, turned on in
 * their settings (which goes live) or put back in the menu, and a link.
 */
export function MenuAdd({
  design,
  gates,
  settings,
  update,
  onSample,
  onDone,
}: {
  design: PortalDesign
  gates: PortalPageGates
  settings: PageGateSettings
  update: NamedUpdate
  onSample?: (page: SamplePage) => void
  onDone: () => void
}) {
  const [linking, setLinking] = useState(false)
  const off = offParts(gates, settings).filter((part) =>
    (ADDABLE as readonly string[]).includes(part.type)
  )
  const hidden = menuParts(design, gates).filter(
    (part) => (ADDABLE as readonly string[]).includes(part.id) && !part.shown
  )
  const full = design.nav.items.length >= MENU_MAX
  if (linking)
    return (
      <MenuLinkForm
        update={update}
        onDone={(added) => {
          setLinking(false)
          if (added) onDone()
        }}
      />
    )
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{MENU_COPY.add}</h2>
      <ul className="space-y-2">
        {hidden.map((part) => (
          <li key={part.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <p className="text-[13px] font-medium">{part.label}</p>
            <Tag>{HEADER_COPY.hidden}</Tag>
            <span className="me-auto" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const step = menuStep(design, gates, part.id, 'show')
                if (step) update(step.change, step.label)
                onDone()
              }}
            >
              {HEADER_COPY.show}
            </Button>
          </li>
        ))}
        {off.map((part) => (
          <li key={part.type} className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-[13px] font-medium">{part.name}</p>
            <p className="text-xs text-muted-foreground">{part.does}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {onSample && isSamplePage(part.type) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  aria-label={`Preview ${part.name} with sample content`}
                  onClick={() => {
                    onSample(part.type as SamplePage)
                    onDone()
                  }}
                >
                  Preview
                </Button>
              )}
              <a
                href={part.href}
                target="_blank"
                rel="noopener"
                title="Goes live"
                className="inline-flex min-h-6 items-center gap-1 text-xs font-medium underline underline-offset-2"
              >
                Turn on
                <span className="sr-only"> (goes live, opens in a new tab)</span>
                <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </li>
        ))}
        <li>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={full}
            aria-describedby={full ? 'menu-add-full' : undefined}
            onClick={() => setLinking(true)}
          >
            <LinkIcon className="size-4" aria-hidden="true" />
            {MENU_COPY.addLink}
          </Button>
          {full && (
            <p id="menu-add-full" className="pt-1 text-xs text-muted-foreground">
              The menu holds {MENU_MAX}
            </p>
          )}
        </li>
      </ul>
    </div>
  )
}
