# Migration contract ledger (generated, do not edit by hand)

Regenerate with `bunx vitest run apps/web/src/lib/server/policy/migration-contract -u`. A diff here means a migration gained, lost, or re-annotated destructive DDL — review it as a schema-compatibility change, then commit the regenerated file.

**Do not "fix" a red CI run by adding a new filename to `grandfathered.ts` and regenerating.** That list is frozen to the migrations that predate this linter. A new migration with an unannotated finding needs a `-- @contract: safe-after X.Y.Z` comment in the migration file, not an allowlist entry. See README.md.

## Summary

Migrations scanned: 247. Migrations with destructive DDL: 33.

| Kind | Occurrences |
| --- | --- |
| DROP COLUMN | 22 |
| DROP TABLE | 21 |
| DROP CONSTRAINT | 9 |
| RENAME COLUMN | 15 |
| RENAME TO (table) | 13 |
| SET NOT NULL | 4 |
| ALTER COLUMN TYPE | 2 |
| DROP DEFAULT | 1 |

## Migrations with destructive DDL

| File | Findings | Verdict |
| --- | --- | --- |
| 0002_groovy_pretty_boy.sql | DROP CONSTRAINT api_keys.api_keys_created_by_id_principal_id_fk | grandfathered |
| 0005_greedy_stellaris.sql | DROP COLUMN settings.telemetry_config | grandfathered |
| 0006_thick_arclight.sql | DROP CONSTRAINT posts.posts_official_response_principal_id_principal_id_fk; DROP COLUMN posts.official_response; DROP COLUMN posts.official_response_principal_id; DROP COLUMN posts.official_response_at | grandfathered |
| 0013_keen_iron_monger.sql | DROP CONSTRAINT integration_event_mappings.mapping_unique; DROP CONSTRAINT post_external_links.post_external_links_type_external_id | grandfathered |
| 0016_ideas_redesign.sql | DROP COLUMN feedback_themes.promoted_to_post_id | grandfathered |
| 0017_aromatic_zodiak.sql | DROP COLUMN posts.promoted_from_theme_id | grandfathered |
| 0020_lovely_callisto.sql | DROP TABLE dismissed_merge_pairs; DROP TABLE feedback_themes; DROP TABLE idea_post_links; DROP COLUMN feedback_signals.theme_id | grandfathered |
| 0024_remove_merge_post_suggestions.sql | DROP COLUMN feedback_suggestions.target_post_id; DROP COLUMN feedback_suggestions.similarity_score | grandfathered |
| 0032_drop_dismiss_reason.sql | DROP COLUMN feedback_suggestions.dismiss_reason_code; DROP COLUMN feedback_suggestions.dismiss_reason_note | grandfathered |
| 0042_closed_lady_bullseye.sql | ALTER COLUMN TYPE kb_articles.embedding | grandfathered |
| 0043_mighty_marrow.sql | DROP TABLE feedback_signal_corrections | grandfathered |
| 0045_needy_centennial.sql | ALTER COLUMN TYPE kb_articles.embedding | grandfathered |
| 0046_military_nebula.sql | DROP TABLE kb_domain_verifications | grandfathered |
| 0066_granular_access_controls.sql | DROP COLUMN boards.is_public; SET NOT NULL segments.slug; DROP CONSTRAINT user_segments.user_segments_added_by_check | grandfathered |
| 0067_drop_boards_moderation.sql | DROP COLUMN boards.moderation | grandfathered |
| 0080_drop_board_audience.sql | DROP COLUMN boards.audience | grandfathered |
| 0091_drop_conversation_tags.sql | DROP TABLE conversation_tags | grandfathered |
| 0104_chat_message_flags_per_agent.sql | DROP TABLE chat_message_flags | grandfathered |
| 0112_invitation_magic_link_tokens.sql | DROP COLUMN invitation.magic_link_token | grandfathered |
| 0125_conversation_channel_drop_default.sql | DROP DEFAULT conversations.channel | grandfathered |
| 0127_conversation_tags_rename.sql | RENAME TO (table) conversation_tags -> conversation_tag_assignments; RENAME COLUMN conversation_tag_assignments.chat_tag_id -> conversation_tag_id; RENAME TO (table) chat_tags -> conversation_tags; RENAME TO (table) post_tags -> post_tag_assignments; RENAME TO (table) tags -> post_tags; RENAME TO (table) comment_reactions -> post_comment_reactions; RENAME TO (table) comment_edit_history -> post_comment_edit_history; RENAME TO (table) votes -> post_votes; RENAME TO (table) comments -> post_comments; RENAME TO (table) chat_messages -> conversation_messages; RENAME TO (table) chat_message_mentions -> conversation_message_mentions; RENAME COLUMN conversation_message_mentions.chat_message_id -> conversation_message_id; RENAME TO (table) chat_message_reactions -> conversation_message_reactions; RENAME COLUMN conversation_message_reactions.chat_message_id -> conversation_message_id; RENAME TO (table) chat_message_flags -> conversation_message_flags; RENAME COLUMN conversation_message_flags.chat_message_id -> conversation_message_id; RENAME TO (table) merge_suggestions -> post_merge_suggestions | grandfathered |
| 0196_assistant_config_v2.sql | SET NOT NULL settings.assistant_config; SET NOT NULL settings.assistant_config_revision; DROP CONSTRAINT assistant_guidance_rules.assistant_guidance_rules_title_length_check; DROP CONSTRAINT assistant_guidance_rules.assistant_guidance_rules_body_length_check; RENAME COLUMN assistant_guidance_rules.title -> name; RENAME COLUMN assistant_guidance_rules.body -> instruction; RENAME COLUMN assistant_guidance_rules.surfaces -> channels; RENAME COLUMN assistant_guidance_rules.position -> priority; DROP COLUMN assistant_guidance_rules.category | grandfathered |
| 0197_remove_data_connectors.sql | DROP TABLE data_connectors | grandfathered |
| 0199_drop_roadmap_curation.sql | DROP TABLE post_roadmaps; DROP COLUMN roadmaps.is_public | grandfathered |
| 0200_assistant_drop_channels_ai_label.sql | DROP COLUMN assistant_guidance_rules.channels | grandfathered |
| 0204_assistant_config_v3.sql | SET NOT NULL assistant_guidance_rules.agent; DROP COLUMN assistant_guidance_rules.roles | grandfathered |
| 0217_drop_feedback_pipeline.sql | DROP COLUMN post_votes.feedback_suggestion_id; DROP TABLE pipeline_log; DROP TABLE feedback_signals; DROP TABLE feedback_suggestions; DROP TABLE raw_feedback_items; DROP TABLE feedback_sources; DROP TABLE external_user_mappings; DROP TABLE slack_channel_monitors | grandfathered |
| 0220_drop_assistant_custom_actions.sql | DROP TABLE assistant_actions | grandfathered |
| 0224_identity_provider_claim_mapping.sql | DROP COLUMN identity_provider.attribute_mapping | grandfathered |
| 0256_workspace_key_columns.sql | RENAME COLUMN kv_store.tenant_id -> workspace_key; RENAME COLUMN rate_bucket.tenant_id -> workspace_key; RENAME COLUMN kv_set_member.tenant_id -> workspace_key; RENAME COLUMN presence_stream.tenant_id -> workspace_key; RENAME COLUMN realtime_overflow.tenant_id -> workspace_key; RENAME COLUMN job_queue.tenant_id -> workspace_key; DROP COLUMN settings.cloud_tenant_id; RENAME COLUMN settings.cloud_tenant_id -> cloud_workspace_key | annotated (safe-after 0.13.1) |
| 0259_channel_threads.sql | DROP CONSTRAINT channel_accounts.channel_accounts_channel_check; DROP CONSTRAINT channel_accounts.channel_accounts_role_check | annotated (safe-after 0.13.2) |
| 0262_drop_assistant_custom_actions.sql | DROP TABLE assistant_actions | annotated (safe-after 0.13.2) |
| 0267_drop_workspace_billing.sql | DROP TABLE billing_webhook_events; DROP TABLE billing_usage_events; DROP TABLE billing_subscription_state | annotated (safe-after 0.13.2) |

## Grandfathered (29)

Historical migrations exempted from the annotation requirement because they predate this linter. Frozen — see `grandfathered.ts`.

- 0002_groovy_pretty_boy.sql
- 0005_greedy_stellaris.sql
- 0006_thick_arclight.sql
- 0013_keen_iron_monger.sql
- 0016_ideas_redesign.sql
- 0017_aromatic_zodiak.sql
- 0020_lovely_callisto.sql
- 0024_remove_merge_post_suggestions.sql
- 0032_drop_dismiss_reason.sql
- 0042_closed_lady_bullseye.sql
- 0043_mighty_marrow.sql
- 0045_needy_centennial.sql
- 0046_military_nebula.sql
- 0066_granular_access_controls.sql
- 0067_drop_boards_moderation.sql
- 0080_drop_board_audience.sql
- 0091_drop_conversation_tags.sql
- 0104_chat_message_flags_per_agent.sql
- 0112_invitation_magic_link_tokens.sql
- 0125_conversation_channel_drop_default.sql
- 0127_conversation_tags_rename.sql
- 0196_assistant_config_v2.sql
- 0197_remove_data_connectors.sql
- 0199_drop_roadmap_curation.sql
- 0200_assistant_drop_channels_ai_label.sql
- 0204_assistant_config_v3.sql
- 0217_drop_feedback_pipeline.sql
- 0220_drop_assistant_custom_actions.sql
- 0224_identity_provider_claim_mapping.sql
