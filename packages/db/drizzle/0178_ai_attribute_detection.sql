-- AI attribute detection (AI-ATTRIBUTES-PARITY-SPEC.md Phase 1). Two new
-- authoring flags on the conversation attribute registry, plus four seeded
-- system definitions the classifier can be pointed at immediately.
--
-- ai_detect: an admin opts an attribute into deterministic AI classification
-- at the "job done" moments (handoff, assistant close, inactivity close).
-- detect_on_close: additionally re-check when a teammate closes the
-- conversation. Both default false (admin opt-in) and are enforced
-- select-only at the service layer (not a DB constraint, matching the
-- existing options-per-field-type rule).
ALTER TABLE "conversation_attribute_definitions"
	ADD COLUMN "ai_detect" boolean DEFAULT false NOT NULL,
	ADD COLUMN "detect_on_close" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Seed the four system definitions competitors converge on (issue_type,
-- sentiment, urgency, spam). Descriptions double as the classifier prompt, so
-- every attribute and option carries an applies-if / does-not-apply-if line.
-- ai_detect stays false (an admin must opt in); source_hint 'ai' is the
-- display-only hint the admin UI already renders. ON CONFLICT (key) DO
-- NOTHING makes this idempotent against a workspace that already defined one
-- of these keys itself (the key stays theirs, this seed is a no-op for it).
INSERT INTO "conversation_attribute_definitions"
	(id, key, label, description, field_type, options, required_to_close, source_hint, ai_detect, detect_on_close)
VALUES (
	gen_random_uuid(),
	'issue_type',
	'Issue type',
	'What kind of issue this conversation is about. Applies once the customer''s underlying need is clear from the conversation; does not apply to small talk or a still-ambiguous first message with no real request in it yet.',
	'select',
	jsonb_build_array(
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Billing',
			'description', 'Applies when the customer asks about a charge, invoice, refund, or a subscription or plan change. Does not apply to a product bug or a feature idea.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Bug report',
			'description', 'Applies when the customer describes something broken, erroring, or not working as documented. Does not apply to a billing question or a request for something new.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Feature request',
			'description', 'Applies when the customer asks for new functionality or a product change that does not exist today. Does not apply to a bug in something that already exists.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Other',
			'description', 'Applies when the conversation is clearly about something else, or the topic cannot be determined from the transcript. Use this rather than guessing at one of the other options.'
		)
	),
	false,
	'ai',
	false,
	false
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO "conversation_attribute_definitions"
	(id, key, label, description, field_type, options, required_to_close, source_hint, ai_detect, detect_on_close)
VALUES (
	gen_random_uuid(),
	'sentiment',
	'Sentiment',
	'The customer''s tone in this conversation. Applies based on how the customer is communicating right now, not on whether their issue was ultimately resolved.',
	'select',
	jsonb_build_array(
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Positive',
			'description', 'Applies when the customer is happy, satisfied, appreciative, or complimentary. Does not apply to a neutral factual question.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Neutral',
			'description', 'Applies to a plain factual request or question with no clear emotional charge either way. Does not apply once the customer expresses frustration or delight.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Negative',
			'description', 'Applies when the customer is frustrated, upset, or complaining. Does not apply to a calm, neutral question, even about a problem.'
		)
	),
	false,
	'ai',
	false,
	false
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO "conversation_attribute_definitions"
	(id, key, label, description, field_type, options, required_to_close, source_hint, ai_detect, detect_on_close)
VALUES (
	gen_random_uuid(),
	'urgency',
	'Urgency',
	'How time-sensitive the customer''s request is, based on what they said. Applies once there is enough in the conversation to judge urgency; does not apply to a message with no indication either way, which should be left unset rather than guessed at Normal.',
	'select',
	jsonb_build_array(
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Urgent',
			'description', 'Applies when the customer describes a total blocker, an outage, data loss, or explicitly says it is urgent or time-critical. Does not apply to a routine question or a minor annoyance.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'High',
			'description', 'Applies when the issue is significantly affecting the customer''s work but they have a workaround or it is not a full stop. Does not apply to a total blocker (use Urgent) or a minor cosmetic issue.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Normal',
			'description', 'Applies to an everyday question or request with no particular time pressure. Does not apply once the customer signals a deadline or a blocker.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Low',
			'description', 'Applies to a minor cosmetic issue, a "nice to have", or something the customer explicitly says is not pressing. Does not apply to anything blocking their work.'
		)
	),
	false,
	'ai',
	false,
	false
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO "conversation_attribute_definitions"
	(id, key, label, description, field_type, options, required_to_close, source_hint, ai_detect, detect_on_close)
VALUES (
	gen_random_uuid(),
	'spam',
	'Spam',
	'Whether this conversation is unsolicited spam or abuse rather than a genuine support request. Applies only when the content is clearly promotional, automated, or abusive; a real (even low-quality or off-topic) customer request is never spam.',
	'select',
	jsonb_build_array(
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Spam',
			'description', 'Applies to unsolicited advertising, phishing, or automated/bot content with no genuine support request in it. Does not apply to a real customer question, even a low-quality or off-topic one.'
		),
		jsonb_build_object(
			'id', 'opt_' || gen_random_uuid()::text,
			'label', 'Legit',
			'description', 'Applies to any genuine customer conversation, whatever its quality or topic. Does not apply to unsolicited advertising or automated/bot content.'
		)
	),
	false,
	'ai',
	false,
	false
)
ON CONFLICT (key) DO NOTHING;
