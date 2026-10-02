// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WarningBox } from '@/components/shared/warning-box'

afterEach(cleanup)

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('theme radius', () => {
  it('keeps pills on compact controls only', () => {
    const { container } = render(
      <>
        <Button>Save</Button>
        <Badge>New</Badge>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
          </TabsList>
        </Tabs>
      </>
    )
    expect(classesOf(container.querySelector('[data-slot="button"]'))).toContain('rounded-item')
    expect(classesOf(container.querySelector('[data-slot="badge"]'))).toContain('rounded-item')
    expect(classesOf(container.querySelector('[data-slot="tabs-list"]'))).toContain('rounded-item')
    expect(classesOf(container.querySelector('[data-slot="tabs-trigger"]'))).toContain(
      'rounded-item'
    )
  })

  it('gives fields, banners and warnings 8px corners', () => {
    const { container } = render(
      <>
        <Input />
        <Alert>Heads up</Alert>
        <WarningBox title="Careful" />
      </>
    )
    for (const slot of ['input', 'alert', 'warning-box']) {
      expect(classesOf(container.querySelector(`[data-slot="${slot}"]`)), slot).toContain(
        'rounded-field'
      )
    }
  })
})
