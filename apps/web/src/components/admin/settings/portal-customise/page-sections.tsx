import { useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { RichTextEditor, type EditorDocument } from '@/components/ui/rich-text-editor'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { HelpCenterHeaderLink } from '@/lib/shared/types/settings'
import type { HelpCenterHomeDraft } from './portal-draft'

/** The Feedback home's welcome message, above the post list. */
export function WelcomeSection({
  value,
  onChange,
}: {
  value: TiptapContent
  onChange: (body: TiptapContent) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Shown above the post list on your portal home. Leave empty to show nothing.
      </p>
      <WelcomeBodyEditor value={value} onChange={onChange} />
    </div>
  )
}

/** Isolated so the rich-text editor's heavy deps don't re-render the page. */
export function WelcomeBodyEditor({
  value,
  onChange,
}: {
  value: TiptapContent
  onChange: (v: TiptapContent) => void
}) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })
  // The editor reports its document once it mounts. The same document again
  // is not an edit, and adopting that copy would re-render the whole page.
  // The live preview and the dirty check read the JSON, so each edit takes it.
  const handleChange = useCallback(
    (document: EditorDocument) => {
      const json = document.json()
      if (JSON.stringify(json) === JSON.stringify(value)) return
      onChange(json as TiptapContent)
    },
    [value, onChange]
  )
  return (
    <RichTextEditor
      value={value}
      onDocumentChange={handleChange}
      placeholder="Tell visitors what kind of feedback you'd love to hear…"
      minHeight="140px"
      className="[&_button]:size-6 [&_button_svg]:size-3.5"
      features={{
        headings: true,
        images: true,
        codeBlocks: true,
        taskLists: true,
        blockquotes: true,
        tables: true,
        dividers: true,
        bubbleMenu: true,
        slashMenu: true,
        embeds: true,
        quackbackEmbeds: true,
      }}
      onImageUpload={uploadImage}
    />
  )
}

const MAX_LINKS = 3

/** The Help Center home's title, description and header links. */
export function HelpCenterHomeSection({
  value,
  onChange,
}: {
  value: HelpCenterHomeDraft
  onChange: (next: HelpCenterHomeDraft, burst?: string) => void
}) {
  const setLink = (index: number, link: HelpCenterHeaderLink) =>
    onChange(
      { ...value, headerLinks: value.headerLinks.map((l, i) => (i === index ? link : l)) },
      `hc-link-${index}`
    )
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="hc-home-title" className="text-[13px] font-medium">
          Title
        </Label>
        <Input
          id="hc-home-title"
          value={value.homepageTitle}
          maxLength={200}
          placeholder="How can we help?"
          onChange={(event) =>
            onChange({ ...value, homepageTitle: event.target.value }, 'hc-title')
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hc-home-description" className="text-[13px] font-medium">
          Description
        </Label>
        <Textarea
          id="hc-home-description"
          value={value.homepageDescription}
          maxLength={500}
          rows={3}
          onChange={(event) =>
            onChange({ ...value, homepageDescription: event.target.value }, 'hc-description')
          }
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium">Header links</p>
        {value.headerLinks.map((link, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              aria-label={`Link ${index + 1} label`}
              value={link.label}
              maxLength={60}
              placeholder="Label"
              className="w-28 shrink-0"
              onChange={(event) => setLink(index, { ...link, label: event.target.value })}
            />
            <Input
              aria-label={`Link ${index + 1} address`}
              value={link.url}
              maxLength={500}
              placeholder="https://… or /path"
              className="min-w-0 flex-1"
              onChange={(event) => setLink(index, { ...link, url: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove link ${index + 1}`}
              onClick={() =>
                onChange({
                  ...value,
                  headerLinks: value.headerLinks.filter((_, i) => i !== index),
                })
              }
            >
              <XMarkIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {value.headerLinks.length < MAX_LINKS ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({ ...value, headerLinks: [...value.headerLinks, { label: '', url: '' }] })
            }
          >
            Add link
          </Button>
        ) : null}
      </div>
      <Link
        to="/admin/settings/help-center"
        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-[13px] transition-colors hover:bg-muted/40"
      >
        <span>Domain and languages</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          Help Center settings
          <ChevronRightIcon className="rtl:-scale-x-100 size-4" aria-hidden="true" />
        </span>
      </Link>
    </div>
  )
}

/** Roadmap and Changelog have no look settings of their own. */
export function PageNote({ page }: { page: 'roadmap' | 'changelog' }) {
  if (page === 'roadmap') {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Roadmap has no look settings of its own. Everything under Whole portal applies here. Roadmap
        names, columns and descriptions are set in Roadmap settings.{' '}
        <Link to="/admin/roadmap" className={INLINE_LINK}>
          Roadmap settings ›
        </Link>
      </p>
    )
  }
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Changelog has no look settings of its own. Everything under Whole portal applies here. Entries
      and categories are managed in Changelog.{' '}
      <Link to="/admin/changelog" className={INLINE_LINK}>
        Changelog ›
      </Link>
    </p>
  )
}
