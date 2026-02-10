# External Feedback Sources Brainstorm

**Date**: 2026-02-09
**Goal**: Explore feasibility of pulling feedback from external platforms with APIs into Quackback.

---

## Executive Summary

Researched 30+ platforms across review sites, support tools, social/community platforms, NPS tools, feedback competitors, and aggregator middleware. Quackback's existing architecture (service principals, integration table, event system, REST API) is well-suited for external integrations. Key gaps: no explicit "source" field on posts, no inbound webhook handlers per integration, no source-specific metadata.

---

## Platform Feasibility by Tier

### Tier 1: Build First (Easy, high value, good APIs)

| Platform                      | Auth              | Webhooks        | Cost               | Key Notes                                  |
| ----------------------------- | ----------------- | --------------- | ------------------ | ------------------------------------------ |
| **GitHub Issues/Discussions** | PAT / GitHub App  | Yes (excellent) | Free               | Best-in-class webhooks, 5K req/hr          |
| **Intercom**                  | OAuth / Bearer    | Yes             | $29+/seat/mo       | Full conversations, 10K calls/min          |
| **Zendesk**                   | API Token / OAuth | Yes             | $19+/agent/mo      | CSAT ratings + tickets                     |
| **Discourse**                 | API Key           | Yes             | Free (OSS)         | Open API, self-hosted = full control       |
| **Typeform**                  | OAuth / Bearer    | Yes             | $25+/mo            | Clean API, popular for feedback forms      |
| **App Store (Apple)**         | JWT               | No (poll)       | $99/yr dev program | Full review text, ~3.6K req/hr             |
| **Google Play**               | OAuth 2.0 (SA)    | No (poll)       | $25 one-time       | Full review text, 3K req/min               |
| **Hacker News**               | None needed       | No (poll)       | Free               | Two APIs (Firebase + Algolia), dead simple |

### Tier 2: Good, Moderate Complexity

| Platform           | Auth            | Webhooks            | Cost                 | Key Notes                                |
| ------------------ | --------------- | ------------------- | -------------------- | ---------------------------------------- |
| **Trustpilot**     | API Key + OAuth | Yes                 | Paid plan ($259+/mo) | Webhooks for new/deleted/revised reviews |
| **G2**             | Token-based     | RESThooks (limited) | $299+/mo             | JSON:API format, strict ToS on storage   |
| **HubSpot**        | OAuth / Bearer  | Yes                 | $90+/seat/mo (Pro)   | Read-only feedback API, expensive tier   |
| **SurveyMonkey**   | OAuth 2.0       | Yes                 | $39+/mo              | 500 calls/day non-Enterprise             |
| **Stack Overflow** | API Key         | No                  | Free                 | 10K req/day with key, CC BY-SA content   |

### Tier 3: Feasible with Caveats

| Platform            | Auth              | Webhooks            | Cost                                          | Key Notes                                                       |
| ------------------- | ----------------- | ------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| **Product Hunt**    | OAuth / Dev Token | No                  | Free (non-commercial)                         | No Review type, only aggregate rating, minimally maintained API |
| **Reddit**          | OAuth 2.0         | No                  | Free (non-commercial) / $0.24/1K (commercial) | Commercial use needs approval                                   |
| **Discord**         | Bot Token         | Gateway (WebSocket) | Free                                          | Requires bot per server, MESSAGE_CONTENT intent                 |
| **Slack**           | OAuth 2.0         | Events API          | Free                                          | Severe rate limits for non-Marketplace apps (May 2025 change)   |
| **Google Business** | OAuth 2.0         | No                  | Free (after approval)                         | Must apply and be approved by Google                            |

### Tier 4: Hard or Skip

| Platform          | Why Skip                                                       |
| ----------------- | -------------------------------------------------------------- |
| **Yelp**          | Only 3 truncated excerpts (160 chars), strict 24hr cache limit |
| **Capterra**      | No public API at all (G2 acquiring, may change)                |
| **Twitter/X**     | $200/mo minimum to read, $5K/mo for real volume                |
| **Facebook/Meta** | Page ratings deprecated in v22.0, heavy App Review process     |
| **LinkedIn**      | Partner approval takes weeks/months, not guaranteed            |

---

## Aggregator / Middleware Options

For pulling reviews from many platforms via a single API:

| Service         | Platforms                        | Pricing                    | Best For                                         |
| --------------- | -------------------------------- | -------------------------- | ------------------------------------------------ |
| **Datashake**   | 85+ review sites                 | From $19/mo (credit-based) | Best raw review data API for product integration |
| **DataForSEO**  | Google, Amazon, Trustpilot, etc. | Pay-per-request            | Cost-effective, async API model                  |
| **Reviewflowz** | Hundreds                         | $300+/mo                   | Per-listing pricing, auto-monitoring + dedup     |
| **BrightLocal** | 80+ sites                        | $0.05/req + $33+/mo base   | Mid-market, SEO-focused                          |

**Market gap**: No unified API platform (Merge, Unified.to, Apideck, Nango) offers a "reviews" or "customer feedback" category.

---

## Feedback Competitor Migration (Data Sources)

| Tool               | API Quality    | Key Data                       | Pricing                    | Notes                                                      |
| ------------------ | -------------- | ------------------------------ | -------------------------- | ---------------------------------------------------------- |
| **Canny**          | Excellent      | Boards, posts, votes, comments | Free tier, $79+/mo         | Best API overlap with Quackback data model                 |
| **UserVoice**      | Good           | Ideas, votes, forums, features | $499+/mo                   | Enterprise, rich admin API                                 |
| **Productboard**   | Good (v2 Beta) | Notes, features, releases      | $19+/user/mo (API on Pro+) | API gated on expensive plans                               |
| **Delighted**      | Good           | NPS/CSAT/CES surveys           | N/A                        | **SUNSETTING June 2026** - migration opportunity           |
| **Pendo Feedback** | Uncertain      | Feature requests, votes        | N/A                        | **Classic API sunsetting Aug 2026**, wait for Pendo Listen |

---

## NPS/Survey Tool APIs

| Tool                 | Auth                 | Data                             | Pricing                 |
| -------------------- | -------------------- | -------------------------------- | ----------------------- |
| **Retently**         | API Key              | NPS/CSAT/CES + campaign metadata | ~$25+/mo                |
| **SatisMeter**       | API Key + Project ID | NPS/CSAT/CES + dashboard stats   | Mid-market              |
| **AskNicely**        | X-apikey header      | NPS responses                    | Enterprise (not public) |
| **Wootric/InMoment** | OAuth 2.0            | NPS/CSAT/CES                     | Enterprise suite        |

---

## Existing Architecture Fit

Quackback already has:

- **Service principals** for integration identity (`packages/db/src/schema/auth.ts`)
- **Integration table** with OAuth secrets, config, sync tracking (`packages/db/src/schema/integrations.ts`)
- **Post external links** mapping posts to external platform IDs/URLs (`packages/db/src/schema/external-links.ts`)
- **Event system** for webhooks, notifications, AI (`apps/web/src/lib/server/events/`)
- **REST API** with API key auth for creating posts (`apps/web/src/routes/api/v1/`)
- **CSV import** for bulk ingestion (`apps/web/src/routes/api/import/`)

### Gaps to Address

1. No explicit `source` field on posts (service principal partially covers this)
2. No inbound webhook handlers per integration type
3. No source-specific metadata on posts (e.g., star rating, reviewer info)
4. No periodic sync/polling infrastructure

---

## Recommended Phased Strategy

### Phase 1: Foundation

- Add source metadata to post schema (platform, external rating, reviewer info)
- Build generic inbound webhook handler framework
- Build polling scheduler for platforms without webhooks

### Phase 2: Developer Tools

- GitHub Issues/Discussions (webhooks)
- Discourse (webhooks)
- Hacker News (polling, Algolia API)
- Stack Overflow (polling)

### Phase 3: Support & Survey Tools

- Intercom (webhooks)
- Zendesk (webhooks)
- Typeform (webhooks)
- Retently / SatisMeter (polling)

### Phase 4: Review Platforms

- App Store / Google Play (polling)
- Trustpilot (webhooks)
- G2 (polling)
- Consider Datashake/DataForSEO as aggregator middleware

### Phase 5: Competitor Migration

- Canny import (REST API)
- UserVoice import (Admin API)
- Delighted migration (sunsetting June 2026 - opportunity)

---

## Key Terms of Use Considerations

| Platform         | Storage OK?                | Display Requirements         | AI Analysis OK?                  |
| ---------------- | -------------------------- | ---------------------------- | -------------------------------- |
| Trustpilot       | Via API only               | Must show logo + attribution | Not specified                    |
| G2               | Restricted (needs license) | Cannot rename metrics        | Prohibited without consent       |
| Yelp             | 24hr cache max             | Must show Yelp branding      | Not specified                    |
| Product Hunt     | Not specified              | Attribution required         | Needs commercial approval        |
| GitHub           | Yes (public data)          | Minimal                      | Yes (CC-licensed answers for SO) |
| Intercom/Zendesk | Yes (your data)            | Standard ToS                 | Yes (your data)                  |
