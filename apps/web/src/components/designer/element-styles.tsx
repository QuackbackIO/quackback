/**
 * An element style editor: a state switch, fields written from the
 * registry, and a live preview of the element drawn with the design's own
 * CSS, at rest and in the state picked (hover it to see hover too). Its
 * fields are the element panel's too, where a value has no row of its own
 * (a gradient).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, XMarkIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColourField, toHex } from '@/components/admin/settings/appearance/colour-field'
import { layoutAttributes } from '@/lib/shared/design/components'
import { renderDesignCss, resolveDesignCached } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  COLOUR_ROLES,
  COLOUR_ROLE_INFO,
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  styleAllows,
  type StyleColour,
  type StyleElement,
  type StyleElementInfo,
  type StylePaint,
  type StyleProp,
  type StylePropInfo,
  type StyleProps,
  type StyleSheet,
  type StyleState,
} from '@/lib/shared/design/style-tokens'
import { Segmented } from './segmented'

/** Where a sheet lives: the site's, or a Home block's own. */
export interface StyleScope {
  /** The elements it may set. */
  elements: readonly StyleElement[]
  read: (design: PortalDesign) => StyleSheet | undefined
  /** Writes into the draft's sheet, made where missing. */
  write: (draft: PortalDesign) => StyleSheet
  /** A Home block's id, so its preview sits inside it. */
  blockId?: string
  /** Writes one value in the draft, where the sheet is not simply `write`'s, such as an override. */
  edit?: (
    draft: PortalDesign,
    element: StyleElement,
    state: StyleState,
    prop: StyleProp,
    value: unknown
  ) => void
}

export const SITE_STYLE: StyleScope = {
  elements: Object.keys(STYLE_ELEMENTS) as StyleElement[],
  read: (design) => design.style,
  write: (draft) => (draft.style ??= {}),
}

/** One element's look in each of its states. */
export function ElementStyleEditor({
  element,
  design,
  update,
  scope,
  onBack,
  titled = true,
  state: shownState,
  onState,
  showStates = true,
  only,
  source,
  preview = true,
  changeName,
}: {
  element: StyleElement
  design: PortalDesign
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  scope: StyleScope
  onBack?: () => void
  /** Its name and what it is above it; left off where the panel already names it. */
  titled?: boolean
  /** The state shown, where the caller holds it (the canvas draws the element in it). */
  state?: StyleState
  onState?: (state: StyleState) => void
  /** Whether the state switch shows; without it, the state shown is kept. */
  showStates?: boolean
  /** The properties shown, in order; absent shows all the element has. */
  only?: readonly StyleProp[]
  /** Where a value left unset here comes from, under its field; null when it is set here or nowhere. */
  source?: (prop: StyleProp, state: StyleState) => ReactNode
  /** Whether the element is drawn above the fields; off where the canvas shows it. */
  preview?: boolean
  /** What a change is called, for undo. */
  changeName?: (prop: StyleProp) => string
}) {
  const el: StyleElementInfo = STYLE_ELEMENTS[element]
  const [ownState, setOwnState] = useState<StyleState>('base')
  const state = shownState ?? ownState
  const setState = onState ?? setOwnState
  const props = (scope.read(design)?.[element]?.[state] ?? {}) as StyleProps
  const set = (prop: StyleProp, value: unknown) =>
    update((draft) => {
      const clear = value === undefined || value === ''
      if (scope.edit) return scope.edit(draft, element, state, prop, clear ? undefined : value)
      const sheet = scope.write(draft) as Record<string, Record<string, Record<string, unknown>>>
      const own = (sheet[element] ??= {})
      const at = (own[state] ??= {})
      if (clear) delete at[prop]
      else at[prop] = value
      if (!Object.keys(at).length) delete own[state]
      if (!Object.keys(own).length) delete sheet[element]
    }, changeName?.(prop))
  const fields = (only ?? el.props).filter(
    (prop) => (el.props as readonly StyleProp[]).includes(prop) && styleAllows(element, state, prop)
  )
  return (
    <div className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
          Element styles
        </button>
      )}
      {titled && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{el.label}</h3>
          <p className="text-xs text-muted-foreground">{el.about}</p>
        </div>
      )}
      {showStates && el.states.length > 1 && (
        <Segmented
          label="State"
          value={state}
          options={el.states.map((s) => [s, STATE_INFO[s].label] as const)}
          onChange={setState}
          rows={el.states.length > 4}
        />
      )}
      {preview && (
        <StylePreview design={design} element={element} state={state} blockId={scope.blockId} />
      )}
      <div className="space-y-3">
        {fields.map((prop) => (
          <div key={`${state}-${prop}`} className="space-y-1">
            <StyleField
              id={`style-${element}-${state}-${prop}`}
              prop={prop}
              value={props[prop]}
              onChange={(value) => set(prop, value)}
            />
            {source?.(prop, state)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A row with its label and a way to clear it. */
function Row({
  id,
  label,
  set,
  onClear,
  children,
}: {
  id: string
  label: string
  set: boolean
  onClear: () => void
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-[13px]">
          {label}
        </label>
        {set && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ms-auto size-5"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={onClear}
          >
            <XMarkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {children}
    </div>
  )
}

const AS_THEME = '__theme'
const EXACT = '__exact'

/** A colour by role, or an exact one. */
function ColourInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: StyleColour | undefined
  onChange: (value: StyleColour | undefined) => void
}) {
  const exact = !!value && value.startsWith('#')
  const [picking, setPicking] = useState(exact)
  const choice = value === undefined ? (picking ? EXACT : AS_THEME) : exact ? EXACT : value
  return (
    <div className="space-y-2">
      <Select
        value={choice}
        onValueChange={(next) => {
          if (next === AS_THEME) {
            setPicking(false)
            onChange(undefined)
          } else if (next === EXACT) setPicking(true)
          else {
            setPicking(false)
            onChange(next as StyleColour)
          }
        }}
      >
        <SelectTrigger id={id} aria-label={label} className="h-8 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AS_THEME}>As the theme</SelectItem>
          {COLOUR_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {COLOUR_ROLE_INFO[role][0]!.toUpperCase() + COLOUR_ROLE_INFO[role].slice(1)}
            </SelectItem>
          ))}
          <SelectItem value={EXACT}>An exact colour</SelectItem>
        </SelectContent>
      </Select>
      {choice === EXACT && (
        <ColourField
          id={`${id}-exact`}
          label={`${label}, exact`}
          value={exact ? value : undefined}
          onChange={(next) => onChange(next ? (toHex(next) as StyleColour) : undefined)}
        />
      )}
    </div>
  )
}

/** One property's field, as the registry describes it. */
export function StyleField({
  id,
  prop,
  value,
  onChange,
}: {
  id: string
  prop: StyleProp
  value: unknown
  onChange: (value: unknown) => void
}) {
  const info: StylePropInfo = STYLE_PROPS[prop]
  const clear = () => onChange(undefined)
  const set = value !== undefined
  switch (info.kind) {
    case 'colour':
      return (
        <Row id={id} label={info.label} set={set} onClear={clear}>
          <ColourInput
            id={id}
            label={info.label}
            value={value as StyleColour | undefined}
            onChange={onChange}
          />
        </Row>
      )
    case 'paint': {
      const paint = value as StylePaint | undefined
      const gradient = typeof paint === 'object'
      return (
        <Row id={id} label={info.label} set={set} onClear={clear}>
          <Segmented
            label="Fill"
            value={gradient ? 'gradient' : 'colour'}
            options={[
              ['colour', 'Colour'],
              ['gradient', 'Gradient'],
            ]}
            onChange={(kind) =>
              onChange(
                kind === 'gradient'
                  ? {
                      from: typeof paint === 'string' ? paint : 'accent',
                      to: 'support',
                      angle: 135,
                    }
                  : typeof paint === 'object'
                    ? paint.from
                    : paint
              )
            }
          />
          {gradient ? (
            <div className="space-y-2">
              <ColourInput
                id={`${id}-from`}
                label="From"
                value={paint.from}
                onChange={(from) => from && onChange({ ...paint, from })}
              />
              <ColourInput
                id={`${id}-to`}
                label="To"
                value={paint.to}
                onChange={(to) => to && onChange({ ...paint, to })}
              />
              <Input
                aria-label="Angle, degrees"
                type="number"
                min={0}
                max={360}
                value={paint.angle ?? 180}
                onChange={(e) => onChange({ ...paint, angle: Number(e.target.value) })}
                className="h-8 text-[13px]"
              />
            </div>
          ) : (
            <ColourInput
              id={id}
              label={info.label}
              value={paint as StyleColour | undefined}
              onChange={onChange}
            />
          )}
        </Row>
      )
    }
    case 'number':
      return (
        <Row
          id={id}
          label={`${info.label}${info.unit ? ` (${info.unit})` : ''}`}
          set={set}
          onClear={clear}
        >
          <NumberInput
            id={id}
            min={info.min}
            max={info.max}
            step={info.step}
            placeholder="As the theme"
            value={typeof value === 'number' ? value : undefined}
            onChange={onChange}
            className="h-8 text-[13px]"
          />
        </Row>
      )
    case 'choice':
      return (
        <Row id={id} label={info.label} set={set} onClear={clear}>
          <Select
            value={(value as string | undefined) ?? AS_THEME}
            onValueChange={(next) => onChange(next === AS_THEME ? undefined : next)}
          >
            <SelectTrigger id={id} aria-label={info.label} className="h-8 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AS_THEME}>As the theme</SelectItem>
              {Object.entries(info.looks).map(([option, looks]) => (
                <SelectItem key={option} value={option}>
                  {looks[0]!.toUpperCase() + looks.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )
  }
}

const IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='%23cbd5e1'/%3E%3Ccircle cx='30' cy='22' r='9' fill='%2394a3b8'/%3E%3Cpath d='M0 60 45 28 75 48 95 36 120 60Z' fill='%2364748b'/%3E%3C/svg%3E"

/** An element as the portal draws it, in a state forced on for the preview. */
function Sample({ element, force }: { element: StyleElement; force?: StyleState }) {
  const f = force && force !== 'base' ? { 'data-qb-force': force } : {}
  switch (element) {
    case 'button':
      return <Button {...f}>Submit</Button>
    case 'secondary':
      return (
        <Button variant="outline" {...f}>
          Log in
        </Button>
      )
    case 'ghost':
      return (
        <Button variant="ghost" {...f}>
          Cancel
        </Button>
      )
    case 'link':
      return (
        <a
          href="#preview"
          data-qb-link=""
          onClick={(e) => e.preventDefault()}
          className="text-sm font-medium text-[var(--qb-accent-text,var(--primary))]"
          {...f}
        >
          See all posts
        </a>
      )
    case 'navItem':
      return (
        <span
          data-qb-part="nav-item"
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${force === 'current' ? 'portal-nav__item--active bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]' : 'text-[var(--nav-inactive-color)]'}`}
          {...f}
        >
          Roadmap
        </span>
      )
    case 'tab':
      return (
        <button
          type="button"
          data-qb-part="tab"
          aria-pressed={force === 'current'}
          className="rounded-item px-3 py-1.5 text-sm text-muted-foreground"
          {...f}
        >
          Trending
        </button>
      )
    case 'postCard':
      return (
        <div
          data-qb-surface="card"
          data-qb-post=""
          className="w-40 rounded-lg border border-border/50 bg-card p-3 text-sm"
          {...f}
        >
          A post card
        </div>
      )
    case 'panel':
      return (
        <div
          data-qb-surface="card"
          className="w-40 rounded-lg border border-border/50 bg-card p-3 text-sm"
        >
          Filters
        </div>
      )
    case 'block':
      return (
        <section
          data-qb-part="home-block"
          data-qb-surface="card"
          className="w-40 rounded-lg border border-border/40 bg-card p-3"
          {...f}
        >
          <h2 data-qb-part="section-heading" className="text-sm font-semibold">
            Top posts
          </h2>
        </section>
      )
    case 'input':
      return <Input data-slot="input" placeholder="Search" className="w-40" {...f} />
    case 'badge':
      return (
        <span
          data-qb-part="status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ ['--qb-status' as string]: '#16a34a' }}
        >
          <span data-qb-status-dot="" className="size-1.5 rounded-full bg-[var(--qb-status)]" />
          Shipped
        </span>
      )
    case 'chip':
      return (
        <span
          data-qb-part="tag"
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
          {...f}
        >
          Mobile
        </span>
      )
    case 'vote':
      return (
        <button
          type="button"
          data-qb-part="vote-button"
          data-state={force === 'current' ? 'voted' : undefined}
          className="flex flex-col items-center rounded-md border px-2 py-1 text-xs font-semibold"
          {...f}
        >
          ▲<span>12</span>
        </button>
      )
    case 'headline':
      return (
        <h1 data-qb-part="headline" className="text-2xl">
          Share a post
        </h1>
      )
    case 'subtitle':
      return (
        <p data-qb-part="subtitle" className="text-sm text-muted-foreground">
          Tell us what to build next
        </p>
      )
    case 'heading':
      return (
        <h2 data-qb-part="section-heading" className="text-lg font-semibold">
          Recent updates
        </h2>
      )
    case 'body':
      return (
        <div className="prose prose-sm max-w-56">
          <p>
            Body text reads like this, with a <a href="#preview">link</a> in it.
          </p>
        </div>
      )
    case 'hero':
      return (
        <div
          data-qb-part="band"
          className="w-56 rounded-md bg-[var(--qb-band-bg)] p-4 text-[var(--qb-band-ink)]"
        >
          <span className="text-base font-semibold">Share a post</span>
        </div>
      )
    case 'header':
      return (
        <div className="portal-header flex w-56 items-center gap-3 border-b bg-[var(--header-background)] px-3 py-2 text-sm text-[var(--header-foreground)]">
          <span className="font-semibold">Acme</span>
          <span className="text-[var(--nav-inactive-color)]">Feedback</span>
        </div>
      )
    case 'footer':
      return (
        <div
          data-qb-section="footer"
          className="w-56 bg-background px-3 py-2 text-center text-xs text-muted-foreground"
        >
          Powered by Quackback
        </div>
      )
    case 'divider':
      return <hr className="w-40 border-border" />
    case 'image':
      return (
        <div className="prose">
          <img src={IMAGE} alt="" className="m-0 w-32" />
        </div>
      )
  }
}

/** The element drawn with the design's own CSS: at rest, and in the state picked. */
export function StylePreview({
  design,
  element,
  state,
  blockId,
}: {
  design: PortalDesign
  element: StyleElement
  state: StyleState
  blockId?: string
}) {
  const css = useMemo(() => {
    try {
      return renderDesignCss(resolveDesignCached(design))
    } catch {
      return ''
    }
  }, [design])
  const inBlock = (node: ReactNode) =>
    blockId ? (
      element === 'block' ? (
        node
      ) : (
        <div data-qb-section={`block-${blockId}`}>{node}</div>
      )
    ) : (
      node
    )
  const sample = (force?: StyleState) =>
    blockId && element === 'block' ? (
      <section
        data-qb-section={`block-${blockId}`}
        data-qb-part="home-block"
        data-qb-surface="card"
        className="w-40 rounded-lg border border-border/40 bg-card p-3"
        {...(force && force !== 'base' ? { 'data-qb-force': force } : {})}
      >
        <h2 data-qb-part="section-heading" className="text-sm font-semibold">
          Top posts
        </h2>
      </section>
    ) : (
      <Sample element={element} force={force} />
    )
  return (
    <div
      {...layoutAttributes(design)}
      data-portal-theme=""
      data-testid="style-preview"
      className={design.mode === 'dark' ? 'dark' : undefined}
    >
      <style>{css}</style>
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-background p-4 text-foreground">
        <figure className="space-y-2">
          {inBlock(sample())}
          <figcaption className="text-[11px] text-muted-foreground">Normal</figcaption>
        </figure>
        {state !== 'base' && (
          <figure className="space-y-2">
            {inBlock(sample(state))}
            <figcaption className="text-[11px] text-muted-foreground">
              {STATE_INFO[state].label}
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  )
}
