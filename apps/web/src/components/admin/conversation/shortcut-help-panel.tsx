/**
 * The inbox shortcut help panel (support platform §4.6): the `?` cheatsheet. It
 * derives every row from INBOX_ACTIONS (the action keys) plus the hook's
 * INBOX_GLOBAL_SHORTCUTS (Cmd-K / ?) plus the Copilot panel's own
 * COPILOT_PANEL_SHORTCUTS (bound by the panel, not the hook), so it can never
 * list a key nothing binds.
 */
import { INBOX_ACTIONS, INBOX_ACTION_GROUP_ORDER } from '@/lib/shared/conversation/inbox-actions'
import { INBOX_GLOBAL_SHORTCUTS } from './use-inbox-keyboard'
import { COPILOT_PANEL_SHORTCUTS } from './copilot-panel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-foreground">{label}</span>
      <kbd className="bg-muted text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
        {keys}
      </kbd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      <div className="divide-border divide-y">{children}</div>
    </section>
  )
}

export function ShortcutHelpPanel({
  open,
  onOpenChange,
  copilotAvailable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether the Copilot tab exists for this viewer/viewport right now (the
   *  route's flag + copilot.use + ≥xl gate) — when false, neither the Copilot
   *  section nor the `q` action row is listed, so the cheatsheet never
   *  advertises a key that does nothing. */
  copilotAvailable: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work the inbox without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="General">
            {INBOX_GLOBAL_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.keys} keys={s.keys} label={s.label} />
            ))}
          </Section>
          {INBOX_ACTION_GROUP_ORDER.map((group) => {
            const rows = INBOX_ACTIONS.filter(
              (a) => a.group === group && a.shortcut && (copilotAvailable || a.id !== 'copilot')
            )
            if (rows.length === 0) return null
            return (
              <Section key={group} title={group}>
                {rows.map((a) => (
                  <ShortcutRow key={a.id} keys={a.shortcut!} label={a.label} />
                ))}
              </Section>
            )
          })}
          {/* Panel-scoped: only fires while focus is inside the Copilot panel. */}
          {copilotAvailable && (
            <Section title="Copilot">
              {COPILOT_PANEL_SHORTCUTS.map((s) => (
                <ShortcutRow key={s.keys} keys={s.keys} label={s.label} />
              ))}
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
