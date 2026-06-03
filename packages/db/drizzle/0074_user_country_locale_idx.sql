-- Partial b-tree indexes on user.country and user.locale.
--
-- The dynamic-segment evaluator filters on both columns via predicates
-- like `u.country IN ('US', 'GB')` and `u.locale ILIKE 'en-%'`. The
-- 0072/0073 migrations added the columns but no indexes, so every
-- country/locale-based segment evaluation runs a seq scan over the
-- entire user table — and the dynamic-segment cron does that hourly.
--
-- Both columns are sparse (NULL when the request had no CDN header or
-- the IdP didn't supply a locale claim), so use a partial index with
-- `WHERE x IS NOT NULL` to keep the on-disk footprint proportional to
-- populated rows rather than total users.
CREATE INDEX IF NOT EXISTS "user_country_idx"
  ON "user" ("country") WHERE "country" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "user_locale_idx"
  ON "user" ("locale") WHERE "locale" IS NOT NULL;
