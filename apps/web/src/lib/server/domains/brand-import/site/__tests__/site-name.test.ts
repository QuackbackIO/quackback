/**
 * The name a site goes by, for the portal's header. Every source is held to
 * one test, whichever it is (the declared site name, the organisation's, the
 * app's, the logo's label, the title): it must spell the site's own domain.
 * A strapline, a greeting or another brand's name does not; the domain as
 * the page writes it is the fallback.
 */
import { describe, expect, it } from 'vitest'
import { brandName, writtenAs } from '../site-name'

describe('brandName', () => {
  it.each([
    // A strapline declared as the site's name.
    ['https://n26.example/', ['Love your bank', 'The bank you will love | N26'], 'N26'],
    // The name with its strapline.
    ['https://harbor.example/', ['Harbor - The Professional Publishing Platform'], 'Harbor'],
    // A nickname with a country, then the title that spells it out.
    [
      'https://northwindexpress.example/',
      ['Nwex UK', 'Northwind Express UK | Log in | Cards, Travel and Rewards'],
      'Northwind Express',
    ],
    // The address itself, declared as the name.
    ['https://qhs.example/', ['qhs.example', 'The QHS website - QHS'], 'QHS'],
    ['https://harbors.example/', ['Harbor’s Home Page'], 'Harbor’s'],
    ['https://ea.example/', ['Official EA Site'], 'EA'],
    ['https://harbor.example/', ['Official Harbor Site'], 'Harbor'],
    // A name of two words, one of them the domain's.
    ['https://acme.example/', ['Acme Parcel'], 'Acme Parcel'],
    ['https://bestparcel.example/', ['Best Parcel'], 'Best Parcel'],
    // A parent brand, or a mark, before the name: the word that spells the domain.
    ['https://harbor.example/', ['Northwind Harbor'], 'Harbor'],
    ['https://harbor.example/', ['</> harbor - high power tools'], 'harbor'],
    // An article before it is part of the name.
    ['https://courier.example/', ['The Courier'], 'The Courier'],
    ['https://monde.example/', ['Le Monde'], 'Le Monde'],
    // Initials.
    ['https://np.example/', ['Northwind Post'], 'Northwind Post'],
    // A name that is written as an address on purpose keeps its capitals.
    ['https://gov.example/', ['GOV.EXAMPLE', 'Welcome to GOV.EXAMPLE'], 'GOV.EXAMPLE'],
    [
      'https://www.thecourier.example/',
      ['Latest news and opinion from the Courier'],
      'The Courier',
    ],
    ['https://docs.acme.example/', ['Acme'], 'Acme'],
    // Initials, small words counted or not; a public body's ending is no name.
    ['https://tfn.gov.example/', ['Transport for Northwind'], 'Transport for Northwind'],
    [
      'https://nit.example/',
      ['Northwind Institute of Technology'],
      'Northwind Institute of Technology',
    ],
    // Short words that only spell the domain together.
    [
      'https://lecourier.example/',
      ['Le Courier in English - World news and opinion'],
      'Le Courier',
    ],
  ])('%s %j is %s', (url, sources, name) => {
    expect(brandName(sources, url)).toBe(name)
  })

  it('falls back to the domain, written as the page writes it', () => {
    // No source names it: the domain's own word, capitalised.
    expect(
      brandName(
        ['Capture, organise and tackle your to-dos from anywhere'],
        'https://harbor.example/'
      )
    ).toBe('Harbor')
    // The page writes it its own way somewhere in a longer line.
    expect(
      brandName(
        ['Love your bank', 'Everything you need from a bank, in one app by NORTHWIND today'],
        'https://northwind.example/'
      )
    ).toBe('NORTHWIND')
  })

  it('writes the fallback as the page’s own words write it, when it has them', () => {
    const page =
      'Sign in. Northwind Express cards. Why Northwind Express? Contact northwindexpress.example'
    expect(writtenAs(page, 'northwindexpress')).toBe('Northwind Express')
    expect(writtenAs('Pay with PayParcel. PayParcel is safe. paypal', 'payparcel')).toBe(
      'PayParcel'
    )
    expect(writtenAs('Nothing here names it', 'acme')).toBeNull()
    expect(
      brandName(['Nwex UK'], 'https://northwindexpress.example/', { written: 'Northwind Express' })
    ).toBe('Northwind Express')
    // Never for a source that already names it.
    expect(brandName(['Acme Parcel'], 'https://acme.example/', { written: 'ACME' })).toBe(
      'Acme Parcel'
    )
  })

  it('gives nothing when nothing was read', () => {
    expect(brandName([], 'https://acme.example/')).toBeUndefined()
    expect(brandName(['  ', ''], 'https://acme.example/')).toBeUndefined()
  })

  it('skips a source too long to be a name', () => {
    expect(brandName(['A'.repeat(101), 'Acme | Parcels'], 'https://acme.example/')).toBe('Acme')
  })
})
