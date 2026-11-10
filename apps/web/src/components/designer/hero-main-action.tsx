/**
 * The hero panel's Main action rows, on the properties frame: what sits
 * under Home's headline (Composer, Search, Button or None), the composer's
 * width while it is in the hero, and with Button where it goes and whether
 * a second sits beside it. A choice whose page is off is left out, saying
 * why on hover; the one in use stays offered.
 */
import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { blockOf, type SettingField } from '@/lib/shared/design/blocks'
import type { HeroBlock, HeroKey } from '@/lib/shared/design/hero'
import { mainActionsOffered } from '@/lib/shared/design/main-action'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { PropertyRow, PropertyTiles } from './properties/properties-panel'
import { HERO_WORDS } from './properties/words'

type Choice = Extract<SettingField, { kind: 'choice' }>

const choiceOf = (key: HeroKey): Choice => {
  const field = blockOf('hero')!.fields.find((each) => each.key === key)
  if (field?.kind !== 'choice') throw new Error(`The hero has no choice ${key}`)
  return field
}

/** Advice for a row, or nothing: the reasons a choice is left out. */
const said = (lines: readonly string[]) => (lines.length ? lines.join(' ') : undefined)

export function MainActionRows({
  hero,
  gates,
  shown,
  onChange,
}: {
  hero: HeroBlock
  gates: PortalPageGates
  /** Whether the hero shows a setting, as it is. */
  shown: (key: HeroKey) => boolean
  onChange: (key: HeroKey, value: unknown) => void
}) {
  const id = useId()
  const offered = mainActionsOffered(gates)
  const action = choiceOf('mainAction')
  const width = choiceOf('composerWidth')
  const goes = choiceOf('buttonTo')
  return (
    <>
      <PropertyRow label={HERO_WORDS.mainAction} help={said(offered.notes.actions)}>
        <PropertyTiles
          label={action.label}
          value={hero.mainAction}
          options={action.options.filter(
            ([value]) => value === hero.mainAction || offered.actions.includes(value as never)
          )}
          onChange={(value) => onChange('mainAction', value)}
        />
      </PropertyRow>
      {shown('composerWidth') && (
        <PropertyRow label={HERO_WORDS.composerWidth}>
          <PropertyTiles
            label={width.label}
            value={hero.composerWidth}
            options={width.options}
            onChange={(value) => onChange('composerWidth', value)}
          />
        </PropertyRow>
      )}
      {shown('buttonTo') && (
        <PropertyRow label={HERO_WORDS.goesTo} help={said(offered.notes.buttonTo)}>
          <PropertyTiles
            label={goes.label}
            value={hero.buttonTo}
            options={goes.options.filter(
              ([value]) => value === hero.buttonTo || offered.buttonTo.includes(value as never)
            )}
            onChange={(value) => onChange('buttonTo', value)}
          />
        </PropertyRow>
      )}
      {shown('secondButton') && (
        <PropertyRow label={HERO_WORDS.secondButton} htmlFor={`${id}-second`}>
          <Switch
            id={`${id}-second`}
            aria-label={HERO_WORDS.secondButton}
            checked={hero.secondButton}
            className="ms-auto"
            onCheckedChange={(on) => onChange('secondButton', on)}
          />
        </PropertyRow>
      )}
    </>
  )
}
