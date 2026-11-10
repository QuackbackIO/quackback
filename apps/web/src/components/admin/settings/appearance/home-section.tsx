import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { HomeBlock } from '@/lib/shared/design/home'

/**
 * The section's small icons, drawn here: an icon module this page shared with
 * others would become a chunk of its own on all of them.
 */
function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d={path} />
    </svg>
  )
}
const PLUS =
  'M8 2.75a.75.75 0 0 1 .75.75v3.75h3.75a.75.75 0 0 1 0 1.5H8.75v3.75a.75.75 0 0 1-1.5 0V8.75H3.5a.75.75 0 0 1 0-1.5h3.75V3.5A.75.75 0 0 1 8 2.75Z'
const CROSS =
  'M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06Z'

type Link = Extract<HomeBlock, { type: 'links' }>['links'][number]

/** A link the design accepts: a name and an http(s) address. */
function validLink(link: Link): boolean {
  const label = link.label.trim()
  return label.length > 0 && label.length <= 40 && /^https?:\/\/[^\s]+$/i.test(link.url.trim())
}

/**
 * The block's heading and links. A link reaches the draft once it has a
 * name and a full web address, so a half-typed one is never saved.
 */
export function LinksOptions({
  block,
  change,
  withHeading,
}: {
  block: Extract<HomeBlock, { type: 'links' }>
  change: (apply: (draft: HomeBlock) => void) => void
  withHeading: boolean
}) {
  const [links, setLinks] = useState<Link[]>(block.links)
  const commit = (next: Link[]) => {
    setLinks(next)
    const valid = next.filter(validLink)
    if (valid.length > 0 && valid.length === next.length)
      change((draft) => void ((draft as typeof block).links = valid))
  }
  return (
    <div className="space-y-2">
      {withHeading && (
        <Input
          aria-label="Links heading"
          placeholder="Links"
          value={block.title ?? ''}
          maxLength={40}
          onChange={(event) =>
            change((draft) => {
              const title = event.target.value.trim() ? event.target.value : undefined
              if (title) (draft as typeof block).title = title
              else delete (draft as typeof block).title
            })
          }
        />
      )}
      {links.map((link, index) => {
        const wrong = link.url !== '' && !validLink({ label: 'x', url: link.url })
        return (
          <div key={index} className="space-y-1">
            {/* The name on its own row, so it shows whole in a narrow panel. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                aria-label={`Link ${index + 1} name`}
                placeholder="Name"
                value={link.label}
                maxLength={40}
                className="basis-full"
                onChange={(event) =>
                  commit(
                    links.map((l, i) => (i === index ? { ...l, label: event.target.value } : l))
                  )
                }
              />
              <Input
                aria-label={`Link ${index + 1} address`}
                placeholder="https://example.com"
                type="url"
                value={link.url}
                aria-invalid={wrong}
                aria-describedby={wrong ? `link-${index}-wrong` : undefined}
                className="w-auto min-w-0 flex-1"
                onChange={(event) =>
                  commit(links.map((l, i) => (i === index ? { ...l, url: event.target.value } : l)))
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove link ${index + 1}`}
                title={`Remove link ${index + 1}`}
                disabled={links.length === 1}
                onClick={() => commit(links.filter((_, i) => i !== index))}
              >
                <Icon path={CROSS} className="size-4" />
              </Button>
            </div>
            {wrong && (
              <p id={`link-${index}-wrong`} role="alert" className="text-xs text-destructive">
                Use a full address, starting with https://. Until then the link is not saved.
              </p>
            )}
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        disabled={links.length >= 6}
        onClick={() => setLinks([...links, { label: '', url: '' }])}
      >
        <Icon path={PLUS} className="size-4" />
        Add a link
      </Button>
    </div>
  )
}
