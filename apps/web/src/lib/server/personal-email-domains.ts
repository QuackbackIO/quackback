// The personal email domain list lives in the database package, so every
// service built on that package reads the same list. Server-only: the list is
// about 270 KB and is listed in the client import protection.
// oxlint-disable-next-line no-restricted-imports
export {
  companyEmailDomain,
  isPersonalEmailDomain,
} from '@quackback/db/email/personal-email-domains'
