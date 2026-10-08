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
  await sendVerifyAddressEmail({
    to: email,
    code,
    workspaceName: settings?.name ?? undefined,
    logoUrl: getEmailSafeUrl(settings?.logoKey) ?? undefined,
  })
}
