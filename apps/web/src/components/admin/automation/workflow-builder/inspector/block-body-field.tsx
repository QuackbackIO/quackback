/**
 * The rich-text prompt body every conversational block kind authors (Phase C,
 * slice C-5) — message, reply_buttons, collect_data, collect_reply, and
 * request_csat all embed this the same way, per the brief's "message editor
 * embeds the existing rich-text editor component". Adds one thing beyond a
 * bare RichTextEditor: an insert-variable menu fed by
 * WORKFLOW_VARIABLE_CATALOGUE, so an admin never has to hand-type
 * `{first_name|there}` token syntax. The fallback text after `|` is just
 * ordinary rich text once inserted — no separate widget, the admin edits it
 * in place.
 */
import type { JSONContent } from '@tiptap/react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { WORKFLOW_VARIABLE_CATALOGUE } from '@/lib/shared/workflows/message-variables'
import { insertVariableToken, type BlockBody } from '../../workflow-graph'
import { Field } from './shared'

export function BlockBodyField({
  label = 'Message',
  body,
  onChange,
  placeholder = 'Write the message…',
}: {
  label?: string
  body: BlockBody
  onChange: (body: BlockBody) => void
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        <div className="rounded-md border">
          <RichTextEditor
            value={body as unknown as JSONContent}
            onChange={(json) => onChange(json as unknown as BlockBody)}
            placeholder={placeholder}
            minHeight="72px"
            borderless
            toolbarPosition="bottom"
            features={{ emojiPicker: true, slashMenu: false, bubbleMenu: true }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <PlusIcon className="size-3.5" /> Insert variable
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {WORKFLOW_VARIABLE_CATALOGUE.map((v) => (
                <DropdownMenuItem
                  key={v.key}
                  onSelect={() => onChange(insertVariableToken(body, v.key))}
                >
                  {v.label}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {`{${v.key}}`}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Variables insert as <code className="font-mono">{'{token|fallback}'}</code> — edit the
          fallback text after the “|”. An unresolved token never reaches the customer.
        </p>
      </div>
    </Field>
  )
}
