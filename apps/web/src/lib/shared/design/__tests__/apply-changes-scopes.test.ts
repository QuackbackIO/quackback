/**
 * Every field a design holds belongs to a part of the portal a request can be
 * scoped to, and the fields that make a brand's look, its exact values and
 * fonts, are in the scopes of the parts they style.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { applyDesignChanges, DESIGN_AI_SCOPES, scopeFields } from '../apply-changes'
import { defaultDesign, portalDesign } from '../schema'

/** Every field the schema names, as dotted paths down to lists, records and values. */
function fieldPaths(schema: z.ZodType, path = ''): string[] {
  let inner: z.ZodType = schema
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable)
    inner = inner.unwrap() as z.ZodType
  if (inner instanceof z.ZodObject)
    return Object.entries(inner.shape as Record<string, z.ZodType>).flatMap(([key, child]) =>
      fieldPaths(child, path ? `${path}.${key}` : key)
    )
  return [path]
}

const within = (path: string, field: string) => path === field || path.startsWith(`${field}.`)

describe('design AI scopes', () => {
  it('cover every field a design holds, outside the whole site', () => {
    const scoped = DESIGN_AI_SCOPES.filter((scope) => scope !== 'site')
    const orphans = fieldPaths(portalDesign)
      // Phone values and overrides validate but are not offered to the AI yet.
      .filter((path) => !['version', 'basedOn', 'css', 'stylePhone', 'overrides'].includes(path))
      .filter((path) => !path.startsWith('stylePhone.') && !path.startsWith('overrides.'))
      .filter((path) => !scoped.some((scope) => scopeFields(scope).some((f) => within(path, f))))
    expect(orphans).toEqual([])
  })

  it.each([
    ['brand', 'tune.button.radius', 4],
    ['brand', 'layout.cards', 'raised'],
    ['band', 'tune.headline.size', 48],
    ['band', 'brand.fonts.display', { kind: 'bundled', id: 'fraunces' }],
    ['feed', 'tune.card.radius', 16],
    ['feed', 'layout.postCardHides', ['tags']],
    ['header', 'tune.label.size', 15],
    ['home', 'tune.heading.size', 22],
    ['headline', 'tune.headline.weight', 300],
    ['button', 'tune.button.case', 'upper'],
    ['card', 'tune.card.shadow', 'lifted'],
    ['field', 'tune.field.radius', 0],
    ['menu', 'tune.label.weight', 600],
    ['logo', 'brand.logoColours', ['#0f766e', '#7a1f35']],
    ['status', 'layout.status', 'pill'],
  ] as const)('lets a request about %s set %s', (scope, path, value) => {
    const result = applyDesignChanges(defaultDesign(), [{ path, value: value as never }], scope)
    expect(result.outOfScope).toEqual([])
    expect(result.applied.map((change) => change.path)).toEqual([path])
  })

  it('keeps an element to its own fields', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [{ path: 'layout.band', value: 'brand' }],
      'button'
    )
    expect(result.outOfScope).toEqual(['layout.band'])
  })
})
