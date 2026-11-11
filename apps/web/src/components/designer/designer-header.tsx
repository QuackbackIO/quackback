import { memo, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  EyeIcon,
  PlusIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline'
import { onRadioKeys } from '@/components/admin/settings/appearance/radio-keys'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DEVICE_NAMES,
  DEVICE_WIDTHS,
  redoTip,
  undoTip,
  type Device,
  type Sheet,
} from '@/lib/shared/design/builder-chrome'
import { cn } from '@/lib/shared/utils'
import type { PortalAddress } from '@/lib/shared/design/portal-address'
import { PublishedPopover } from './published-popover'

// The bar's icons, made once: unchanged, React does not draw them again with the bar.
const UNDO_ICON = <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
const REDO_ICON = <ArrowUturnRightIcon className="size-4" aria-hidden="true" />
const ADD_ICON = <PlusIcon className="size-4" aria-hidden="true" />
const THEME_ICON = <SwatchIcon className="size-4" aria-hidden="true" />
const PREVIEW_ICON = <EyeIcon className="size-4" aria-hidden="true" />

const DEVICE_ICONS: Record<Device, typeof ComputerDesktopIcon> = {
  desktop: ComputerDesktopIcon,
  tablet: DeviceTabletIcon,
  phone: DevicePhoneMobileIcon,
}

/** An icon button with a real tooltip naming what it does; disabled, it still says why. */
function IconButton({
  tip,
  label = tip,
  disabled = false,
  onClick,
  children,
}: {
  tip: string
  label?: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-disabled={disabled || undefined}
          className="aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          onClick={() => {
            if (!disabled) onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Desktop, tablet and phone: one radio group, one Tab stop, the arrows pick. */
export const DeviceToggle = memo(function DeviceToggle({
  size,
  onSize,
  labelled = false,
}: {
  size: Device
  onSize: (size: Device) => void
  /** Shows each device's name beside its icon. */
  labelled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Device"
      onKeyDown={onRadioKeys}
      className="flex rounded-lg bg-muted p-0.5"
    >
      {(Object.keys(DEVICE_WIDTHS) as Device[]).map((key) => {
        const Icon = DEVICE_ICONS[key]
        const name = DEVICE_NAMES[key]
        const radio = (
          <button
            type="button"
            role="radio"
            aria-checked={size === key}
            aria-label={labelled ? undefined : name}
            tabIndex={size === key ? 0 : -1}
            onClick={() => onSize(key)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-ring',
              size === key &&
                'bg-background text-foreground shadow-sm forced-colors:outline forced-colors:outline-1'
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {labelled && name}
          </button>
        )
        if (labelled) return <span key={key}>{radio}</span>
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>{radio}</TooltipTrigger>
            <TooltipContent>{`${name}, ${DEVICE_WIDTHS[key]} px`}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})

/** The way back to settings, drawn again only if where it goes changes. */
const BackLink = memo(function BackLink({
  returnPath,
  onExit,
}: {
  returnPath: string
  onExit: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={returnPath}
          aria-label="Back to Customer portal settings"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          onClick={(event) => {
            event.preventDefault()
            onExit()
          }}
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Back to settings. Your draft is kept.</TooltipContent>
    </Tooltip>
  )
})

/** Add or Theme: filled while its sheet is open. */
function SheetButton({
  sheet,
  open,
  onClick,
  children,
}: {
  sheet: Sheet
  open: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={open}
      data-sheet-button={sheet}
      onClick={onClick}
      className={cn(
        'shrink-0 border-border',
        open && 'border-foreground bg-foreground text-background hover:bg-foreground/90'
      )}
    >
      {children}
    </Button>
  )
}

/** The draft state's fixed slot, wide enough for its longest words. */
export const STATUS_SLOT_WIDTH = 184

/** A button's words, which give way to its icon in a narrower window; the name stays for screen readers. */
function Label({ children }: { children: string }) {
  return <span className="max-[1279px]:sr-only">{children}</span>
}

/**
 * The builder's top bar: the way back, where you are, the page shown and the
 * device it is shown on, undo and redo, the draft's state, Add, Theme,
 * Preview and Publish. It never wraps: as the window narrows, the
 * breadcrumb goes and the buttons keep only their icons.
 */
export function DesignerHeader({
  returnPath,
  onExit,
  workspaceName,
  pagePicker,
  view,
  size,
  onSize,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  draftStatus,
  sheet,
  onSheet,
  onPreview,
  onPublish,
  canPublish,
  changes,
  published = null,
  onPublishedClose = () => {},
}: {
  returnPath: string
  onExit: () => void
  workspaceName: string
  /** The page shown, and the way to every other page. */
  pagePicker: ReactNode
  /** How the page is shown while editing, beside the device switch. */
  view?: ReactNode
  size: Device
  onSize: (size: Device) => void
  undoLabel: string | null
  redoLabel: string | null
  onUndo: () => void
  onRedo: () => void
  /** The draft's state and its menu. */
  draftStatus: ReactNode
  /** The sheet open over the right panel. */
  sheet: Sheet | null
  onSheet: (sheet: Sheet) => void
  onPreview: () => void
  onPublish: () => void
  /** Whether this person may publish; without it, Publish only reviews. */
  canPublish: boolean
  changes: number
  /** Where the portal just went live, shown on Publish until closed. */
  published?: PortalAddress | null
  onPublishedClose?: () => void
}) {
  return (
    <header
      data-designer-region=""
      tabIndex={-1}
      aria-label="Top bar"
      className="grid min-h-15 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border bg-background px-3 py-2 outline-none"
    >
      <h1 className="sr-only">Customer portal design for {workspaceName}</h1>
      <div className="flex min-w-0 items-center gap-2">
        <BackLink returnPath={returnPath} onExit={onExit} />
        {/* Where you are gives way first as the window narrows. */}
        <nav
          aria-label="Breadcrumb"
          className="me-2 hidden min-w-0 items-center gap-1.5 text-sm min-[1400px]:flex"
        >
          <span className="truncate text-muted-foreground">{workspaceName}</span>
          <span aria-hidden="true" className="text-muted-foreground/60">
            /
          </span>
          <span aria-current="page" className="truncate font-semibold">
            Customer portal
          </span>
        </nav>
        <div className="min-w-0">{pagePicker}</div>
      </div>
      <div className="mx-2 flex items-center gap-1">
        <DeviceToggle size={size} onSize={onSize} />
        {view}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <IconButton tip={undoTip(undoLabel)} label="Undo" disabled={!undoLabel} onClick={onUndo}>
          {UNDO_ICON}
        </IconButton>
        <IconButton tip={redoTip(redoLabel)} label="Redo" disabled={!redoLabel} onClick={onRedo}>
          {REDO_ICON}
        </IconButton>
        {/* One width whatever it says, so nothing beside it moves as the draft's state changes. */}
        <div
          data-status-slot=""
          style={{ width: STATUS_SLOT_WIDTH }}
          className="flex min-w-0 shrink-0 justify-end"
        >
          {draftStatus}
        </div>
        <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
        <SheetButton sheet="add" open={sheet === 'add'} onClick={() => onSheet('add')}>
          {ADD_ICON}
          <Label>Add</Label>
        </SheetButton>
        <SheetButton sheet="theme" open={sheet === 'theme'} onClick={() => onSheet('theme')}>
          {THEME_ICON}
          <Label>Theme</Label>
        </SheetButton>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-border"
          data-preview=""
          onClick={onPreview}
        >
          {PREVIEW_ICON}
          <Label>Preview</Label>
        </Button>
        <PublishedPopover address={published} onClose={onPublishedClose}>
          <Button
            size="sm"
            className="shrink-0 px-4 font-semibold"
            disabled={!changes}
            onClick={onPublish}
          >
            {canPublish ? 'Publish' : 'Review'}
          </Button>
        </PublishedPopover>
      </div>
    </header>
  )
}
