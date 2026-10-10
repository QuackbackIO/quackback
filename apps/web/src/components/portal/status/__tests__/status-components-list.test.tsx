// @vitest-environment happy-dom
/**
 * A component group's header rolls its components up to one worst status,
 * shown as a colored dot. Color alone tells a screen reader nothing, so the
 * same status is part of the header's accessible name.
 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { StatusComponentGroupId, StatusComponentId } from '@quackback/ids'
import { StatusComponentsList } from '../status-components-list'

afterEach(cleanup)

it('names a group header by its worst status as well as its name', () => {
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <StatusComponentsList
        groups={[
          {
            id: 'status_group_1' as StatusComponentGroupId,
            name: 'Core services',
            collapsed: false,
            components: [
              {
                id: 'status_component_1' as StatusComponentId,
                name: 'API',
                description: null,
                status: 'operational',
                showUptime: false,
              },
              {
                id: 'status_component_2' as StatusComponentId,
                name: 'Webhooks',
                description: null,
                status: 'partial_outage',
                showUptime: false,
              },
            ],
          },
        ]}
        ungroupedComponents={[]}
        uptimeByComponentId={new Map()}
      />
    </IntlProvider>
  )
  expect(screen.getByRole('button', { name: 'Core services Partial outage' })).toBeInTheDocument()
})
