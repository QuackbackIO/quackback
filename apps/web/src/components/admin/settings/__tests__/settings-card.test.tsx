// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SettingsCard } from '../settings-card'

const body = (container: HTMLElement) =>
  container.querySelector('[data-settings-card] > div:last-child') as HTMLElement

describe('SettingsCard', () => {
  afterEach(cleanup)

  it('pads the body by default', () => {
    const { container } = render(<SettingsCard>x</SettingsCard>)
    expect(body(container).className).toContain('p-4')
    expect(body(container).className).toContain('sm:p-6')
  })

  it('drops all body padding when flush, at every breakpoint', () => {
    const { container } = render(<SettingsCard flush>x</SettingsCard>)
    expect(body(container).className).not.toMatch(/\bp-4\b/)
    expect(body(container).className).not.toMatch(/sm:p-6/)
  })

  it('still applies contentClassName on a flush body', () => {
    const { container } = render(
      <SettingsCard flush contentClassName="divide-y">
        x
      </SettingsCard>
    )
    expect(body(container).className).toContain('divide-y')
  })

  const header = (container: HTMLElement) =>
    container.querySelector('[data-settings-card] > div:first-child') as HTMLElement

  it('centres a title with its action when there is no description', () => {
    const { container } = render(
      <SettingsCard title="Policies" action={<button>New policy</button>}>
        x
      </SettingsCard>
    )
    expect(header(container).className).toContain('items-center')
  })

  it('top-aligns the action when a description makes the title block taller', () => {
    const { container } = render(
      <SettingsCard title="Policies" description="Targets" action={<button>New policy</button>}>
        x
      </SettingsCard>
    )
    expect(header(container).className).toContain('items-start')
  })

  it('marks the danger variant so the theme keeps its red border', () => {
    const { container } = render(
      <SettingsCard title="Danger zone" variant="danger">
        x
      </SettingsCard>
    )
    expect(container.querySelector('[data-settings-card]')?.getAttribute('data-variant')).toBe(
      'danger'
    )
  })
})
