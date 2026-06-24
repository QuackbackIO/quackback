export type AuthFormStep =
  | 'credentials'
  | 'email'
  | 'code'
  | 'forgot'
  | 'reset'
  // Inline 2FA stages. The surrounding dialog needs to know it's in one of
  // these so abandoning the dialog (X / backdrop / Esc) can revoke the
  // just-created session — enrollment runs against a full session that would
  // otherwise survive and bypass the workspace 2FA policy.
  | 'two-factor-enroll'
  | 'two-factor-challenge'
