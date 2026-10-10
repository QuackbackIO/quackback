// @vitest-environment happy-dom
/**
 * A page holds many closed menus, dialogs, popovers and tooltips, and renders
 * each of them whenever it renders. Until an overlay first opens, its content
 * part renders no portal; opening, closing and reopening work as before,
 * whether the overlay is uncontrolled, controlled from a parent, or its
 * content sits below a memoized component.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { memo, useState, type ComponentType, type ReactNode } from 'react'

// Each Base UI portal, wrapped to count its renders.
const portalRenders: Record<string, number> = {}
function countingPortal<P extends object>(name: string, Portal: ComponentType<P>) {
  return function CountingPortal(props: P) {
    portalRenders[name] = (portalRenders[name] ?? 0) + 1
    return <Portal {...props} />
  }
}
vi.mock('@base-ui/react/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/menu')>()
  return { Menu: { ...actual.Menu, Portal: countingPortal('menu', actual.Menu.Portal) } }
})
vi.mock('@base-ui/react/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/dialog')>()
  return { Dialog: { ...actual.Dialog, Portal: countingPortal('dialog', actual.Dialog.Portal) } }
})
vi.mock('@base-ui/react/alert-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/alert-dialog')>()
  return {
    AlertDialog: {
      ...actual.AlertDialog,
      Portal: countingPortal('alert-dialog', actual.AlertDialog.Portal),
    },
  }
})
vi.mock('@base-ui/react/popover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/popover')>()
  return {
    Popover: { ...actual.Popover, Portal: countingPortal('popover', actual.Popover.Portal) },
  }
})
vi.mock('@base-ui/react/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/tooltip')>()
  return {
    Tooltip: { ...actual.Tooltip, Portal: countingPortal('tooltip', actual.Tooltip.Portal) },
  }
})

const { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } =
  await import('@/components/ui/dropdown-menu')
const { Dialog, DialogContent, DialogTitle, DialogTrigger } = await import('@/components/ui/dialog')
const { AlertDialog, AlertDialogContent, AlertDialogTitle } =
  await import('@/components/ui/alert-dialog')
const { Popover, PopoverContent, PopoverTrigger } = await import('@/components/ui/popover')
const { Tooltip, TooltipContent, TooltipTrigger } = await import('@/components/ui/tooltip')
const { Sheet, SheetContent, SheetTitle, SheetTrigger } = await import('@/components/ui/sheet')

afterEach(() => {
  cleanup()
  for (const key of Object.keys(portalRenders)) delete portalRenders[key]
})

let rerenderPage: () => void = () => {}

/** Renders its overlays again each time it renders, as a page does. */
function Page({ children }: { children: () => ReactNode }) {
  const [, setVersion] = useState(0)
  rerenderPage = () => setVersion((v) => v + 1)
  return <>{children()}</>
}

function renderPageTimes(times: number) {
  for (let i = 0; i < times; i++) act(() => rerenderPage())
}

describe('closed overlays', () => {
  it('render no portal until they first open', () => {
    render(
      <Page>
        {() => (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Item</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog>
              <DialogTrigger>Dialog</DialogTrigger>
              <DialogContent>
                <DialogTitle>Dialog title</DialogTitle>
              </DialogContent>
            </Dialog>
            <AlertDialog open={false}>
              <AlertDialogContent>
                <AlertDialogTitle>Alert title</AlertDialogTitle>
              </AlertDialogContent>
            </AlertDialog>
            <Popover>
              <PopoverTrigger>Popover</PopoverTrigger>
              <PopoverContent>Popover body</PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger>Tip</TooltipTrigger>
              <TooltipContent>Tip body</TooltipContent>
            </Tooltip>
            <Sheet>
              <SheetTrigger>Sheet</SheetTrigger>
              <SheetContent>
                <SheetTitle>Sheet title</SheetTitle>
              </SheetContent>
            </Sheet>
          </>
        )}
      </Page>
    )
    renderPageTimes(3)

    expect(portalRenders).toEqual({})
  })
})

describe('an uncontrolled menu', () => {
  it('opens, closes and reopens while its page renders around it', async () => {
    render(
      <Page>
        {() => (
          <DropdownMenu>
            <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Page>
    )
    renderPageTimes(2)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    })
    expect(await screen.findByRole('menuitem', { name: 'Item' })).toBeInTheDocument()
    renderPageTimes(1)
    expect(screen.getByRole('menuitem', { name: 'Item' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    })
    expect(screen.queryByRole('menuitem', { name: 'Item' })).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    })
    expect(await screen.findByRole('menuitem', { name: 'Item' })).toBeInTheDocument()
  })

  it('stays closed, with no portal, when its open-change handler cancels the open', async () => {
    render(
      <DropdownMenu onOpenChange={(_open, details) => details.cancel()}>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    })

    expect(screen.queryByRole('menuitem', { name: 'Item' })).not.toBeInTheDocument()
    expect(portalRenders.menu).toBeUndefined()
  })
})

describe('an uncontrolled popover and sheet', () => {
  it('open from their triggers', async () => {
    render(
      <>
        <Popover>
          <PopoverTrigger>Popover</PopoverTrigger>
          <PopoverContent>Popover body</PopoverContent>
        </Popover>
        <Sheet>
          <SheetTrigger>Sheet</SheetTrigger>
          <SheetContent>
            <SheetTitle>Sheet title</SheetTitle>
          </SheetContent>
        </Sheet>
      </>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Popover' }))
    })
    expect(await screen.findByText('Popover body')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sheet' }))
    })
    expect(await screen.findByRole('dialog', { name: 'Sheet title' })).toBeInTheDocument()
  })
})

// Content below a memoized component: nothing re-renders it but the overlay.
const MemoDialogBody = memo(function MemoDialogBody() {
  return (
    <DialogContent>
      <DialogTitle>Controlled title</DialogTitle>
    </DialogContent>
  )
})

const MemoTooltipBody = memo(function MemoTooltipBody() {
  return <TooltipContent>Controlled tip</TooltipContent>
})

describe('a controlled overlay', () => {
  it('opens from its parent state, closes and reopens', async () => {
    let setOpen: (open: boolean) => void = () => {}
    function Parent() {
      const [open, setOpenState] = useState(false)
      setOpen = setOpenState
      return (
        <Dialog open={open} onOpenChange={setOpenState}>
          <MemoDialogBody />
        </Dialog>
      )
    }
    render(<Parent />)
    expect(screen.queryByText('Controlled title')).not.toBeInTheDocument()

    await act(async () => setOpen(true))
    expect(await screen.findByRole('dialog', { name: 'Controlled title' })).toBeInTheDocument()

    await act(async () => setOpen(false))
    expect(screen.queryByText('Controlled title')).not.toBeInTheDocument()

    await act(async () => setOpen(true))
    expect(await screen.findByRole('dialog', { name: 'Controlled title' })).toBeInTheDocument()
  })

  it('shows a tooltip its parent opens', async () => {
    let setOpen: (open: boolean) => void = () => {}
    function Parent() {
      const [open, setOpenState] = useState(false)
      setOpen = setOpenState
      return (
        <Tooltip open={open} onOpenChange={setOpenState}>
          <TooltipTrigger>Tip</TooltipTrigger>
          <MemoTooltipBody />
        </Tooltip>
      )
    }
    render(<Parent />)
    expect(portalRenders.tooltip).toBeUndefined()

    await act(async () => setOpen(true))
    expect(await screen.findByText('Controlled tip')).toBeInTheDocument()
  })

  it('renders an overlay that starts open', async () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Open from the start</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    )
    expect(await screen.findByText('Open from the start')).toBeInTheDocument()
  })
})
