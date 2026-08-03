// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChangelogFiltersPublic } from '../changelog-filters-public'

describe('ChangelogFiltersPublic', () => {
  it('renders nothing without filter dimensions', () => {
    const { container } = render(
      <ChangelogFiltersPublic
        categories={[]}
        products={[]}
        onCategoryChange={vi.fn()}
        onProductChange={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('toggles category and product pills', () => {
    const onCategoryChange = vi.fn()
    const onProductChange = vi.fn()
    render(
      <ChangelogFiltersPublic
        categories={[
          { id: 'cat_1', name: 'Feature', color: '#22c55e' },
          { id: 'cat_2', name: 'Fixes' },
        ]}
        products={[{ id: 'prod_1', name: 'Widget' }]}
        selectedCategoryId="cat_1"
        selectedProductId="prod_1"
        onCategoryChange={onCategoryChange}
        onProductChange={onProductChange}
      />
    )

    expect(screen.getByRole('button', { name: 'Feature' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Products' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onCategoryChange).toHaveBeenCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Feature' }))
    expect(onCategoryChange).toHaveBeenCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Fixes' }))
    expect(onCategoryChange).toHaveBeenCalledWith('cat_2')

    fireEvent.click(screen.getByRole('button', { name: 'All Products' }))
    expect(onProductChange).toHaveBeenCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Widget' }))
    expect(onProductChange).toHaveBeenCalledWith(undefined)
  })
})
