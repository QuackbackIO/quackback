/**
 * Migrations written before this linter existed, grandfathered wholesale so
 * the linter doesn't force churn on history that predates the expand/contract
 * discipline it enforces.
 *
 * This list is FROZEN. It was derived by hand — reading every one of the 226
 * migrations in `packages/db/drizzle` at the time this scanner was added —
 * not by running the scanner and copying its output, which would make the
 * allowlist self-fulfilling and unable to ever fail.
 *
 * Do NOT add an entry here to silence a new failure. A new migration that
 * trips the linter needs a `-- @contract: safe-after X.Y.Z` annotation, not
 * a place in this list — that is the entire point of the control. The only
 * legitimate edits to this file are:
 *   - Removing an entry once someone retroactively annotates that historical
 *     migration (the completeness test below will name any entry that no
 *     longer needs grandfathering).
 *   - Documented review-sign-off if the project ever knowingly re-baselines
 *     (e.g. squashing history) — treat that PR like a MATRIX.md widened-gate
 *     diff, not a routine change.
 */
export const GRANDFATHERED_MIGRATIONS: readonly string[] = [
  '0002_groovy_pretty_boy.sql',
  '0005_greedy_stellaris.sql',
  '0006_thick_arclight.sql',
  '0013_keen_iron_monger.sql',
  '0016_ideas_redesign.sql',
  '0017_aromatic_zodiak.sql',
  '0020_lovely_callisto.sql',
  '0024_remove_merge_post_suggestions.sql',
  '0032_drop_dismiss_reason.sql',
  '0042_closed_lady_bullseye.sql',
  '0043_mighty_marrow.sql',
  '0045_needy_centennial.sql',
  '0046_military_nebula.sql',
  '0066_granular_access_controls.sql',
  '0067_drop_boards_moderation.sql',
  '0080_drop_board_audience.sql',
  '0091_drop_conversation_tags.sql',
  '0104_chat_message_flags_per_agent.sql',
  '0112_invitation_magic_link_tokens.sql',
  '0125_conversation_channel_drop_default.sql',
  '0127_conversation_tags_rename.sql',
  '0196_assistant_config_v2.sql',
  '0197_remove_data_connectors.sql',
  '0199_drop_roadmap_curation.sql',
  '0200_assistant_drop_channels_ai_label.sql',
  '0204_assistant_config_v3.sql',
  '0217_drop_feedback_pipeline.sql',
  '0220_drop_assistant_custom_actions.sql',
  '0224_identity_provider_claim_mapping.sql',
]
