const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.co.in',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.it',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'aol.com',
  'aim.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'mail.com',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'tutanota.com',
  'tutanota.de',
  'tuta.com',
  'tuta.io',
  'tutamail.com',
  'zoho.com',
  'zohomail.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  'daum.net',
  'web.de',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'btinternet.com',
  'orange.fr',
  'wanadoo.fr',
  'laposte.net',
  'free.fr',
  'earthlink.net',
  'inbox.com',
])

export function getEmailDomain(email: string): string | null {
  const normalized = email.trim()
  const parts = normalized.split('@')
  if (parts.length !== 2 || !parts[0] || /[\s<>()\[\]"\\]/.test(parts[0])) return null
  const domain = parts[1].toLowerCase()
  if (domain.length > 253 || !domain.includes('.') || /^\d+(?:\.\d+){3}$/.test(domain)) return null
  if (!domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    return null
  return domain
}

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

export function companyEmailDomain(email: string): string | null {
  const domain = getEmailDomain(email)
  return domain && !isPersonalEmailDomain(domain) ? domain : null
}
