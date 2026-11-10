import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const KEYS: Array<[string, string]> = [
  ['Ctrl+Z, Ctrl+Shift+Z', 'Undo and redo'],
  ['Ctrl+K', 'Find a part, page or setting'],
  ['Escape', 'Close a panel, step back from what is picked, or leave Preview'],
  ['F6', 'Move between the top bar, rail, panel, page and settings'],
  ['Arrow keys', 'Move through the rail and through Pages'],
  ['Delete', 'Remove the picked block'],
  ['Ctrl+D', 'Copy the picked block'],
  ['?', 'Show these keys'],
]

/** The designer's keys, listed. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keys</DialogTitle>
          <DialogDescription>On a Mac, Cmd works in place of Ctrl.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {KEYS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs">{keys}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
