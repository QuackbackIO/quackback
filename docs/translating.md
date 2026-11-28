# Translating Quackback

Quackback ships in 13 languages: English (`en`), German (`de`), French (`fr`),
Spanish (`es`), Arabic (`ar`), Russian (`ru`), Brazilian Portuguese (`pt-br`),
Simplified Chinese (`zh-cn`), Traditional Chinese (`zh-tw`), Dutch (`nl`),
Polish (`pl`), Thai (`th`) and Ukrainian (`uk`).

This guide is for contributors who add or change text in the app. It covers
where strings live, how a page loads them, dates and numbers, and the tests
that keep the catalogues complete.

## Where strings live

Each language has one flat JSON catalogue in `apps/web/src/locales/<locale>.json`:
a map from a message key to its text. The English in `en.json` is the source.

Code names each message by its key and carries its English beside it:

```tsx
;<FormattedMessage id="admin.inbox.list.unassigned" defaultMessage="Unassigned" />

intl.formatMessage({ id: 'admin.inbox.list.empty', defaultMessage: 'No conversations' })
```

The English in code must be the English in `en.json`, word for word. English
pages render straight from the code and send no catalogue at all.

### Keys

- Admin: `admin.<area>.<component>.<name>`, for example `admin.inbox.list.unassigned`.
- Emails: `email.<template>.<name>`.
- The portal, the widget and the help center keep their own prefixes
  (`portal.`, `widget.`, `portal.hc.`).

Name a key after what the text is for, not after its English, so a change of
wording keeps the key.

### Adding a string

1. Write the `<FormattedMessage>` or `formatMessage` call with a new key and
   its English.
2. Add the key to `en.json` with the same English.
3. Add the key to the 12 other catalogues with a real translation. A value
   must not be empty or a copy of the English, unless the word really is the
   same in that language (brand names, `AI`, `PDF`); those are listed in
   `SAME_AS_ENGLISH` in `locales/__tests__/locale-parity.test.ts`.
4. Run the catalogue tests (see [Tests](#tests)).

### Writing the text

- Use ICU messages for counts and values:
  `{count, plural, one {# conversation} other {# conversations}}`. Never build a
  sentence by joining strings in code; word order differs between languages.
- No em dashes, in any language.
- Keep each language's own words for the product's parts. Read the existing
  catalogue first and reuse its terms. Some conventions:
  - German uses "du" and keeps "Board".
  - French: board is "Catégorie", changelog is "Nouveautés", roadmap is
    "Feuille de route".
  - Spanish uses "tú".
  - Brazilian Portuguese keeps "Feedback", "Roadmap" and "Changelog".
  - Traditional Chinese uses "你".
  - Polish uses the "Ty" form and calls feedback "Zgłoszenia".
  - Dutch uses "je".
- Names that a workspace wrote (boards, statuses, teams, custom roles) are
  shown as written and never go in the catalogue.
- The server returns error codes and values, not English sentences, for a
  page to show. The page turns the code into a catalogue message. Server log
  messages stay in English.

## How a page loads its strings

A page sends only the strings it can show, because page sizes have budgets
(`apps/web/perf/budgets.json`).

Strings that only one area of the app shows belong to a message area, listed
in `AREA_MESSAGE_PREFIXES` in `apps/web/src/lib/shared/i18n.ts`. Pages leave
area strings out of the catalogue they send, and each area loads its own:

- **Admin areas.** Each admin page belongs to one area (for example
  `adminInbox` for `admin.inbox.`). The page's route loader spreads
  `...(await seedAdminAreas(context.personLocale, 'adminInbox'))` into its
  data (or returns it, when it has nothing else to return), and the admin
  layout hands those strings to everything the route renders. The
  admin shell (the rail, menus, search, notifications and shared dialogs) has
  no area: its strings ride the admin layout's own seed.
- **Portal areas.** A portal route loader calls `seedAreaMessages` and wraps
  the page in `<AreaMessages area="..." messages={...}>`.
- **Surfaces that open on a click** (a modal that any page opens, say) mount
  `<AreaMessages area="...">` without `messages`; the strings load as the
  surface opens.

Two tests keep this honest:

- `components/shared/__tests__/area-message-boundary.test.ts` checks that an
  area's strings are used only by its own modules, and that those modules are
  reached only through the routes that load the area (or through a surface
  that mounts the area itself).
- `routes/admin/__tests__/admin-route-areas.test.ts` lists every admin page
  with its area. A new admin page fails it until you add the page to the list
  and seed its area in the loader.

### The page language

Admin follows each person's own language (Preferences > Appearance), and the
browser's language when they chose "Automatic". While admin is being
translated area by area, the document stays `lang="en" dir="ltr"` except on
routes listed in `LOCALIZED_ROUTE_IDS` (`lib/shared/document-locale.ts`). An
area's translation adds its routes there once the area is fully translated.

## Dates and numbers

Format dates and numbers in the page's language, never in a fixed one or the
runtime's default (which differs between the server and the browser and
breaks hydration):

- `<LocalDate date={...} options={...} />` for a date in the page, or
  `useLocalDateFormatter()` for a date that goes into a prop or a string.
- `useFormatNumber()` for numbers and money.
- `<TimeAgo date={...} />` for relative times ("3 days ago").

`locales/__tests__/admin-formats.test.tsx` fails on a format pinned to
`'en-US'` or left to the runtime default in admin code.

## Tests

Run these from `apps/web`:

```sh
TMPDIR=~/.cache/vt-tmp npx vitest run src/locales src/components/shared/__tests__/area-message-boundary.test.ts src/routes/admin/__tests__/admin-route-areas.test.ts
```

- `locale-parity.test.ts`: all 13 catalogues have the same keys, with no empty
  values and no copied English.
- `default-messages.test.ts`: the English in code equals `en.json`.
- `locale-vocabulary.test.ts`: no em dashes, one word per product.
- `admin-english-ratchet.test.ts`: admin code does not gain English.

### The English ratchet

`admin-english-ratchet.test.ts` reads the admin source files with a TypeScript
parser and counts the English in code in each one: text between tags; the
`label`, `placeholder`, `title`, `description`, `aria-label` and similar
props; the same fields on plain objects; and toast messages. It compares each
count with `admin-english-baseline.json` beside the test.

- A count may go down. It may never go up.
- A file the baseline does not list must have none, so a new file is written
  with the catalogue from the start.

A failure names the file, the count, the baseline and each string:

```
components/admin/inbox/inbox-filters.tsx has 3 English strings in code (baseline 0):
  line 41 "Assigned to me"
  line 58 placeholder="Search conversations..."
  line 77 toast.error("Could not save the view")
Move these strings to the catalog (en.json and the 12 other languages).
```

When you move strings to the catalogue, the counts drop and the test asks you
to lower the baseline:

```sh
bun run i18n:baseline
```

The script only lowers counts and drops files that have none or are gone; it
never raises a count or adds a file. When you rename or move a file that still
has English in it, carry its allowance to the new path in the same run:

```sh
bun run i18n:baseline --move components/admin/old-name.tsx components/admin/new-name.tsx
```

Commit the baseline with your change.
