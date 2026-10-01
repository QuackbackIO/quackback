/**
 * Images, video and audio. Media loads straight from the stored URL (the
 * storage route redirects, and media elements need no CORS), never from the
 * proxy. Images zoom from 25% to 500% of their fitted size, pan by dragging
 * once zoomed, toggle 200% on double-click and zoom with Ctrl and the wheel.
 * TIFF and HEIC show the copy the preview job derives, since most browsers
 * cannot draw them. SVG is only ever an <img>, where its scripts cannot run.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type SyntheticEvent,
} from 'react'
import { fileExtension } from '@/lib/shared/files/file-types'
import { cn } from '@/lib/shared/utils'
import { FileBadge } from '../file-badge'
import {
  VIEWER_ARROWS_ATTR,
  type EngineFailure,
  type ViewerEngineProps,
  type ViewerFile,
} from '../types'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 5

/** Players seek with Left/Right, so the gallery leaves those keys to them. */
const PLAYER_ARROWS = { [VIEWER_ARROWS_ATTR]: '' }

const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(4))))

/** Why a media element gave up, from its MediaError code. */
function mediaFailure(event: SyntheticEvent<HTMLMediaElement>): EngineFailure | null {
  const code = event.currentTarget.error?.code
  if (code === 1) return null // the load was aborted, not failed
  if (code === 4) return 'unsupported'
  return 'corrupt'
}

/** Image formats most browsers cannot draw; the server derives a copy that they can. */
const UNDRAWABLE_TYPES = new Set(['image/tiff', 'image/heic', 'image/heif'])
const UNDRAWABLE_EXTENSIONS = new Set(['tif', 'tiff', 'heic', 'heif'])

/**
 * The URL to draw an image from: the stored file, or for a format browsers
 * cannot draw, the server's converted copy (HEIC) or rendered thumbnail
 * (TIFF). Null when there is nothing a browser can draw.
 */
export function drawableImageUrl(file: ViewerFile): string | null {
  const undrawable =
    UNDRAWABLE_TYPES.has(file.contentType.toLowerCase()) ||
    UNDRAWABLE_EXTENSIONS.has(fileExtension(file.name))
  if (!undrawable) return file.url
  return file.preview?.renditionUrl ?? file.preview?.thumbUrl ?? null
}

export default function MediaEngine(props: ViewerEngineProps) {
  if (props.file.family === 'video') return <VideoView {...props} />
  if (props.file.family === 'audio') return <AudioView {...props} />
  const src = drawableImageUrl(props.file)
  if (!src) return <Undrawable onError={props.onError} />
  return <ImageView {...props} imageSrc={src} />
}

/** Reports the shell's unsupported fallback instead of drawing a broken image. */
function Undrawable({ onError }: Pick<ViewerEngineProps, 'onError'>) {
  useEffect(() => onError('unsupported'), [onError])
  return null
}

function ImageView({
  file,
  imageSrc,
  onToolbar,
  onError,
}: ViewerEngineProps & { imageSrc: string }) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [pixels, setPixels] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  const stageRef = useRef<HTMLDivElement>(null)

  // A rendered thumbnail is smaller than the original: name the original's size.
  const thumbnail = imageSrc !== file.url && imageSrc === file.preview?.thumbUrl
  const knownSize =
    file.preview?.width && file.preview.height
      ? `${file.preview.width} × ${file.preview.height}`
      : null

  const applyZoom = useCallback((next: number) => {
    const value = clampZoom(next)
    setZoom(value)
    if (value <= 1) setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    onToolbar({
      zoom: { value: zoom, min: MIN_ZOOM, max: MAX_ZOOM, set: applyZoom },
      ...(pixels ? { note: pixels } : {}),
    })
  }, [onToolbar, zoom, applyZoom, pixels])

  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as Ctrl + wheel) zooms.
  // A native listener, because React's wheel listener is passive.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => {
        const value = clampZoom(z * Math.exp(-e.deltaY * 0.002))
        if (value <= 1) setOffset({ x: 0, y: 0 })
        return value
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety; dragging still works inside the stage.
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const start = dragStart.current
    setOffset({ x: start.ox + (e.clientX - start.x), y: start.oy + (e.clientY - start.y) })
  }
  const endDrag = () => setDragging(false)

  return (
    <div
      ref={stageRef}
      className="relative min-w-0 flex-1 overflow-hidden select-none"
      style={{
        cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
        touchAction: zoom > 1 ? 'none' : 'auto',
      }}
      onDoubleClick={() => applyZoom(zoom > 1 ? 1 : 2)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img
        src={imageSrc}
        alt={file.name}
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget
          if (thumbnail) setPixels(knownSize)
          else if (naturalWidth && naturalHeight) setPixels(`${naturalWidth} × ${naturalHeight}`)
        }}
        onError={() => onError('corrupt')}
        className={cn(
          'absolute inset-0 m-auto max-h-[calc(100%-3rem)] max-w-[calc(100%-2rem)] rounded-[3px] object-contain shadow-[0_2px_14px_rgb(0_0_0/0.2)] sm:max-w-[calc(100%-8rem)]',
          !dragging && 'transition-transform duration-150 motion-reduce:transition-none'
        )}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  )
}

function VideoView({ file, onToolbar, onError }: ViewerEngineProps) {
  useEffect(() => onToolbar({}), [onToolbar])
  return (
    <div className="relative min-w-0 flex-1 bg-[#0b0b0d]">
      <video
        {...PLAYER_ARROWS}
        src={file.url}
        controls
        preload="metadata"
        playsInline
        aria-label={file.name}
        onError={(e) => {
          const failure = mediaFailure(e)
          if (failure) onError(failure)
        }}
        className="absolute inset-0 m-auto max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] rounded-md bg-black sm:max-h-[calc(100%-3rem)] sm:max-w-[calc(100%-8rem)]"
      />
    </div>
  )
}

function AudioView({ file, onToolbar, onError }: ViewerEngineProps) {
  useEffect(() => onToolbar({}), [onToolbar])
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <FileBadge
          name={file.name}
          family={file.family}
          size="lg"
          className="size-14 rounded-xl text-[13px]"
        />
        <p className="max-w-full truncate text-sm font-medium text-foreground">{file.name}</p>
        <audio
          {...PLAYER_ARROWS}
          src={file.url}
          controls
          preload="metadata"
          aria-label={file.name}
          onError={(e) => {
            const failure = mediaFailure(e)
            if (failure) onError(failure)
          }}
          className="w-full"
        />
      </div>
    </div>
  )
}
