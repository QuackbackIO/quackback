/**
 * A headline accent with no colour of its own draws exactly as it did before
 * accents could take one.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { accented } from '../portal-band'

describe('a headline accent with no colour of its own', () => {
  it.each([
    [
      'colour',
      '<h1>Help shape what <span data-qb-accent="colour" class="text-[var(--qb-band-accent)]">Acme</span> grows into</h1>',
    ],
    [
      'highlight',
      '<h1>Help shape what <span data-qb-accent="highlight" class="px-[0.08em] [box-decoration-break:clone] [background:linear-gradient(transparent_58%,var(--qb-band-highlight)_58%,var(--qb-band-highlight)_92%,transparent_92%)]">Acme</span> grows into</h1>',
    ],
    [
      'muted',
      '<h1>Help shape what <span data-qb-accent="muted" class="text-[var(--qb-band-muted,var(--muted-foreground))]">Acme</span> grows into</h1>',
    ],
  ] as const)('in %s draws as before', (style, html) => {
    expect(
      renderToStaticMarkup(<h1>{accented('Help shape what Acme grows into', 'Acme', style)}</h1>)
    ).toBe(html)
  })

  it('in a colour role names it for the design to read', () => {
    expect(
      renderToStaticMarkup(<h1>{accented('Shape Acme', 'Acme', 'colour', 'support')}</h1>)
    ).toBe(
      '<h1>Shape <span data-qb-accent="colour" data-qb-accent-colour="support" class="text-[var(--qb-band-accent)]">Acme</span></h1>'
    )
    expect(
      renderToStaticMarkup(<h1>{accented('Shape Acme', 'Acme', 'colour', 'accent')}</h1>)
    ).toBe(
      '<h1>Shape <span data-qb-accent="colour" class="text-[var(--qb-band-accent)]">Acme</span></h1>'
    )
  })
})
