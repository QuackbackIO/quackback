/**
 * Whether a page a reader was served is the site's own, or something shown
 * in its place: an error or maintenance page, a queue, a bot check, or a
 * country picker. Import reads only the site's own page, and says which of
 * the others it met. A real page is never refused for a word it happens to use.
 */
import { describe, expect, it } from 'vitest'
import { pageKind, pickerCandidates, signsFromHtml, type PageSigns } from '../page-kind'

const page = (signs: Partial<PageSigns>): PageSigns => ({
  status: 200,
  title: 'Northwind',
  heading: '',
  lead: '',
  words: 6000,
  links: [],
  brandLike: true,
  ...signs,
})
const countries = [
  'Canada',
  'United States',
  'Mexico',
  'Brazil',
  'France',
  'Germany',
  'Spain',
  'Italy',
  'Japan',
  'Australia',
]
const countryLinks = countries.map((text, i) => ({ href: `https://northwind.example/${i}`, text }))

describe('pageKind', () => {
  it('takes an ordinary homepage for the site’s own', () => {
    expect(pageKind(page({}))).toBe('page')
    // Short, but with the brand on it.
    expect(pageKind(page({ words: 300, lead: 'Parcels, delivered. Get started' }))).toBe('page')
  })

  it.each([
    [{ status: 500 }],
    [{ status: 404, words: 200 }],
    [{ status: 403, words: 14, title: '403', brandLike: false }],
    [{ title: 'Error Page | Northwind', words: 60 }],
    [{ title: 'Northwind Bank - Internet Banking - Error', words: 900 }],
    [{ heading: 'We’re working on it.', lead: 'System maintenance is in progress.', words: 420 }],
    [
      {
        title: 'Northwind Airways - Information Page',
        lead: 'We are experiencing high demand on our site at the moment.',
        words: 140,
      },
    ],
    [
      {
        heading: 'Sorry',
        lead: 'Sorry. Something went wrong on our end. Please go back and try again.',
        words: 70,
      },
    ],
    // A splash with nothing of the brand on it.
    [{ words: 34, lead: 'Northwind - everything for a smile', brandLike: false }],
    [{ words: 0, brandLike: false }],
  ])('calls %j an error page', (signs) => {
    expect(pageKind(page(signs))).toBe('error')
  })

  it.each([
    [
      {
        title: 'northwind.example',
        lead: 'Confirm you’re human. Move the slider all the way to the right',
        words: 90,
      },
    ],
    [{ title: "Let's confirm you are human", words: 185 }],
    [{ title: 'Just a moment...', words: 32, status: 403 }],
    [
      {
        status: 403,
        lead: 'Unfortunately we are unable to give you access to our site at this time. A security issue was automatically identified',
        words: 1100,
      },
    ],
    [{ lead: 'Please complete the captcha to continue', words: 60 }],
    [
      {
        title: 'Just a moment...',
        heading: 'northwind.example',
        lead: 'Performing security verification. This website uses a security service to protect against malicious bots.',
        words: 263,
        status: null,
      },
    ],
    [
      {
        title: 'Bot or Not?',
        lead: 'Show us your human side... We can’t tell if you’re a human or a bot.',
        words: 105,
      },
    ],
    [
      {
        status: 403,
        heading: 'IP address is blocked',
        lead: 'Your access to Northwind has been temporarily blocked due to possible abuse from this IP address.',
        words: 1093,
      },
    ],
    // A bot check's script as the page's only words.
    [
      {
        title: 'northwind.example',
        lead: "var dd={'rt':'i','cid':'AHrlqAAAAAMA','hsh':'C992','b':722990}",
        words: 397,
        brandLike: false,
      },
    ],
  ])('calls %j a bot check', (signs) => {
    expect(pageKind(page(signs))).toBe('bot')
  })

  it.each([
    [{ heading: 'Hello! Choose a country.', words: 160 }],
    [{ title: 'Northwind International: Select your Country - Northwind', words: 400 }],
    // A list of regions and countries, some of them ones we do not know by name.
    [
      {
        heading: 'Discover the world of Northwind',
        words: 1100,
        links: [
          ...countryLinks,
          ...[
            'Aruba',
            'Bahamas',
            'Cayman Islands',
            'Curaçao',
            'Guam',
            'Kosovo',
            'Macau',
            'Malta',
            'Oman',
            'Qatar',
            'St. Maarten',
            'Trinidad',
          ].map((text, i) => ({ href: `https://northwind.example/x${i}`, text })),
        ],
      },
    ],
    // A short list of countries in their own language.
    [
      {
        heading: 'Northwind',
        words: 169,
        links: [
          'Argentina',
          'Bolivia',
          'Brasil',
          'Chile',
          'Colombia',
          'Costa Rica',
          'Dominicana',
          'Ecuador',
          'México',
          'Perú',
          'Uruguay',
          'Venezuela',
        ].map((text, i) => ({ href: `https://northwind.example/l${i}`, text })),
      },
    ],
    // No words for it: a page that is a list of countries.
    [
      {
        heading: 'Discover the world of Northwind',
        words: 1400,
        links: [...countryLinks, { href: 'https://northwind.example/about', text: 'About' }],
      },
    ],
  ])('calls %j a country picker', (signs) => {
    expect(pageKind(page(signs))).toBe('picker')
  })

  it.each([
    // A product about errors, uptime or security.
    [{ title: 'Application Monitoring and Error Tracking Software | Northwind' }],
    [
      {
        title: 'Northwind: maintenance software for fleets',
        heading: 'Maintenance, planned',
        words: 5200,
      },
    ],
    [{ title: 'Northwind Captcha: stop bots', lead: 'Add a captcha to any form.', words: 4000 }],
    [{ heading: 'Choose your plan', words: 3000 }],
    // A full homepage with its countries in the footer.
    [
      {
        words: 9000,
        links: [
          ...Array.from({ length: 60 }, (_, i) => ({
            href: `https://northwind.example/p${i}`,
            text: `Product ${i}`,
          })),
          ...countryLinks,
        ],
      },
    ],
    // A homepage that lists every country it serves, among its own words and links.
    [
      {
        words: 2037,
        heading: 'Order delivery near you',
        links: [
          ...Array.from({ length: 20 }, (_, i) => ({
            href: `https://northwind.example/c${i}`,
            text: `City ${i}`,
          })),
          ...countryLinks,
          ...countryLinks.map((link) => ({ ...link, href: `${link.href}/b` })),
        ],
      },
    ],
    // A plain site of a few lines, with no logo and no button: still a site.
    [
      {
        words: 617,
        title: 'Northwind Blog',
        heading: 'Northwind',
        lead: 'A privacy-first, no-nonsense, super-fast blogging platform.',
        brandLike: false,
      },
    ],
    // A short page with the brand on it and few words.
    [
      {
        words: 214,
        title: 'Northwind: Read and write stories.',
        heading: 'Human stories and ideas',
        lead: 'Our story Membership Write Sign in Get started',
      },
    ],
    // A short page that says error in passing, far from its title.
    [{ words: 700, lead: 'Ship faster. Catch every error before your customers do.' }],
  ])('never refuses a real page: %j', (signs) => {
    expect(pageKind(page(signs))).toBe('page')
  })
})

describe('pageKind, a form’s captcha notice', () => {
  it('does not take a short real page for a bot check because its footer names the captcha on its form', () => {
    for (const notice of [
      'This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.',
      'This site is protected by hCaptcha and its Privacy Policy and Terms of Service apply.',
      'Protected by reCAPTCHA',
    ])
      expect(
        pageKind(
          page({
            words: 1876,
            title: 'Northwind | Parcels delivered near you',
            heading: 'Order delivery near you',
            lead: `Skip to content Log in Sign up Order delivery near you Find restaurants ${notice}`,
          })
        ),
        notice
      ).toBe('page')
  })

  it('still takes a page that asks for a captcha to be solved for a bot check', () => {
    expect(
      pageKind(
        page({
          words: 120,
          title: 'northwind.example',
          lead: 'Please complete the captcha below to continue. This site is protected by reCAPTCHA.',
          brandLike: false,
        })
      )
    ).toBe('bot')
  })
})

describe('pickerCandidates', () => {
  const links = [
    { href: 'https://northwind.example/about', text: 'About us' },
    { href: 'https://northwind.example/ca', text: 'Canada' },
    { href: 'https://northwind.example/us', text: 'United States' },
    { href: 'https://www.northwind.co.uk/', text: 'United Kingdom' },
    { href: 'https://northwind.example/de', text: 'Deutschland' },
    { href: 'https://elsewhere.example/fr', text: 'France' },
    { href: 'https://northwind.example/fr', text: 'France' },
  ]

  it('gives up to three of the page’s country links, the admin’s own country first', () => {
    expect(pickerCandidates(links, 'https://northwind.example/', ['en-gb', 'en'])).toEqual([
      'https://www.northwind.co.uk/',
      'https://northwind.example/us',
      'https://northwind.example/ca',
    ])
    expect(pickerCandidates(links, 'https://northwind.example/', ['de-de'])).toEqual([
      'https://northwind.example/de',
      'https://northwind.example/us',
      'https://northwind.example/ca',
    ])
  })

  it('takes only links to the site itself or its own name under another ending, each once', () => {
    const got = pickerCandidates(links, 'https://northwind.example/', [])
    expect(got).not.toContain('https://elsewhere.example/fr')
    expect(got).not.toContain('https://northwind.example/about')
    expect(pickerCandidates([], 'https://northwind.example/', ['en'])).toEqual([])
  })
})

describe('pickerCandidates, addresses that are country sites', () => {
  const at = 'https://www.northwind.example/'
  const pick = (links: { href: string; text: string }[], languages: string[] = []) =>
    pickerCandidates(links, at, languages)

  it('never offers a page of the site itself that is no country’s home', () => {
    const got = pick([
      {
        href: 'https://www.northwind.example/en/pages/content/opt-out/opt-out',
        text: 'United States',
      },
      { href: 'https://www.northwind.example/', text: 'United States' },
      { href: 'https://www.northwind.example/stores/find?near=me', text: 'Canada' },
      { href: 'http://www.northwind.ca/', text: 'Canada' },
      { href: 'http://www.northwind.co.uk/', text: 'United Kingdom' },
    ])
    expect(got).toEqual(['http://www.northwind.ca/', 'http://www.northwind.co.uk/'])
  })

  it('takes the site’s own country homes: a code, a locale, a name or a choice in the address', () => {
    const got = pick([
      { href: 'https://www.northwind.example/us/', text: 'United States' },
      { href: 'https://www.northwind.example/en-gb', text: 'United Kingdom' },
      { href: 'https://www.northwind.example/ca/fr/', text: 'Canada' },
      { href: 'https://www.northwind.example/germany/home', text: 'Germany' },
      { href: 'https://www.northwind.example/?country=FR', text: 'France' },
      { href: 'https://www.northwind.example/es/index.html', text: 'Spain' },
    ])
    expect(got).toHaveLength(3)
    expect(got[0]).toBe('https://www.northwind.example/us/')
    expect(pick([{ href: 'https://www.northwind.example/?country=FR', text: 'France' }])).toEqual([
      'https://www.northwind.example/?country=FR',
    ])
    expect(pick([{ href: 'https://www.northwind.example/germany/home', text: 'Germany' }])).toEqual(
      ['https://www.northwind.example/germany/home']
    )
  })

  it('takes a link named for a language when its address names the country', () => {
    const links = [
      { href: 'https://www.northwind.example/en-us/', text: 'English' },
      { href: 'https://www.northwind.example/de-de/', text: 'Deutsch' },
      { href: 'https://www.northwind.example/en-us/help/contact', text: 'Contact us' },
      { href: 'https://www.northwind.example/blog/', text: 'Blog' },
    ]
    expect(pick(links, ['de-de'])).toEqual([
      'https://www.northwind.example/de-de/',
      'https://www.northwind.example/en-us/',
    ])
  })

  it('prefers, for one country, the address that names it', () => {
    const got = pick([
      { href: 'https://shop.northwind.example/', text: 'Canada' },
      { href: 'https://www.northwind.ca/', text: 'Canada' },
    ])
    expect(got).toEqual(['https://www.northwind.ca/', 'https://shop.northwind.example/'])
  })
})

describe('signsFromHtml', () => {
  it('reads the title, the first heading, the words and the links of a page, nothing run', () => {
    const html = `<!doctype html><html><head><title> Northwind  International </title><style>p{}</style></head>
      <body><script>var hidden = 'words'</script><h1>Hello! <b>Choose</b> a country.</h1>
      <a href="/ca">Canada</a> <a href="https://northwind.example/us"> United  States </a><a href="#top">Top</a></body></html>`
    const signs = signsFromHtml(html, 200, 'https://northwind.example/')
    expect(signs).toMatchObject({
      status: 200,
      title: 'Northwind International',
      heading: 'Hello! Choose a country.',
      links: [
        { href: 'https://northwind.example/ca', text: 'Canada' },
        { href: 'https://northwind.example/us', text: 'United States' },
      ],
    })
    expect(signs.lead).toContain('Hello! Choose a country. Canada')
    expect(signs.lead).not.toContain('hidden')
    expect(signs.words).toBe(signs.lead.length)
  })
})

describe('entities', () => {
  it('decodes each once, so an escaped entity stays as written', () => {
    const html =
      '<!doctype html><html><head><title>Fish &amp;quot;n&amp;quot; chips</title></head><body><p>Hi</p></body></html>'
    expect(signsFromHtml(html, 200, 'https://northwind.example/').title).toBe(
      'Fish &quot;n&quot; chips'
    )
  })
})
