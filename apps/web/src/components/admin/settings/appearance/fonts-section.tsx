import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BUNDLED_FONTS,
  FONT_UPLOADS,
  fontStack,
  type BundledFontId,
} from '@/lib/shared/design/fonts'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { checkS3ConfiguredFn, getFontUploadUrlFn } from '@/lib/server/functions/uploads'
import { DesignTiles } from './design-tiles'

type Update = (change: (draft: PortalDesign) => void) => void
type DesignFont = PortalDesign['brand']['fonts']['body']
type UploadedFont = Extract<DesignFont, { kind: 'uploaded' }>
type HeadingWeight = PortalDesign['brand']['fonts']['headingWeight']
type Slot = 'heading' | 'body'

const FONT_CATEGORIES = [
  ['sans', 'Sans serif'],
  ['serif', 'Serif'],
  ['mono', 'Monospace'],
  ['system', 'System'],
] as const

const UPLOADED = 'uploaded:'
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const
const FAMILY = /^[\p{L}\p{N} ._-]{1,64}$/u

/** The weights a font has: a bundled family's stylesheet, or an uploaded family's upright files. */
function fontWeights(font: DesignFont): readonly number[] {
  if (font.kind === 'bundled') return BUNDLED_FONTS[font.id].weights
  return font.files.filter((file) => file.style === 'normal').map((file) => file.weight)
}

/** The heading weight to keep with a new heading font: the same one if it has it, else 600, else the first it has. */
export function closestWeight(font: DesignFont, current: HeadingWeight): HeadingWeight {
  const offered = DESIGN_OPTIONS.headingWeight.filter((weight) =>
    fontWeights(font).includes(weight)
  )
  if (offered.includes(current)) return current
  return offered.includes(600) ? 600 : (offered[0] ?? 600)
}

/** A weight and style read from a file name such as `Brand-SemiBoldItalic.woff2`. */
export function guessFace(name: string): { weight: number; style: 'normal' | 'italic' } {
  const lower = name.toLowerCase()
  const style = /italic|oblique/.test(lower) ? 'italic' : 'normal'
  const number = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(lower)
  if (number) return { weight: Number(number[1]), style }
  const named: Array<[RegExp, number]> = [
    [/extra-?light|ultra-?light/, 200],
    [/semi-?bold|demi-?bold/, 600],
    [/extra-?bold|ultra-?bold/, 800],
    [/thin|hairline/, 100],
    [/light/, 300],
    [/medium/, 500],
    [/black|heavy/, 900],
    [/bold/, 700],
  ]
  return { weight: named.find(([pattern]) => pattern.test(lower))?.[1] ?? 400, style }
}

/** A family name read from a file name: the part before its weight or style. */
export function guessFamily(name: string): string {
  const base = name.replace(/\.woff2$/i, '').split(/[-_]/)[0] ?? ''
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').trim()
}

/** The choice that leaves an optional font to another. */
const SAME = '__same__'

function FontSelect({
  id,
  label,
  value,
  uploaded,
  onChange,
  same,
}: {
  id: string
  label: string
  value: DesignFont | undefined
  uploaded: UploadedFont[]
  onChange: (font: DesignFont | undefined) => void
  /** Offers leaving it to another font, named so. */
  same?: string
}) {
  const current = !value ? SAME : value.kind === 'bundled' ? value.id : `${UPLOADED}${value.family}`
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
        {label}
      </label>
      <Select
        value={current}
        onValueChange={(next) => {
          if (next === SAME) return onChange(undefined)
          const own = uploaded.find((font) => `${UPLOADED}${font.family}` === next)
          onChange(own ?? { kind: 'bundled', id: next as BundledFontId })
        }}
      >
        <SelectTrigger id={id} className="h-8 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {same && <SelectItem value={SAME}>{same}</SelectItem>}
          {uploaded.length > 0 && (
            <SelectGroup>
              <SelectLabel>Your fonts</SelectLabel>
              {uploaded.map((font) => (
                <SelectItem key={font.family} value={`${UPLOADED}${font.family}`}>
                  {font.family}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {FONT_CATEGORIES.map(([category, heading]) => (
            <SelectGroup key={category}>
              <SelectLabel>{heading}</SelectLabel>
              {Object.entries(BUNDLED_FONTS)
                .filter(([, font]) => font.category === category)
                .map(([fontId, font]) => (
                  <SelectItem key={fontId} value={fontId}>
                    <span style={{ fontFamily: font.stack }}>{font.label}</span>
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface PendingFile {
  file: File
  weight: number
  style: 'normal' | 'italic'
}

/** What is wrong with the files and name before anything uploads, or null. */
function problem(family: string, files: PendingFile[]): string | null {
  if (files.length > FONT_UPLOADS.maxFiles) return 'A family takes up to six files.'
  const wrong = files.find(({ file }) => !/\.woff2$/i.test(file.name))
  if (wrong) return `${wrong.file.name} is not a woff2 file.`
  const large = files.find(({ file }) => file.size > FONT_UPLOADS.maxBytes)
  if (large) return `${large.file.name} is over 400 KB.`
  if (family && !FAMILY.test(family.trim()))
    return 'Use letters, numbers, spaces, dots, dashes and underscores in the name.'
  return null
}

/**
 * The workspace's own font: woff2 files with their weights, a family name,
 * where to use it and the licence to. Needs file storage; the plan's custom
 * CSS covers it.
 */
function OwnFont({ update }: { update: Update }) {
  const [open, setOpen] = useState(false)
  const storage = useQuery({
    queryKey: ['settings', 'storage'],
    queryFn: () => checkS3ConfiguredFn(),
    enabled: open,
    staleTime: Infinity,
  })
  const [files, setFiles] = useState<PendingFile[]>([])
  const [family, setFamily] = useState('')
  const [use, setUse] = useState<Slot | 'both'>('heading')
  const [licensed, setLicensed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // A file input keeps its own list; a new one starts empty after a font is added.
  const [picker, setPicker] = useState(0)
  const issue = problem(family, files)
  const ready = files.length > 0 && FAMILY.test(family.trim()) && licensed && !issue && !busy

  async function add() {
    setBusy(true)
    setRefusal(null)
    const uploaded: UploadedFont['files'] = []
    for (const { file, weight, style } of files) {
      const result = await getFontUploadUrlFn({
        data: { filename: file.name, fileSize: file.size },
      })
      if (!result.ok) {
        setRefusal(result.message)
        setBusy(false)
        return
      }
      const put = await fetch(result.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': FONT_UPLOADS.type },
      })
      if (!put.ok) {
        setRefusal(
          put.status === 413 ? `${file.name} is over 400 KB.` : `${file.name} is not a woff2 font.`
        )
        setBusy(false)
        return
      }
      uploaded.push({ key: result.key, weight, style })
    }
    update((draft) => {
      const fonts = draft.brand.fonts
      const own = (slot: Slot): UploadedFont => ({
        kind: 'uploaded',
        family: family.trim(),
        files: uploaded,
        fallback: fonts[slot].kind === 'bundled' ? fonts[slot].id : fonts[slot].fallback,
      })
      if (use !== 'body') {
        fonts.heading = own('heading')
        fonts.headingWeight = closestWeight(fonts.heading, fonts.headingWeight)
      }
      if (use !== 'heading') fonts.body = own('body')
    })
    setFiles([])
    setFamily('')
    setLicensed(false)
    setPicker(picker + 1)
    setBusy(false)
  }

  return (
    <details
      className="rounded-lg border border-border/60"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
        Your own font
      </summary>
      <div className="space-y-3 border-t border-border/60 p-3 text-[13px]">
        {storage.data && !storage.data.configured ? (
          <p className="text-muted-foreground">Uploading fonts needs file storage.</p>
        ) : (
          <>
            <Input
              key={picker}
              type="file"
              accept=".woff2,font/woff2"
              multiple
              aria-label="Font files"
              onChange={(event) => {
                const picked = [...(event.currentTarget.files ?? [])]
                setFiles(picked.map((file) => ({ file, ...guessFace(file.name) })))
                if (!family && picked[0]) setFamily(guessFamily(picked[0].name))
              }}
            />
            {files.map((entry, index) => (
              <div key={entry.file.name} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{entry.file.name}</span>
                <Select
                  value={String(entry.weight)}
                  onValueChange={(weight) =>
                    setFiles(
                      files.map((f, i) => (i === index ? { ...f, weight: Number(weight) } : f))
                    )
                  }
                >
                  <SelectTrigger aria-label={`Weight of ${entry.file.name}`} className="h-8 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHTS.map((weight) => (
                      <SelectItem key={weight} value={String(weight)}>
                        {weight}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={entry.style}
                  onValueChange={(style) =>
                    setFiles(
                      files.map((f, i) =>
                        i === index ? { ...f, style: style as PendingFile['style'] } : f
                      )
                    )
                  }
                >
                  <SelectTrigger aria-label={`Style of ${entry.file.name}`} className="h-8 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Upright</SelectItem>
                    <SelectItem value="italic">Italic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <label htmlFor="own-font-family" className="w-32 shrink-0">
                Name
              </label>
              <Input
                id="own-font-family"
                className="h-8 flex-1"
                value={family}
                onChange={(event) => setFamily(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="own-font-use" className="w-32 shrink-0">
                Use for
              </label>
              <Select value={use} onValueChange={(next) => setUse(next as typeof use)}>
                <SelectTrigger id="own-font-use" className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="heading">Headings</SelectItem>
                  <SelectItem value="body">Body</SelectItem>
                  <SelectItem value="both">Headings and body</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="own-font-licence"
                checked={licensed}
                onCheckedChange={(next) => setLicensed(next === true)}
              />
              <label htmlFor="own-font-licence">
                I have a licence to use this font on the web.
              </label>
            </div>
            {(issue ?? refusal) && (
              <p role="alert" className="text-destructive">
                {issue ?? refusal}
              </p>
            )}
            <Button size="sm" disabled={!ready} onClick={() => void add()}>
              {busy ? 'Uploading…' : 'Add font'}
            </Button>
          </>
        )}
      </div>
    </details>
  )
}

/** Brand › Fonts: the heading and body fonts, the heading weight, and the workspace's own font. */
export function FontsSection({ design, update }: { design: PortalDesign; update: Update }) {
  const { fonts } = design.brand
  const uploaded = [fonts.heading, fonts.body, fonts.display].filter(
    (font, index, all): font is UploadedFont =>
      font?.kind === 'uploaded' &&
      all.findIndex((other) => other?.kind === 'uploaded' && other.family === font.family) === index
  )
  const weights = DESIGN_OPTIONS.headingWeight.filter((weight) =>
    fontWeights(fonts.heading).includes(weight)
  )

  return (
    <>
      <section className="space-y-2">
        <p className="text-[13px] font-medium">Fonts</p>
        <FontSelect
          id="font-heading"
          label="Headings"
          value={fonts.heading}
          uploaded={uploaded}
          onChange={(font) =>
            update((draft) => {
              if (!font) return
              draft.brand.fonts.heading = font
              draft.brand.fonts.headingWeight = closestWeight(font, draft.brand.fonts.headingWeight)
            })
          }
        />
        <FontSelect
          id="font-display"
          label="Page headlines"
          value={fonts.display}
          uploaded={uploaded}
          same="Same as headings"
          onChange={(font) =>
            update((draft) => {
              if (font) draft.brand.fonts.display = font
              else delete draft.brand.fonts.display
            })
          }
        />
        <FontSelect
          id="font-body"
          label="Body"
          value={fonts.body}
          uploaded={uploaded}
          onChange={(font) => update((draft) => void (font && (draft.brand.fonts.body = font)))}
        />
        <OwnFont update={update} />
      </section>

      <DesignTiles
        name="design-heading-weight"
        label="Heading weight"
        value={String(fonts.headingWeight)}
        columns={4}
        onChange={(weight) =>
          update(
            (draft) => void (draft.brand.fonts.headingWeight = Number(weight) as HeadingWeight)
          )
        }
        options={weights.map((weight) => ({
          value: String(weight),
          label: String(weight),
          drawing: (
            <span
              className="text-base"
              style={{ fontWeight: weight, fontFamily: fontStack(fonts.heading) }}
            >
              Aa
            </span>
          ),
        }))}
      />
    </>
  )
}
