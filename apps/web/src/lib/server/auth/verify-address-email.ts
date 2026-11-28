/**
 * The "prove you hold this address" email, for adding a first address and for
 * changing one. Shared by the email-OTP plugin's send callback and by the
 * current-address step of an email change, which mints its code without the
 * sign-in hook chain (see `functions/contact-email.ts`).
 */
export async function sendVerifyAddressCode(email: string, code: string): Promise<void> {
  const { sendVerifyAddressEmail } = await import('@quackback/email')
  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
  const { db } = await import('@/lib/server/db')
  const settings = await db.query.settings.findFirst({
    columns: { name: true, logoKey: true },
  })
  // A request email: the asking person's own language, then the browser that asked.
  const { recipientEmailLocale, requestAcceptLanguage } =
    await import('@/lib/server/email/email-locale')
  await sendVerifyAddressEmail({
    to: email,
    code,
    i18n: await recipientEmailLocale(await addressCheckReader(email), {
      acceptLanguage: await requestAcceptLanguage(),
    }),
    workspaceName: settings?.name ?? undefined,
    logoUrl: getEmailSafeUrl(settings?.logoKey) ?? undefined,
  })
}

/**
 * Whose language an address check is in: the signed-in person asking for it
 * (the address is being added to their own account), else whoever already
 * holds the address.
 */
async function addressCheckReader(email: string): Promise<{ userId?: string; email?: string }> {
  try {
    const { getRequestSession } = await import('@/lib/server/auth/request-session')
    const session = await getRequestSession()
    if (session?.user?.id) return { userId: session.user.id }
  } catch {
    // Outside a request: fall back to the address.
  }
  return { email }
}
