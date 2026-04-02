# Version Info & Documentation Link

**Issue**: [#117](https://github.com/QuackbackIO/quackback/issues/117)
**Date**: 2026-04-02

## Summary

Add version information and a documentation link to the admin area, with a dismissable update banner when a newer version is available. Designed for self-hosted Quackback instances where admins need to know if they're up to date.

## Components

### 1. Sidebar Footer

A compact, always-visible footer pinned to the bottom of the admin sidebar (outside the scrollable nav area):

- **Version text**: displays the current running version (e.g. `v0.7.3`), sourced from `package.json` at build time
- **Docs link**: small icon + "Docs" linking to `https://www.quackback.io/docs/`
- **Layout**: single row, muted text, unobtrusive

### 2. Server-Side Version Check

A server function that checks for the latest available release:

- **Source**: `GET https://api.github.com/repos/QuackbackIO/quackback/releases/latest`
- **Caching**: in-memory with 1-hour TTL, shared across all admin users
- **Response shape**: `{ version: string, url: string }` — version is the tag name stripped of the `v` prefix, url is the GitHub release page
- **Current version**: read from `package.json` at build time, exposed as a constant
- **Comparison**: semver compare — if latest > current, surface the update banner
- **Failure mode**: if the GitHub API call fails (network error, rate limit, firewall), silently return `null`. No banner, no error shown. Self-hosted instances behind firewalls simply never see the update banner.

### 3. Update Banner

A dismissable notification at the top of the admin layout (above page content, below top nav):

- **Content**: "Quackback v{version} is available" with two links:
  - **Primary**: "See what's new" linking to `https://feedback.quackback.io/changelog`
  - **Secondary**: "Release notes" linking to the GitHub release page for the specific version
- **Styling**: subtle, non-intrusive — muted background, not a loud warning color. Use existing Alert component or similar pattern.
- **Dismissal**: X button stores `quackback_dismissed_version: "{version}"` in `localStorage`. Banner stays hidden until a newer version than the dismissed one is available.
- **Visibility**: admin users only (not portal or widget users)
- **Scope**: appears on any admin page, not just settings

## Out of Scope

- Configurable docs URL (self-hosters pointing to internal docs) — can be added later if requested
- Auto-update or one-click upgrade functionality
- Version info on the portal or widget
- Settings page "About" section — the sidebar footer replaces the need for this
