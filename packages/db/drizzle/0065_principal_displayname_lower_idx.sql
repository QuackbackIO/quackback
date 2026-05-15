-- Functional btree index for case-insensitive prefix search on principal.display_name.
-- Used by the @-mention typeahead endpoint, which runs:
--   WHERE lower(display_name) LIKE lower(:q) || '%'
-- The text_pattern_ops opclass is required for the planner to use this index
-- with LIKE 'prefix%' queries — a regular btree on lower(display_name) won't help
-- because the default opclass uses locale-aware comparison that LIKE can't exploit.

CREATE INDEX IF NOT EXISTS principal_displayname_lower_idx
  ON principal (lower(display_name) text_pattern_ops);
