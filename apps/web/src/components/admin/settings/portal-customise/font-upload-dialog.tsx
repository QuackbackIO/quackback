import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getFontUploadUrlFn } from '@/lib/server/functions/uploads'
import { putStorageUpload } from '@/lib/client/storage-upload'
import { errorText } from '@/lib/client/error-text'
import { FONT_UPLOADS } from '@/lib/shared/theme/font-uploads'
import type { BrandingFontId, CustomFont, CustomFontFile } from '@/lib/shared/theme'
import { FONT_OPTIONS } from '@/components/admin/settings/branding/font-options'
import {
  FONT_WEIGHTS,
  fontUploadProblem,
  guessFace,
  guessFamily,
  type FontStyle,
  type PendingFontFile,
} from './font-upload'

interface FontUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The listed font the family falls back to at first: the font in use. */
  defaultFallback: BrandingFontId
  /** The family's name to start with (Import names the site's licensed font). */
  initialFamily?: string
  /** The uploaded family, with the stack of the listed font it falls back to. */
  onUploaded: (font: CustomFont, fallbackValue: string) => void
  /**
   * A family for titles and headings: it falls back to the text font, so no
   * fallback is asked for, and only the heavier cuts are.
   */
  headings?: boolean
}

/**
 * Upload a font: the licensed files with each one's weight and style, the
 * family's name and the listed font shown until it loads. Every file is
 * uploaded before the draft changes, so a refusal leaves the font as it was.
 */
export function FontUploadDialog({
  open,
  onOpenChange,
  defaultFallback,
  initialFamily = '',
  onUploaded,
  headings = false,
}: FontUploadDialogProps) {
  const id = useId()
  const [files, setFiles] = useState<PendingFontFile[]>([])
  const [family, setFamily] = useState(initialFamily)
  const [fallback, setFallback] = useState<BrandingFontId>(defaultFallback)
  const [licensed, setLicensed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const problem = fontUploadProblem(family, files)
  const ready = files.length > 0 && family.trim().length > 0 && licensed && !problem && !busy

  function reset(nextOpen: boolean) {
    if (!nextOpen) {
      setFiles([])
      setFamily('')
      setLicensed(false)
      setRefusal(null)
      setFallback(defaultFallback)
    }
    onOpenChange(nextOpen)
  }

  function take(picked: File[]) {
    setRefusal(null)
    setFiles(picked.map((file) => ({ file, ...guessFace(file.name) })))
    if (!family.trim() && picked[0]) setFamily(guessFamily(picked[0].name))
  }

  const setFace = (index: number, face: Partial<Pick<PendingFontFile, 'weight' | 'style'>>) =>
    setFiles(files.map((f, i) => (i === index ? { ...f, ...face } : f)))

  async function upload() {
    setBusy(true)
    setRefusal(null)
    const uploaded: CustomFontFile[] = []
    try {
      for (const { file, weight, style } of files) {
        const result = await getFontUploadUrlFn({
          data: { filename: file.name, fileSize: file.size },
        })
        if (!result.ok) {
          setRefusal(result.message)
          return
        }
        // The upload URL is signed for this type; a picked file often has none.
        const body = new Blob([file], { type: result.contentType })
        const notStored = `${file.name} couldn't be uploaded. Check it's a font file.`
        try {
          await putStorageUpload(result.uploadUrl, body, notStored)
        } catch {
          setRefusal(notStored)
          return
        }
        uploaded.push({ key: result.key, weight, style })
      }
    } catch (error) {
      setRefusal(errorText(error, "Couldn't upload the font. Try again."))
      return
    } finally {
      setBusy(false)
    }
    const option = FONT_OPTIONS.find((f) => f.id === fallback) ?? FONT_OPTIONS[0]!
    onUploaded({ family: family.trim(), files: uploaded, fallback }, option.value)
    reset(false)
  }

  const name = family.trim() || 'your font'
  const shown = problem ?? refusal

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{headings ? 'Upload a headings font' : 'Upload a font'}</DialogTitle>
          <DialogDescription>
            {headings
              ? `Add your licensed font files for ${name}: semi-bold and bold, in WOFF2, WOFF, TTF or OTF. Headings fall back to the text font.`
              : `Add your licensed font files for ${name}: regular, medium, semi-bold and bold, in WOFF2, WOFF, TTF or OTF.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Upload only fonts your licence lets you use on the web. We never copy fonts from your
            website.
          </p>
          <div>
            <input
              id={`${id}-files`}
              type="file"
              multiple
              accept={FONT_UPLOADS.accept}
              aria-label="Font files"
              className="peer sr-only"
              onChange={(event) => take([...(event.currentTarget.files ?? [])])}
            />
            <label
              htmlFor={`${id}-files`}
              className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
            >
              Choose files
            </label>
          </div>

          {files.map((entry, index) => (
            <div key={`${entry.file.name}-${index}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs" title={entry.file.name}>
                {entry.file.name}
              </span>
              <Select
                value={String(entry.weight)}
                onValueChange={(weight) => setFace(index, { weight: Number(weight) })}
              >
                <SelectTrigger aria-label={`Weight of ${entry.file.name}`} className="h-8 w-20">
                  <SelectValue>{entry.weight}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FONT_WEIGHTS.map((weight) => (
                    <SelectItem key={weight} value={String(weight)}>
                      {weight}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={entry.style}
                onValueChange={(style) => setFace(index, { style: style as FontStyle })}
              >
                <SelectTrigger aria-label={`Style of ${entry.file.name}`} className="h-8 w-24">
                  <SelectValue>{entry.style === 'italic' ? 'Italic' : 'Upright'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Upright</SelectItem>
                  <SelectItem value="italic">Italic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}

          <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
            <label htmlFor={`${id}-family`} className="text-xs">
              Name
            </label>
            <Input
              id={`${id}-family`}
              className="h-8"
              value={family}
              maxLength={64}
              onChange={(event) => setFamily(event.target.value)}
            />
            {headings ? null : (
              <>
                <label htmlFor={`${id}-fallback`} className="text-xs">
                  Fallback
                </label>
                <Select
                  value={fallback}
                  onValueChange={(next) => setFallback(next as BrandingFontId)}
                >
                  <SelectTrigger id={`${id}-fallback`} className="h-8">
                    <SelectValue>{FONT_OPTIONS.find((f) => f.id === fallback)?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-licence`}
              checked={licensed}
              onCheckedChange={(next) => setLicensed(next === true)}
            />
            <label htmlFor={`${id}-licence`} className="text-xs">
              I have a licence to use this font on the web.
            </label>
          </div>

          {shown ? (
            <p role="alert" className="text-xs text-destructive">
              {shown}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void upload()}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
