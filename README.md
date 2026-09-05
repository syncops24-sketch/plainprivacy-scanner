# PlainPrivacy Scanner v1.0.7

Production-oriented first version of an automated **technical privacy implementation check** for PlainPrivacy. It uses Playwright to inspect a clean Chromium context before any consent interaction.

> **This scanner performs automated technical checks only. It does not provide legal advice and does not determine compliance with any privacy law.**

## Architecture

The application intentionally keeps the frontend simple and pushes all inspection into the backend.

```text
Browser
  -> Express API (/api/scan)
      -> URL + DNS safety validation
      -> rate limit + concurrency guard
      -> Playwright clean Chromium context
          -> per-request destination validation
          -> network/script/cookie/storage collection
          -> DOM inspection
      -> CMP/tracker/Consent Mode detectors
      -> conservative findings builder
      -> heuristic scorer
  <- JSON report
  -> static responsive results UI
```

### Modules

```text
plainprivacy-scanner-v1/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── config/env.js
│   ├── detectors/
│   │   ├── cmp.js
│   │   ├── consentMode.js
│   │   ├── dom.js
│   │   ├── patterns.js
│   │   └── trackers.js
│   ├── report/
│   │   ├── buildFindings.js
│   │   ├── report.js
│   │   └── score.js
│   ├── scanner/browserScanner.js
│   ├── security/
│   │   ├── ip.js
│   │   ├── semaphore.js
│   │   └── urlValidator.js
│   ├── utils/domain.js
│   └── server.js
├── test/
│   ├── detectors.test.js
│   └── ip.test.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Scoring model

The **0–100 Technical Privacy Implementation Score** is an automated heuristic, not a compliance score.

Scanner v1.0.7 no longer starts from a reassuring baseline. Only checks that produced enough observable evidence are scored. Unknown/manual checks are excluded from both the numerator and denominator and the UI prominently shows **scan coverage** such as `7/12 core checks assessable`. This prevents missing evidence from being treated as a pass.

High-confidence pre-interaction analytics/marketing cookies and conservative advertising/analytics collection endpoints can reduce the score. Presence of a tracker by itself is not scored as a failure.

## Detection rules

### Consent UI

The DOM inspector evaluates visible consent-oriented containers and prefers controls found **inside** those likely banner/dialog elements. It traverses open Shadow DOM roots where available. Generic page buttons such as an unrelated “Manage” button are not treated as consent controls merely because their text matches.

A missing button is normally **Needs manual verification**, not a failed compliance finding, because wording, iframes, closed Shadow DOM, geolocation and custom UI can defeat automated matching. Scanner v1.0.7 does not click consent controls.

### Settings / withdrawal

The scanner only calls a visible control a **cookie/privacy settings entry point** when it appears outside the likely initial consent interface. It does not claim that withdrawal is proven because proving withdrawal requires making a consent choice, reopening settings and retesting behavior.

### CMP detection

CMPs are matched against DOM markup, script URLs and observed network URLs. Patterns include Cookiebot, Usercentrics, OneTrust, Termly, Consentmo, Shopify Customer Privacy, TrustArc, Didomi, Quantcast Choice, CookieYes, Complianz, Iubenda, Osano, Ketch and Sourcepoint.

### Tracker detection and pre-interaction traffic

Tracker evidence comes from script URLs, network requests and recognized cookie names. Patterns include Google Tag Manager, GA4, Google Ads, Meta Pixel, TikTok, LinkedIn, Pinterest, Hotjar, Microsoft Clarity, Matomo and Segment.

Presence means **technical signal detected**. It does not mean the integration is incorrectly configured.

For pre-interaction traffic, Scanner v1.0.7 is intentionally conservative. Recognizable Meta/TikTok/LinkedIn/Pinterest collection endpoints can be surfaced as potential concerns. Google requests containing Consent Mode-related parameters are not automatically called a concern because denied-state pings can be expected in Advanced Consent Mode.

### Cookies and browser storage

The browser context begins clean. Cookies, localStorage and sessionStorage are recorded before any consent interaction. A high-confidence pattern list identifies common analytics/marketing cookie names; unknown names are shown for manual classification rather than guessed.

### Third-party network requests

First-party versus third-party classification uses the maintained `tldts` Public Suffix List implementation rather than a handcrafted suffix heuristic. Third-party requests remain evidence for manual purpose-based classification, not automatic violations.

### Google Consent Mode

The scanner detects the **presence** of `gcs`, `gcd`, consent storage keys or visible `gtag('consent', ...)` commands. It does not decode or judge the legal/technical correctness of those values.

### Duplicate tracking

Scanner v1.0.7 deliberately does **not** infer duplicate tracking from repeated GA4, Google Ads or Meta IDs. Normal tools send repeated requests with the same identifier. Reliable duplicate diagnosis requires event signatures, installation sources and interaction-level testing, so this remains a manual check.

## What Scanner v1.0.7 can reliably detect

* Common CMP signatures visible in markup, scripts or network requests.
* Common visible Accept / Reject / Preferences controls inside likely consent interfaces.
* A separate visible cookie/privacy settings entry point when detectable.
* Visible Privacy Policy and Cookie Policy links under common names.
* Common tracker technologies producing recognizable scripts, requests or cookies.
* Cookies, localStorage and sessionStorage present in a clean browser before scanner interaction.
* Third-party domains contacted in that initial-load window.
* Presence of common Google Consent Mode-related signals.
* Conservative pre-interaction analytics/advertising network concerns.

## What Scanner v1.0.7 cannot reliably detect

* Whether every tracker respects Reject, Accept or later consent changes.
* Whether consent can actually be withdrawn after a prior choice.
* Regional behavior outside the stated **scan location**.
* California opt-out or Global Privacy Control behavior.
* Full granular consent-category mapping.
* Server-side tracking or server-to-server data sharing.
* Reliable duplicate-event or duplicate-installation diagnosis.
* Whether the site is legally compliant or whether a privacy law applies.
* Behavior that appears only after login, checkout, navigation, delayed interaction or SPA route changes.
* Whether every unknown cookie/storage key is necessary or non-essential.

These belong in a PlainPrivacy manual technical review.

## Security approach

This scanner accepts arbitrary public URLs, so URL fetching must be treated as hostile input.

### Implemented application-layer controls

* Only `http:` and `https:` are accepted.
* Credentials in URLs are rejected.
* `localhost`, `.localhost`, `.local`, direct private/reserved IP ranges and metadata/link-local ranges are blocked.
* Hostnames are DNS-resolved before navigation and every returned address must be public.
* Each browser request is revalidated before Playwright is allowed to continue it. This also applies to subresources and redirected destinations.
* The final URL and every main-navigation redirect are validated again.
* Redirect count is capped.
* Navigation and total scan timeouts are strict.
* Images, fonts and media are blocked to reduce bandwidth/cost while preserving scripts/styles needed for DOM analysis.
* Total request count is capped.
* A declared oversized main document causes the scan to abort.
* JSON request size is capped.
* IP rate limiting is enabled.
* Concurrent browser scans are capped with an in-process semaphore.
* Chromium service workers are blocked to reduce background/network complexity.
* Helmet applies response security headers and a strict CSP to the frontend.

### Important production hardening

Application-level DNS validation reduces SSRF risk but should **not be the only boundary**. DNS rebinding, browser/network edge cases and future Playwright/Chromium behavior mean production should also have an infrastructure egress policy.

**Production requirement:** Run the scanner in its own isolated container or VM with **no route to private networks, cloud metadata endpoints, databases, admin services or your production control plane**. Allow outbound public web traffic only. Do not place the Playwright worker in a network where `10/8`, `172.16/12`, `192.168/16`, link-local or metadata services are reachable.

For a higher-volume public launch, use Redis-backed rate limiting and a real job queue/worker pool rather than the in-memory limiter/semaphore used by this single-instance v1.

## Local setup

Prerequisites: Node.js 20+ and npm.

```bash
cp .env.example .env
npm install
npm run playwright:install
npm test
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` loads the local `.env` file with Node's built-in `--env-file` option. Production platforms should inject environment variables directly; `npm start` does not require a local `.env` file.

## Production deployment

### Recommended container deployment

Use a container/VM dedicated to the scanner. The simplest reliable base is the official Playwright image matching the Playwright version in `package.json`, or a Node image followed by `npx playwright install --with-deps chromium` during build.

Example `Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

Then place it behind your HTTPS reverse proxy/load balancer.

Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy is in front of Express. Configure it correctly before relying on client-IP rate limits.

Recommended first-production values:

```text
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
SCAN_TIMEOUT_MS=25000
NAVIGATION_TIMEOUT_MS=12000
MAX_REDIRECTS=5
MAX_REQUESTS=250
MAX_MAIN_DOCUMENT_BYTES=5000000
MAX_CONCURRENT_SCANS=2
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=10
SCAN_LOCATION=Frankfurt, Germany
USER_AGENT=
```

Memory consumption is dominated by Chromium. Start conservatively, observe real scans, then tune concurrency based on the host size. Leave `USER_AGENT` blank to use Playwright Chromium's native version-matched browser User-Agent. Always set `SCAN_LOCATION` accurately in production because regional consent behavior can differ materially.

### Reverse proxy notes

At the proxy/load balancer level:

* Limit request body size.
* Add a request timeout slightly longer than `SCAN_TIMEOUT_MS` (for example 35 seconds).
* Add per-IP or edge/WAF rate limiting as a second layer.
* Do not cache `POST /api/scan`.
* Serve the site over HTTPS.

### Network policy

The worker/container should not be able to reach RFC1918 networks, loopback on the host, Kubernetes service ranges, cloud metadata (`169.254.169.254` and IPv6 equivalents), database subnets, admin panels or internal DNS zones.

If your infrastructure supports an outbound proxy, sending Playwright through a hardened public-web-only egress proxy provides an additional SSRF boundary.

## Product positioning

Recommended product wording:

* “Technical privacy implementation check”
* “Potential privacy implementation concern”
* “Technical signal detected”
* “Needs manual verification”
* “Automated scan only”

Avoid claims such as “GDPR compliant,” “CCPA compliant,” “illegal,” or “violation” from automated results.

The post-scan CTA in the included UI is:

> **Need the implementation verified properly?**

It points users to a PlainPrivacy manual technical review after already showing useful scan results. Scanner v1.0.7 does not require or collect an email address and does not intentionally persist scan results. Normal hosting/security/rate-limiting infrastructure may still temporarily process request metadata such as IP addresses.

## Suggested next improvements

1. Region-selectable isolated workers with explicit country labels.
2. CMP-specific interaction adapters that click Reject/Accept only with high-confidence selectors.
3. Before/after consent request and storage diffing.
4. Dedicated GPC browser profile for US privacy-flow testing.
5. Redis-backed queue/rate limiter and ephemeral browser workers for scale.
6. Event-signature-based duplicate tracking diagnostics.
7. Optional saved/email reports only after useful results are shown and with an explicit retention policy.
8. Versioned detector fixtures captured from real CMP implementations.

## v1.0.7 hardening changes

* Coverage-aware scoring; unknown checks no longer create a misleading positive score.
* Removed automatic duplicate-ID scoring.
* Added conservative pre-interaction tracker-network classification.
* Simplified Consent Mode detection to presence-only signals.
* Improved banner/control context detection and open Shadow DOM traversal.
* Renamed withdrawal result to a settings entry-point signal unless interaction proves withdrawal.
* Replaced domain heuristic with `tldts` Public Suffix List handling.
* Added explicit scan-location reporting.
* Blocked image resources in addition to fonts/media.
* Defaulted to Playwright Chromium's native User-Agent instead of a scanner-specific UA.
* Added scanner privacy disclosure, canonical/Open Graph metadata and stronger tests.

## License / ownership

This repository is intended for PlainPrivacy. Add your preferred project license before public distribution.


## v1.0.7 interpretation refinements

- Tightened CookieYes detection so generic `cky-` class fragments are not sufficient evidence.
- Added a separate Detected technologies & observations group for factual signals that are neither passes nor concerns.
- Reworded initial cookies, browser storage, and third-party requests as classification observations rather than implied problems.
- Consent Mode presence and tracker presence are observations; configuration correctness remains a manual question.

## v1.0.7 collection-endpoint refinement

Scanner v1.0.7 separates **tracker library/configuration loads** from recognizable **event or collection endpoints**. For example, loading `connect.facebook.net/.../fbevents.js` confirms that Meta Pixel code is present, but it is not by itself treated as evidence that a Meta tracking event was sent. A request to an endpoint such as `facebook.com/tr?...` is a stronger pre-interaction collection signal and can be surfaced as a potential concern. The same conservative distinction is used for supported Google, TikTok, LinkedIn and Pinterest patterns where reliable collection endpoints are known.

## v1.0.7 CMP cross-contamination fix

Consentmo detection no longer treats the generic `gdpr-backpack` substring as sufficient vendor evidence. The detector now requires a Consentmo-specific signal, a Consentmo-specific Shopify extension asset path, or a vendor-specific Consentmo DOM signature. This prevents unrelated sites from being labeled as using Consentmo merely because a generic backpack/GDPR string appears in loaded resources.

Explanatory report copy also avoids hard-coded scanner version numbers where the statement is version-independent, reducing stale-version text after future releases.
