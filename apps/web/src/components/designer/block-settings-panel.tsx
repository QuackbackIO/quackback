import { useId, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { blockOf, type AnyBlock, type SettingField } from '@/lib/shared/design/blocks'
import { inLanguage } from '@/lib/shared/design/labels'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
  type OverridePlace,
  type PanelAction,
} from './properties/properties-panel'
import { BLOCK_SECTIONS, WORDS } from './properties/words'

type Source = Extract<SettingField, { kind: 'source' }>['source']
/** What the workspace has to pick from, each as its id and name. */
export type BlockSources = Partial<
  Record<Source, ReadonlyArray<readonly [id: string, name: string]>>
>

const NOTHING_YET: Record<Source, string> = {
  roadmaps: 'No public roadmaps yet.',
  categories: 'No topics yet.',
  boards: 'No public boards yet.',
  columns: 'This roadmap has no columns yet.',
}

/** The value that stands for leaving the pick to the portal, in a select that cannot hold null. */
const ANY = 'any'

/**
 * Whether a setting is the block's data, drawn in Content: not its heading
 * nor words edited where they sit, which are its Words.
 */
export const isContent = (field: SettingField) =>
  !field.inPlace && field.key !== 'heading' && field.kind !== 'words'

/**
 * A picked block's panel on the properties frame, drawn from the block
 * registry: its icon and name (its purpose on hover) with its own actions in
 * the ⋯ menu, then its Words, its Content (the registry's settings, each a
 * row with what it leaves out shown muted and a dot and Reset once set), its
 * Layout and its Look, and the places set differently at the foot. Each
 * Content control hands back the setting's key and the value picked, for the
 * builder to check with `applySetting`. A builder can draw a setting itself,
 * return undefined to leave it to the panel, and leave a setting out with `shown`.
 */
export function BlockPanel({
  block,
  locale = 'en',
  onChange,
  sources = {},
  renderField,
  shown,
  crumbs,
  icon,
  actions,
  notes,
  words,
  layout,
  look,
  overrides,
}: {
  block: AnyBlock
  /** The language words are written in. */
  locale?: string
  onChange: (key: string, value: unknown) => void
  sources?: BlockSources
  /**
   * The editor for a setting the builder draws itself, such as a list of
   * links. Undefined leaves it to the panel; null leaves it out.
   */
  renderField?: (field: SettingField) => ReactNode | undefined
  /** Whether a setting shows, as the block is; all of them when absent. */
  shown?: (field: SettingField) => boolean
  /** Where it is, the block last; its name alone when absent. */
  crumbs?: readonly Crumb[]
  icon?: ReactNode
  /** The ⋯ menu: duplicate, move and remove; none for a page's own sections. */
  actions?: readonly PanelAction[]
  /** What needs looking at first, under the name: what the checks found. */
  notes?: ReactNode
  /** Its Words section: the words it draws, edited where they sit. */
  words?: ReactNode
  /** Its Layout section: its place and size on Home's grid. */
  layout?: ReactNode
  /** Its Look section. */
  look?: ReactNode
  /** The places set differently, at the foot. */
  overrides?: readonly OverridePlace[]
}) {
  const def = blockOf(block.type)
  if (!def) return null
  const values = block as Record<string, unknown>
  const content = def.fields.filter(
    (field) => isContent(field) && (shown?.(field) ?? true) && whenMet(field, values)
  )
  return (
    <PropertiesPanel
      data-block-panel={block.type}
      className="pb-24"
      crumbs={crumbs ?? [{ label: def.name }]}
      title={def.name}
      icon={icon}
      about={def.purpose}
      actions={actions}
      overrides={overrides}
      scope={notes ? <div className="space-y-1.5 text-xs">{notes}</div> : undefined}
    >
      {words}
      {content.length > 0 && (
        <PropertySection title={BLOCK_SECTIONS.content}>
          {content.map((field, at) => (
            <Field
              key={field.key}
              field={field}
              value={values[field.key]}
              group={
                field.group && field.group !== content[at - 1]?.group ? field.group : undefined
              }
              locale={locale}
              sources={sources}
              renderField={renderField}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </PropertySection>
      )}
      {layout}
      {look}
    </PropertiesPanel>
  )
}

/** Whether a setting shows while another is set as it is: its `when`, if it has one. */
export function whenMet(field: SettingField, values: Record<string, unknown>): boolean {
  if (!field.when) return true
  const { key, is, otherwise } = field.when
  const now = values[key]
  return (now === undefined ? otherwise : String(now)) === is
}

/** Whether a value is set on the block, rather than left to its usual one. */
const setOn = (value: unknown, usual: unknown) => value !== undefined && value !== usual

function Field({
  field,
  value,
  group,
  locale,
  sources,
  renderField,
  onChange,
}: {
  field: SettingField
  value: unknown
  /** A group's name, over the first of its switches. */
  group?: string
  locale: string
  sources: BlockSources
  renderField?: (field: SettingField) => ReactNode | undefined
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const own = renderField?.(field)
  if (own !== undefined) return own
  switch (field.kind) {
    case 'text': {
      const words = (value as Record<string, string> | undefined) ?? {}
      const label = inLanguage(field.label, locale)
      return (
        <PropertyRow
          label={label}
          htmlFor={id}
          set={!!words[locale]}
          resetLabel={`${WORDS.reset} ${field.label.toLowerCase()}`}
          onReset={() => onChange('')}
        >
          <Input
            id={id}
            value={words[locale] ?? ''}
            maxLength={field.max}
            placeholder={field.placeholder}
            title={Object.entries(words)
              .filter(([other, text]) => other !== locale && text)
              .map(([, text]) => text)
              .join(' · ')}
            onChange={(event) => onChange(event.target.value)}
            className="h-7 rounded-md px-2 text-xs md:text-xs"
          />
        </PropertyRow>
      )
    }
    case 'choice':
      return (
        <PropertyRow
          label={field.label}
          set={setOn(value, field.default)}
          onReset={field.default !== undefined ? () => onChange(field.default) : undefined}
        >
          <PropertyTiles
            id={id}
            label={field.label}
            value={value === undefined ? undefined : String(value)}
            inherited={field.default}
            options={field.options}
            onChange={onChange}
          />
        </PropertyRow>
      )
    case 'count':
      return (
        <PropertyRow
          label={field.label}
          set={setOn(value, field.default)}
          onReset={field.default !== undefined ? () => onChange(field.default) : undefined}
        >
          <PropertyTiles
            id={id}
            label={field.label}
            value={value === undefined ? undefined : String(value)}
            inherited={field.default === undefined ? undefined : String(field.default)}
            options={field.options.map((n) => [String(n), field.names?.[n] ?? String(n)] as const)}
            onChange={(picked) => onChange(Number(picked))}
          />
        </PropertyRow>
      )
    case 'switch': {
      const on = typeof value === 'boolean' ? value : field.default === true
      return (
        <>
          {group && <p className="pt-1 text-xs font-medium text-muted-foreground">{group}</p>}
          <PropertyRow
            label={field.label}
            htmlFor={id}
            set={setOn(value, field.default === true)}
            onReset={() => onChange(field.default === true)}
          >
            <Switch
              id={id}
              checked={on}
              className="ms-auto"
              onCheckedChange={(next) => onChange(next)}
            />
          </PropertyRow>
        </>
      )
    }
    case 'source':
      return field.multiple ? (
        <SourceList field={field} value={value} sources={sources} onChange={onChange} />
      ) : (
        <SourceSelect field={field} value={value} sources={sources} onChange={onChange} />
      )
    case 'words':
    case 'links':
    case 'image':
      return null
  }
}

type SourceField = Extract<SettingField, { kind: 'source' }>

function SourceSelect({
  field,
  value,
  sources,
  onChange,
}: {
  field: SourceField
  value: unknown
  sources: BlockSources
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const items = sources[field.source] ?? []
  return (
    <PropertyRow
      label={field.label}
      htmlFor={id}
      set={typeof value === 'string'}
      onReset={() => onChange(null)}
    >
      <Select
        value={typeof value === 'string' ? value : ANY}
        onValueChange={(picked) => onChange(picked === ANY ? null : picked)}
      >
        <SelectTrigger id={id} size="sm" aria-label={field.label} className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{field.any}</SelectItem>
          {items.map(([itemId, name]) => (
            <SelectItem key={itemId} value={itemId}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropertyRow>
  )
}

function SourceList({
  field,
  value,
  sources,
  onChange,
}: {
  field: SourceField
  value: unknown
  sources: BlockSources
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const items = sources[field.source] ?? []
  const picked = Array.isArray(value) ? (value as string[]) : []
  const max = field.max ?? items.length
  if (items.length === 0)
    return (
      <PropertyRow label={field.label}>
        <span className="text-xs text-muted-foreground">
          {`${NOTHING_YET[field.source]} Shows ${field.any.toLowerCase()}.`}
        </span>
      </PropertyRow>
    )
  const toggle = (itemId: string, on: boolean) => {
    const rest = picked.filter((other) => other !== itemId)
    onChange(on ? [...rest, itemId].slice(0, max) : rest)
  }
  return (
    <fieldset className="space-y-0.5">
      <legend className="sr-only">{field.label}</legend>
      <PropertyRow label={field.label} set={picked.length > 0} onReset={() => onChange([])}>
        <span className="text-xs text-muted-foreground">
          {picked.length ? `${picked.length} of ${max}` : `${field.any}, or pick up to ${max}`}
        </span>
      </PropertyRow>
      <div className="space-y-1 ps-[100px] pb-1">
        {items.map(([itemId, name]) => {
          const on = picked.includes(itemId)
          const boxId = `${id}-${itemId}`
          return (
            <div key={itemId} className="flex items-center gap-2">
              <Checkbox
                id={boxId}
                checked={on}
                disabled={!on && picked.length >= max}
                onCheckedChange={(next) => toggle(itemId, next === true)}
              />
              <label htmlFor={boxId} className="text-xs">
                {name}
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
