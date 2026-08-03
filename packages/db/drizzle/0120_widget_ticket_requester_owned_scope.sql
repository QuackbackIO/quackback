UPDATE widget_environment_profiles
SET support_config = jsonb_set(
  COALESCE(support_config, '{}'::jsonb),
  '{ticketListScope}',
  '"requester_owned"'::jsonb,
  true
)
WHERE support_config->>'ticketListScope' = 'same_profile_allowed_inboxes';
