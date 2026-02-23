/**
 * User data synchronization handler interface.
 *
 * Implemented by CDP (Customer Data Platform) and CRM integrations that support
 * bidirectional user data sync:
 *
 *   Inbound:  External platform → Quackback
 *     Receives user identify/update events and writes traits to user.metadata.
 *     Example: Segment or RudderStack sends an `identify` call when a user's
 *     plan changes; Quackback updates user.metadata and re-evaluates segments.
 *
 *   Outbound: Quackback → External platform
 *     After dynamic segment evaluation, pushes membership changes back as user
 *     traits/properties so the external platform knows which segments each user
 *     belongs to.
 *     Example: a user joins the "Enterprise" segment → Segment receives an
 *     `identify` call with `{ traits: { enterprise: true } }`.
 *
 * Both methods are optional. An integration may implement either or both:
 *   - Inbound only:  CDP sends identify events; we update user.metadata
 *   - Outbound only: Push segment membership to a CRM after evaluation
 *   - Bidirectional: Full two-way sync
 */

/**
 * A normalised user identify payload, returned by handleIdentify when the
 * inbound event is valid and parseable.
 */
export interface UserIdentifyPayload {
  /** Email — primary lookup key for matching Quackback users. */
  email: string
  /** The platform's userId, stored for future cross-system identity linking. */
  externalUserId?: string
  /** Raw traits/properties from the external platform. */
  traits: Record<string, unknown>
}

export interface UserSyncHandler {
  /**
   * Verify and parse an inbound user identify/update event.
   *
   * Return a `UserIdentifyPayload` to have the orchestrator merge matching
   * traits into `user.metadata`. Return a `Response` to short-circuit:
   *   - 401 on bad signature
   *   - 200 for recognised-but-ignored event types (e.g. `track`, `page`)
   */
  handleIdentify?(
    request: Request,
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<UserIdentifyPayload | Response>

  /**
   * Push segment membership changes to the external platform.
   * Called (fire-and-forget) after dynamic segment evaluation.
   *
   * @param users       Users who joined or left the segment.
   * @param segmentName Human-readable segment name.
   * @param joined      true = users joined, false = users left.
   */
  syncSegmentMembership?(
    users: Array<{ email: string; externalUserId?: string }>,
    segmentName: string,
    joined: boolean,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<void>
}
