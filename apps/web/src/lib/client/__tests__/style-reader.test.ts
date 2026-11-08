// @vitest-environment happy-dom
/**
 * The loop's verifier in the builder: a hover the page's CSS draws is copied
 * to a forcing attribute (nested rules, layers and conditions kept; a
 * "can this device hover" query dropped), an element is read in its state
 * and the state taken off again, and an element the page does not show
 * reads as not found. The builder's loop reads the drawn frame when it has
 * one and the design when it has none, and adopts each step's draft.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { STYLE_REGISTRY, targetKey } from '@/lib/shared/design/agent/style-registry'
import {
  FORCE_ATTR,
  forcedStateCss,
  forceSelector,
  readStyleTargets,
  type CssNode,
} from '../style-reader'
import { runBuilderEditLoop, type ServerStep } from '../edit-loop'

afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove())
  document.body.innerHTML = ''
})

describe('forcing states', () => {
  it('swaps each state for the forcing attribute', () => {
    expect(forceSelector('a:hover, b:focus-visible, c:focus, d:active, e:focus-within')).toBe(
      `a[${FORCE_ATTR}~="hover"], b[${FORCE_ATTR}~="focus"], c[${FORCE_ATTR}~="focus"], d[${FORCE_ATTR}~="pressed"], e:focus-within`
    )
  })

  it('copies only rules that need a state, with their layers, nesting and conditions', () => {
    const nodes: CssNode[] = [
      {
        kind: 'group',
        prelude: '@layer utilities',
        children: [
          { kind: 'style', selector: '.p', declarations: 'padding: 1px;', children: [] },
          {
            kind: 'style',
            selector: '.hover\\:bg',
            declarations: '',
            children: [
              {
                kind: 'style',
                selector: '&:hover',
                declarations: '',
                children: [
                  {
                    kind: 'group',
                    prelude: '@media (hover: hover)',
                    children: [{ kind: 'decls', declarations: 'background-color: red;' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: 'group',
        prelude: '@media (min-width: 40rem)',
        children: [
          { kind: 'style', selector: 'a:hover', declarations: 'color: blue;', children: [] },
        ],
      },
    ]
    expect(forcedStateCss(nodes).split('\n')).toEqual([
      `@layer utilities { :is(.hover\\:bg)[${FORCE_ATTR}~="hover"] { background-color: red; } }`,
      `@media (min-width: 40rem) { a[${FORCE_ATTR}~="hover"] { color: blue; } }`,
    ])
  })
})

describe('reading targets', () => {
  it('reads an element at rest and in a forced state, then takes the state off', () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot=button][data-variant=default] { background-color: rgb(79, 70, 229); color: rgb(255, 255, 255); } [data-slot=button][data-variant=default]:hover { background-color: rgb(55, 48, 163); }'
    document.head.appendChild(style)
    document.body.innerHTML =
      '<main style="background: rgb(250, 250, 250)"><button data-slot="button" data-variant="default" style="width: 80px; height: 30px; display: inline-block">Go</button></main>'
    const button = document.querySelector('button')!
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 80, height: 30 } as DOMRect)
    const base = { element: 'button', state: 'base' as const, block: '' }
    const hover = { ...base, state: 'hover' as const }
    const voted = { element: 'vote', state: 'current' as const, block: '' }
    const readings = readStyleTargets(document, STYLE_REGISTRY, [base, hover, voted])
    expect(readings[targetKey(base)]!.values.background).toBe('rgb(79, 70, 229)')
    expect(readings[targetKey(hover)]!.values.background).toBe('rgb(55, 48, 163)')
    expect(readings[targetKey(hover)]!.behind).toBe('#fafafa')
    expect(readings[targetKey(voted)]!.found).toBe(false)
    // Nothing left behind.
    expect(document.querySelector(`[${FORCE_ATTR}]`)).toBeNull()
    expect(document.querySelector('style[data-qb-forced-states]')).toBeNull()
  })
})

describe('the builder’s loop', () => {
  it('reads the design itself without a frame, and adopts each step’s draft', async () => {
    const design = portalDesign.parse(defaultDesign())
    const after = structuredClone(design)
    after.layout.cards = 'raised'
    const adopt = vi.fn()
    const step = vi.fn(async (_body: unknown): Promise<ServerStep> => ({
      ok: true,
      answer: {
        plan: 'Raise the cards',
        ops: [{ op: 'theme', target: '', key: 'cards', value: 'raised', says: '' }],
        styles: [],
        checks: [
          {
            element: 'postCard',
            state: 'base',
            block: '',
            target: '',
            property: 'shadow',
            expect: 'present',
            value: '',
          },
        ],
        read: [],
        look: false,
        read_website: '',
        match_website: '',
        done: true,
        reply: 'Cards are raised.',
      },
      outcome: {
        applied: [
          {
            path: 'layout.cards',
            before: design.layout.cards,
            after: 'raised',
            label: 'Cards to raised',
          },
        ],
        done: ['Cards to raised'],
        already: [],
        refused: [],
        outOfScope: [],
      },
      design: after,
      report: { adjustments: [], errors: [], css: [] },
      revision: 'r2',
    }))
    const result = await runBuilderEditLoop(
      {
        message: 'Raise the cards with a shadow',
        scope: 'site',
        history: [],
        design,
        targets: [],
        budget: { steps: 4, ms: 20_000 },
      },
      { step, adopt, previewCss: () => '' }
    )
    expect(adopt).toHaveBeenCalledWith(after, { adjustments: [], errors: [], css: [] }, 'r2')
    expect(step.mock.calls[0]![0]).toMatchObject({
      message: 'Raise the cards with a shadow',
      maxSteps: 4,
    })
    expect(result).toMatchObject({ ok: true, reply: 'Cards are raised.', stopped: 'done' })
  })
})
