import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/docs')({
  server: {
    handlers: {
      /**
       * GET /api/v1/docs
       * Serves Swagger UI for interactive API documentation.
       *
       * This endpoint is public and does not require authentication.
       */
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const baseUrl = `${url.protocol}//${url.host}`

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Quackback API Documentation - Build powerful integrations" />
  <title>API Reference | Quackback</title>
  <link rel="icon" href="/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    /* ════════════════════════════════════════════════════════════════════════════
       DESIGN TOKENS
       ════════════════════════════════════════════════════════════════════════════ */
    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

      --gold: #F7CC29;
      --gold-hover: #ffdb4d;
      --gold-muted: rgba(247, 204, 41, 0.15);

      --bg-base: #09090b;
      --bg-subtle: #0c0c0e;
      --bg-muted: #121214;
      --bg-elevated: #18181b;
      --bg-surface: #1c1c1f;

      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --text-faint: #52525b;

      --border-default: rgba(255, 255, 255, 0.08);
      --border-subtle: rgba(255, 255, 255, 0.04);
      --border-emphasis: rgba(255, 255, 255, 0.12);

      --method-get: #10b981;
      --method-get-bg: rgba(16, 185, 129, 0.08);
      --method-get-border: rgba(16, 185, 129, 0.25);

      --method-post: #3b82f6;
      --method-post-bg: rgba(59, 130, 246, 0.08);
      --method-post-border: rgba(59, 130, 246, 0.25);

      --method-put: #f59e0b;
      --method-put-bg: rgba(245, 158, 11, 0.08);
      --method-put-border: rgba(245, 158, 11, 0.25);

      --method-patch: #8b5cf6;
      --method-patch-bg: rgba(139, 92, 246, 0.08);
      --method-patch-border: rgba(139, 92, 246, 0.25);

      --method-delete: #ef4444;
      --method-delete-bg: rgba(239, 68, 68, 0.08);
      --method-delete-border: rgba(239, 68, 68, 0.25);

      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;

      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
      --shadow-glow: 0 0 40px rgba(247, 204, 41, 0.12);

      --transition-fast: 120ms ease;
      --transition-base: 200ms ease;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html {
      background: var(--bg-base);
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--bg-base);
      color: var(--text-primary);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      min-height: 100vh;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       HEADER
       ════════════════════════════════════════════════════════════════════════════ */
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 16px 20px;
    }

    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1a1a1c;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 100px;
      padding: 0 8px 0 18px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-primary);
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: -0.01em;
    }

    .logo img {
      width: 22px;
      height: 22px;
    }

    .logo-sep {
      color: var(--text-faint);
      font-weight: 400;
      margin: 0 2px;
    }

    .logo-context {
      color: var(--text-muted);
      font-weight: 500;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: 100px;
      transition: all var(--transition-fast);
    }

    .header-link:hover {
      color: var(--text-primary);
    }

    .header-link svg {
      width: 16px;
      height: 16px;
    }

    .header-link--github {
      background: #2a2a2c;
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 7px 12px;
    }

    .header-link--github:hover {
      background: #333335;
      border-color: rgba(255, 255, 255, 0.12);
    }

    .header-link--primary {
      background: var(--gold);
      color: #000;
      font-weight: 600;
      padding: 7px 14px;
    }

    .header-link--primary:hover {
      background: var(--gold-hover);
      color: #000;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       HERO
       ════════════════════════════════════════════════════════════════════════════ */
    .hero {
      padding: 64px 24px 48px;
      text-align: center;
    }

    .hero-inner {
      max-width: 640px;
      margin: 0 auto;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px 5px 8px;
      background: var(--gold-muted);
      border: 1px solid rgba(247, 204, 41, 0.2);
      border-radius: 100px;
      font-size: 12px;
      font-weight: 600;
      color: var(--gold);
      margin-bottom: 20px;
      letter-spacing: 0.02em;
    }

    .hero-badge svg {
      width: 14px;
      height: 14px;
    }

    .hero h1 {
      font-size: 40px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.025em;
      line-height: 1.15;
      background: linear-gradient(to bottom, var(--text-primary) 0%, var(--text-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero p {
      font-size: 16px;
      color: var(--text-muted);
      margin: 0 auto 28px;
      max-width: 480px;
      line-height: 1.6;
    }

    .hero-meta {
      display: flex;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
    }

    .hero-meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .hero-meta-item svg {
      width: 15px;
      height: 15px;
      color: var(--text-faint);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       MAIN CONTENT
       ════════════════════════════════════════════════════════════════════════════ */
    .main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px 80px;
    }

    .swagger-container {
      background: var(--bg-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      overflow: hidden;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       SWAGGER UI - BASE OVERRIDES
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui {
      font-family: var(--font-sans);
    }

    .swagger-ui .topbar,
    .swagger-ui .info {
      display: none !important;
    }

    .swagger-ui .wrapper {
      max-width: none;
      padding: 24px;
    }

    .swagger-ui,
    .swagger-ui .opblock-body,
    .swagger-ui .opblock .opblock-section-header,
    .swagger-ui section.models,
    .swagger-ui .model-box,
    .swagger-ui .model-container {
      background: transparent !important;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       AUTH SECTION
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .scheme-container {
      background: var(--bg-muted) !important;
      border-radius: var(--radius-lg);
      box-shadow: none;
      padding: 16px 20px;
      margin-bottom: 24px;
      border: 1px solid var(--border-subtle);
    }

    .swagger-ui .auth-wrapper {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }

    .swagger-ui .btn.authorize {
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      background: transparent;
      border: 1px solid var(--gold);
      color: var(--gold);
      padding: 8px 16px;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .swagger-ui .btn.authorize:hover {
      background: var(--gold-muted);
    }

    .swagger-ui .btn.authorize svg {
      fill: var(--gold);
      width: 14px;
      height: 14px;
    }

    .swagger-ui .btn.authorize.locked {
      background: var(--gold-muted);
      border-color: var(--gold);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       TAG SECTIONS (Accordion Headers)
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .opblock-tag-section {
      margin-bottom: 16px;
    }

    .swagger-ui .opblock-tag {
      font-family: var(--font-sans);
      color: var(--text-primary);
      border: none !important;
      border-bottom: 1px solid var(--border-default) !important;
      background: transparent !important;
      border-radius: 0 !important;
      padding: 20px 0 12px 0 !important;
      margin: 0 !important;
      cursor: pointer;
      transition: border-color var(--transition-fast);
    }

    .swagger-ui .opblock-tag:hover {
      background: transparent !important;
      border-bottom-color: var(--border-emphasis) !important;
    }

    /* Tag name */
    .swagger-ui .opblock-tag > a,
    .swagger-ui .opblock-tag > a > span {
      font-family: var(--font-sans) !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      letter-spacing: 0.06em !important;
      text-transform: uppercase !important;
      color: var(--text-primary) !important;
    }

    /* Tag description - hide it since it looks bad inline */
    .swagger-ui .opblock-tag > small {
      display: none !important;
    }

    .swagger-ui .opblock-tag svg,
    .swagger-ui .expand-operation svg {
      fill: var(--text-muted) !important;
      width: 10px !important;
      height: 10px !important;
      transition: transform var(--transition-fast);
    }

    .swagger-ui .opblock-tag-section .opblock-tag[data-is-open="true"] svg,
    .swagger-ui .opblock-tag-section.is-open .opblock-tag svg {
      transform: rotate(180deg);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       ENDPOINT BLOCKS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .opblock {
      background: transparent;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      margin: 0 0 6px 0;
      box-shadow: none;
      overflow: hidden;
      transition: all var(--transition-fast);
    }

    .swagger-ui .opblock:hover {
      border-color: var(--border-emphasis);
    }

    .swagger-ui .opblock .opblock-summary {
      padding: 0;
      border: none;
    }

    .swagger-ui .opblock .opblock-summary-control {
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .swagger-ui .opblock .opblock-summary-method {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      padding: 5px 8px;
      border-radius: var(--radius-sm);
      min-width: 56px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }

    .swagger-ui .opblock .opblock-summary-path {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      flex-grow: 1;
    }

    .swagger-ui .opblock .opblock-summary-path__deprecated {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .swagger-ui .opblock .opblock-summary-description {
      font-family: var(--font-sans);
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
      max-width: 280px;
      text-align: right;
    }

    /* Method-specific colors */
    .swagger-ui .opblock.opblock-get {
      background: var(--method-get-bg);
      border-color: var(--method-get-border);
    }
    .swagger-ui .opblock.opblock-get .opblock-summary-method {
      background: var(--method-get);
      color: #022c22;
    }
    .swagger-ui .opblock.opblock-get .opblock-summary-path {
      color: #34d399;
    }
    .swagger-ui .opblock.opblock-get:hover {
      border-color: var(--method-get);
    }

    .swagger-ui .opblock.opblock-post {
      background: var(--method-post-bg);
      border-color: var(--method-post-border);
    }
    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: var(--method-post);
      color: #eff6ff;
    }
    .swagger-ui .opblock.opblock-post .opblock-summary-path {
      color: #60a5fa;
    }
    .swagger-ui .opblock.opblock-post:hover {
      border-color: var(--method-post);
    }

    .swagger-ui .opblock.opblock-put {
      background: var(--method-put-bg);
      border-color: var(--method-put-border);
    }
    .swagger-ui .opblock.opblock-put .opblock-summary-method {
      background: var(--method-put);
      color: #422006;
    }
    .swagger-ui .opblock.opblock-put .opblock-summary-path {
      color: #fbbf24;
    }
    .swagger-ui .opblock.opblock-put:hover {
      border-color: var(--method-put);
    }

    .swagger-ui .opblock.opblock-patch {
      background: var(--method-patch-bg);
      border-color: var(--method-patch-border);
    }
    .swagger-ui .opblock.opblock-patch .opblock-summary-method {
      background: var(--method-patch);
      color: #f5f3ff;
    }
    .swagger-ui .opblock.opblock-patch .opblock-summary-path {
      color: #a78bfa;
    }
    .swagger-ui .opblock.opblock-patch:hover {
      border-color: var(--method-patch);
    }

    .swagger-ui .opblock.opblock-delete {
      background: var(--method-delete-bg);
      border-color: var(--method-delete-border);
    }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method {
      background: var(--method-delete);
      color: #fef2f2;
    }
    .swagger-ui .opblock.opblock-delete .opblock-summary-path {
      color: #f87171;
    }
    .swagger-ui .opblock.opblock-delete:hover {
      border-color: var(--method-delete);
    }

    /* Expanded state */
    .swagger-ui .opblock.is-open {
      box-shadow: var(--shadow-md);
    }

    .swagger-ui .opblock .opblock-section-header {
      background: transparent !important;
      border: none !important;
      padding: 16px 0 8px 0;
      min-height: auto;
    }

    .swagger-ui .opblock .opblock-section-header h4 {
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
      padding: 0;
      border: none;
    }

    .swagger-ui .opblock .opblock-section-header h4 span {
      color: var(--text-primary) !important;
    }

    .swagger-ui .opblock .opblock-section-header label {
      font-family: var(--font-sans);
      font-size: 12px;
      color: var(--text-primary);
    }

    .swagger-ui .opblock-body {
      padding: 16px;
    }

    .swagger-ui .opblock-body pre {
      background: var(--bg-base) !important;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px;
      margin: 8px 0;
    }

    /* Hide servers section - usually not needed */
    .swagger-ui .opblock-body .opblock-section .opblock-section-header + div .servers-title,
    .swagger-ui .opblock-body .opblock-section .opblock-section-header + div .servers,
    .swagger-ui .servers-title,
    .swagger-ui .servers {
      display: none !important;
    }

    /* Operation description */
    .swagger-ui .opblock-description-wrapper {
      padding: 0 0 16px 0;
      margin: 0;
    }

    .swagger-ui .opblock-description-wrapper p {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0;
      line-height: 1.6;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       PARAMETERS TABLE
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui table {
      width: 100%;
    }

    .swagger-ui table thead tr th,
    .swagger-ui table thead tr td {
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-primary) !important;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: transparent;
    }

    .swagger-ui table tbody tr td {
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-secondary);
      padding: 12px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: top;
    }

    .swagger-ui table tbody tr:last-child td {
      border-bottom: none;
    }

    .swagger-ui .parameter__name {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .swagger-ui .parameter__name.required::after {
      content: '*';
      color: var(--method-delete);
      margin-left: 2px;
    }

    .swagger-ui .parameter__type {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }

    .swagger-ui .parameter__in {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .swagger-ui .parameters-col_description {
      color: var(--text-secondary);
    }

    .swagger-ui .parameters-col_description p {
      margin: 0;
      line-height: 1.5;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       RESPONSES
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .responses-wrapper {
      padding-top: 8px;
    }

    .swagger-ui .responses-inner {
      padding: 0;
    }

    .swagger-ui .responses-inner h4,
    .swagger-ui .responses-inner h5,
    .swagger-ui .opblock-section-header h4 {
      font-family: var(--font-sans) !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: var(--text-primary) !important;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 10px 0;
    }

    .swagger-ui .response-col_status {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .swagger-ui .response-col_description {
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-primary);
    }

    .swagger-ui .response-col_description__inner p {
      color: var(--text-primary) !important;
    }

    .swagger-ui .response-col_links {
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* No parameters message */
    .swagger-ui .opblock-description-wrapper p,
    .swagger-ui .opblock-body .opblock-section p {
      color: var(--text-secondary) !important;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       BUTTONS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .btn {
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      border-radius: var(--radius-md);
      padding: 8px 14px;
      cursor: pointer;
      transition: all var(--transition-fast);
      border: none;
    }

    .swagger-ui .btn.execute {
      background: var(--gold);
      color: var(--bg-base);
      width: auto !important;
      min-width: 120px;
    }

    .swagger-ui .btn.execute:hover {
      background: var(--gold-hover);
    }

    .swagger-ui .execute-wrapper {
      padding: 16px 0 8px 0;
      text-align: left;
    }

    .swagger-ui .btn.cancel {
      background: transparent;
      border: 1px solid var(--border-default);
      color: var(--text-secondary);
    }

    .swagger-ui .btn.cancel:hover {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-primary);
      border-color: var(--border-emphasis);
    }

    .swagger-ui .btn-group {
      padding: 14px 0 0 0;
    }

    /* Try it out button */
    .swagger-ui .try-out__btn {
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      background: transparent;
      border: 1px solid var(--border-default);
      padding: 6px 12px;
      border-radius: var(--radius-md);
    }

    .swagger-ui .try-out__btn:hover {
      border-color: var(--border-emphasis);
      color: var(--text-primary);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       INPUTS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui input[type="text"],
    .swagger-ui input[type="password"],
    .swagger-ui input[type="search"],
    .swagger-ui input[type="email"],
    .swagger-ui input[type="file"],
    .swagger-ui textarea,
    .swagger-ui select {
      font-family: var(--font-mono);
      font-size: 13px;
      background: var(--bg-base);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      padding: 10px 12px;
      width: 100%;
      transition: all var(--transition-fast);
    }

    .swagger-ui input:focus,
    .swagger-ui textarea:focus,
    .swagger-ui select:focus {
      outline: none;
      border-color: var(--gold);
      box-shadow: 0 0 0 3px var(--gold-muted);
    }

    .swagger-ui input::placeholder,
    .swagger-ui textarea::placeholder {
      color: var(--text-faint);
    }

    .swagger-ui select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 36px;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       MODELS / SCHEMAS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui section.models {
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      margin-top: 24px;
      overflow: hidden;
    }

    .swagger-ui section.models h4 {
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      background: var(--bg-muted) !important;
      padding: 14px 16px;
      margin: 0;
      border: none;
      cursor: pointer;
    }

    .swagger-ui section.models h4 svg {
      fill: var(--text-muted);
    }

    .swagger-ui section.models .model-container {
      margin: 0;
      padding: 0;
    }

    .swagger-ui .model-box {
      background: var(--bg-muted) !important;
      border-radius: var(--radius-md);
      padding: 12px 14px;
      margin: 8px 12px;
    }

    .swagger-ui .model {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .swagger-ui .model-title {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .swagger-ui .model .property {
      color: var(--text-secondary);
    }

    .swagger-ui .model .property.primitive {
      color: var(--method-get);
    }

    .swagger-ui span > span.model .brace-close,
    .swagger-ui span > span.model .brace-open {
      color: var(--text-muted);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       CODE BLOCKS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .highlight-code,
    .swagger-ui .microlight,
    .swagger-ui pre.microlight {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      background: var(--bg-base) !important;
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 14px;
    }

    .swagger-ui .curl-command .copy-to-clipboard {
      right: 8px;
      bottom: 8px;
    }

    .swagger-ui .copy-to-clipboard button {
      background: var(--bg-elevated);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       MODAL
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .dialog-ux .backdrop-ux {
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
    }

    .swagger-ui .dialog-ux .modal-ux {
      background: var(--bg-elevated);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      max-width: 540px;
    }

    .swagger-ui .dialog-ux .modal-ux-header {
      border-bottom: 1px solid var(--border-subtle);
      padding: 20px 24px;
    }

    .swagger-ui .dialog-ux .modal-ux-header h3 {
      font-family: var(--font-sans);
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .swagger-ui .dialog-ux .modal-ux-header .close-modal {
      background: transparent;
      padding: 8px;
      border-radius: var(--radius-md);
      transition: background var(--transition-fast);
    }

    .swagger-ui .dialog-ux .modal-ux-header .close-modal:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .swagger-ui .dialog-ux .modal-ux-header .close-modal svg {
      fill: var(--text-muted);
    }

    .swagger-ui .dialog-ux .modal-ux-content {
      padding: 24px;
    }

    .swagger-ui .dialog-ux .modal-ux-content p {
      font-family: var(--font-sans);
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0 0 16px;
    }

    .swagger-ui .auth-container {
      padding-top: 0;
    }

    .swagger-ui .auth-container h4 {
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      margin: 0 0 8px;
    }

    .swagger-ui .auth-container .wrapper {
      padding: 0;
    }

    .swagger-ui .auth-btn-wrapper {
      padding-top: 16px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* ════════════════════════════════════════════════════════════════════════════
       FILTER / SEARCH
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .filter-container {
      margin-bottom: 16px;
      padding: 0;
    }

    .swagger-ui .filter-container .filter {
      width: 100%;
    }

    .swagger-ui .filter-container input[type="text"] {
      width: 100%;
      background: var(--bg-muted);
      border: 1px solid var(--border-subtle);
      padding: 10px 14px 10px 36px;
      font-size: 13px;
    }

    .swagger-ui .filter-container .filter-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       LABELS & BADGES
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui .markdown p,
    .swagger-ui .markdown li,
    .swagger-ui .renderedMarkdown p {
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .swagger-ui .markdown code,
    .swagger-ui .renderedMarkdown code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--text-primary);
    }

    .swagger-ui label {
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-primary);
    }

    .swagger-ui .tab li {
      font-family: var(--font-sans);
      font-size: 12px;
      color: var(--text-secondary);
      padding: 8px 0;
      margin-right: 16px;
      border-bottom: 2px solid transparent;
      transition: all var(--transition-fast);
    }

    .swagger-ui .tab li:hover {
      color: var(--text-primary);
    }

    .swagger-ui .tab li.active {
      color: var(--text-primary);
      border-bottom-color: var(--gold);
    }

    .swagger-ui .tab li button.tablinks {
      background: none;
      color: inherit;
      padding: 0;
      font: inherit;
    }

    /* Media type dropdown */
    .swagger-ui .response-control-media-type__accept-message {
      color: var(--text-secondary) !important;
      font-size: 12px;
    }

    .swagger-ui .response-control-media-type__title {
      color: var(--text-secondary) !important;
      font-size: 12px;
    }

    /* Loading */
    .swagger-ui .loading-container {
      padding: 40px;
    }

    .swagger-ui .loading-container .loading::before {
      border-color: var(--border-default);
      border-top-color: var(--gold);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       MISC SVG ICONS
       ════════════════════════════════════════════════════════════════════════════ */
    .swagger-ui svg:not(:root) {
      fill: currentColor;
    }

    .swagger-ui .arrow,
    .swagger-ui .expand-operation svg,
    .swagger-ui .models-control svg {
      fill: var(--text-muted);
    }

    .swagger-ui .opblock-control-arrow {
      fill: var(--text-muted);
    }

    .swagger-ui .unlocked svg {
      fill: var(--text-muted);
    }

    .swagger-ui .locked svg {
      fill: var(--gold);
    }

    /* ════════════════════════════════════════════════════════════════════════════
       RESPONSIVE
       ════════════════════════════════════════════════════════════════════════════ */
    @media (max-width: 768px) {
      .header {
        padding: 12px 16px;
      }

      .header-inner {
        padding: 0 4px 0 14px;
      }

      .logo-sep,
      .logo-context {
        display: none;
      }

      .header-link span {
        display: none;
      }

      .header-link {
        padding: 8px;
      }

      .header-link--primary {
        padding: 8px 12px;
      }

      .header-link--primary span {
        display: inline;
      }

      .hero {
        padding: 48px 16px 32px;
      }

      .hero h1 {
        font-size: 32px;
      }

      .hero p {
        font-size: 15px;
      }

      .hero-meta {
        gap: 12px;
      }

      .main {
        padding: 0 16px 60px;
      }

      .swagger-container {
        border-radius: var(--radius-lg);
      }

      .swagger-ui .wrapper {
        padding: 16px;
      }

      .swagger-ui .opblock .opblock-summary-description {
        display: none;
      }

      .swagger-ui .opblock .opblock-summary-control {
        gap: 10px;
      }
    }

    @media (max-width: 480px) {
      .swagger-ui .opblock .opblock-summary-method {
        min-width: 48px;
        font-size: 10px;
        padding: 4px 6px;
      }

      .swagger-ui .opblock .opblock-summary-path {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <a href="/" class="logo">
        <img src="/logo.png" alt="Quackback" />
        <span>Quackback</span>
        <span class="logo-sep">/</span>
        <span class="logo-context">API</span>
      </a>
      <div class="header-actions">
        <a href="/admin/settings/api-keys" class="header-link header-link--primary">
          <span>Get API Key</span>
        </a>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-inner">
      <div class="hero-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        REST API v1
      </div>
      <h1>API Reference</h1>
      <p>Build integrations and automate workflows with the Quackback API</p>
      <div class="hero-meta">
        <div class="hero-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Bearer Auth
        </div>
        <div class="hero-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          JSON
        </div>
        <div class="hero-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          OpenAPI 3.1
        </div>
      </div>
    </div>
  </section>

  <main class="main">
    <div class="swagger-container">
      <div id="swagger-ui"></div>
    </div>
  </main>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${baseUrl}/api/v1/openapi/json',
        dom_id: '#swagger-ui',
        deepLinking: false,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: 'StandaloneLayout',
        persistAuthorization: true,
        tryItOutEnabled: false,
        defaultModelsExpandDepth: 0,
        defaultModelExpandDepth: 1,
        docExpansion: 'list',
        filter: true,
        syntaxHighlight: {
          activated: true,
          theme: 'monokai'
        }
      });
    };
  </script>
</body>
</html>`

        return new Response(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
