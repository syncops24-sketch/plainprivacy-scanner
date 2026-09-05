export const CMP_PATTERNS = [
  {
    name: 'Cookiebot',
    networkPatterns: [/consent\.cookiebot\.com/i, /consentcdn\.cookiebot\.com/i, /cookiebot\.com\/uc\.js/i],
    scriptPatterns: [/cookiebot\.com/i],
    domPatterns: [/id=["']CybotCookiebotDialog/i, /data-cbid=/i, /CookieConsentDialog/i]
  },
  {
    name: 'Usercentrics',
    networkPatterns: [/app\.usercentrics\.eu/i, /usercentrics\.(?:eu|com)/i, /privacy-proxy\.usercentrics\.eu/i],
    scriptPatterns: [/usercentrics/i, /uc-cmp/i],
    domPatterns: [/<uc-app\b/i, /<uc-privacy-button\b/i, /id=["']usercentrics-root/i]
  },
  {
    name: 'OneTrust',
    networkPatterns: [/cdn\.cookielaw\.org/i, /geolocation\.onetrust\.com/i, /onetrust\.com/i],
    scriptPatterns: [/cdn\.cookielaw\.org/i, /onetrust/i, /optanon/i],
    domPatterns: [/id=["']onetrust-(?:banner-sdk|consent-sdk)/i, /class=["'][^"']*optanon/i]
  },
  {
    name: 'Termly',
    networkPatterns: [/app\.termly\.io/i, /cdn\.termly\.io/i, /termly\.io\/resource-blocker/i],
    scriptPatterns: [/termly\.io/i],
    domPatterns: [/id=["']termly-code-snippet-support/i, /data-name=["']termly-embed-banner/i, /TERMly_COOKIE_CONSENT/i]
  },
  {
    name: 'Consentmo',
    networkPatterns: [/(?:^|[./_?=&-])consentmo(?:[./_?=&-]|$)/i, /cdn\.shopify\.com\/extensions\/[^/?#]+\/gdpr-backpack[^/?#]*\/assets\/[^?#]*(?:^|[._-])consentmo(?:[._?-]|$)/i],
    scriptPatterns: [/(?:^|[./_?=&-])consentmo(?:[./_?=&-]|$)/i, /cdn\.shopify\.com\/extensions\/[^/?#]+\/gdpr-backpack[^/?#]*\/assets\/[^?#]*(?:^|[._-])consentmo(?:[._?-]|$)/i],
    domPatterns: [/<csm-cookie-consent\b/i, /class=["'][^"']*csm-cmp-/i]
  },
  {
    name: 'Shopify Customer Privacy',
    networkPatterns: [/cdn\.shopify\.com\/storefront\/(?:customer-privacy|privacy|consent)/i],
    scriptPatterns: [/cdn\.shopify\.com\/storefront\/(?:customer-privacy|privacy|consent)/i],
    domPatterns: [/Shopify\.customerPrivacy/i, /privacy-banner(?:-button)?["'\s=>]/i]
  },
  {
    name: 'TrustArc',
    networkPatterns: [/consent\.trustarc\.com/i, /trustarc\.com\/(?:notice|consent)/i, /truste-svc\.net/i],
    scriptPatterns: [/trustarc\.com/i, /truste-svc\.net/i],
    domPatterns: [/id=["']truste-consent-track/i, /class=["'][^"']*trustarc/i]
  },
  {
    name: 'Didomi',
    networkPatterns: [/sdk\.privacy-center\.org/i, /didomi\.io/i],
    scriptPatterns: [/didomi/i],
    domPatterns: [/id=["']didomi-host/i, /class=["'][^"']*didomi/i]
  },
  {
    name: 'Quantcast Choice',
    networkPatterns: [/quantcast\.mgr\.consensu\.org/i, /cmp\.quantcast\.com/i, /choice\.quantcast\.com/i],
    scriptPatterns: [/quantcast/i],
    domPatterns: [/qc-cmp2/i, /quantcast-choice/i]
  },
  {
    name: 'CookieYes',
    networkPatterns: [/cdn-cookieyes\.com/i, /cookieyes\.com/i],
    scriptPatterns: [/cookieyes/i],
    domPatterns: [/id=["']cky-consent/i, /class=["'][^"']*\bcky-consent-container\b/i, /class=["'][^"']*\bcky-consent-bar\b/i, /class=["'][^"']*\bcky-btn-revisit-wrapper\b/i]
  },
  {
    name: 'Complianz',
    networkPatterns: [],
    scriptPatterns: [/complianz/i, /cmplz/i],
    domPatterns: [/class=["'][^"']*cmplz-/i, /id=["']cmplz-/i]
  },
  {
    name: 'Iubenda',
    networkPatterns: [/cdn\.iubenda\.com/i, /iubenda\.com/i],
    scriptPatterns: [/iubenda/i],
    domPatterns: [/iubenda-cs-banner/i, /class=["'][^"']*iubenda/i]
  },
  {
    name: 'Osano',
    networkPatterns: [/cmp\.osano\.com/i, /osano\.com/i],
    scriptPatterns: [/osano/i],
    domPatterns: [/class=["'][^"']*osano-cm-/i]
  },
  {
    name: 'Ketch',
    networkPatterns: [/global\.ketchcdn\.com/i, /ketchcdn\.com/i],
    scriptPatterns: [/ketch/i],
    domPatterns: [/data-ketch-/i, /class=["'][^"']*ketch-/i]
  },
  {
    name: 'Sourcepoint',
    networkPatterns: [/cdn\.privacy-mgmt\.com/i, /sourcepoint/i],
    scriptPatterns: [/privacy-mgmt/i, /sourcepoint/i],
    domPatterns: [/sp_message_container/i, /class=["'][^"']*sp_choice/i]
  }
];

export const TRACKERS = [
  {
    id: 'gtm', name: 'Google Tag Manager', category: 'tag-manager',
    urlPatterns: [/googletagmanager\.com\/gtm\.js/i], cookiePatterns: []
  },
  {
    id: 'ga4', name: 'Google Analytics 4', category: 'analytics',
    urlPatterns: [/googletagmanager\.com\/gtag\/js.*[?&]id=G-/i, /google-analytics\.com\/g\/collect/i, /analytics\.google\.com/i],
    collectionPatterns: [/google-analytics\.com\/g\/collect/i, /analytics\.google\.com\/g\/collect/i],
    cookiePatterns: [/^_ga(?:_|$)/i]
  },
  {
    id: 'google_ads', name: 'Google Ads', category: 'marketing',
    urlPatterns: [/googleadservices\.com/i, /googleads\.g\.doubleclick\.net/i, /pagead\/conversion/i, /[?&]id=AW-/i],
    collectionPatterns: [/googleadservices\.com\/pagead\/conversion/i, /googleads\.g\.doubleclick\.net\/pagead\/(?:conversion|viewthroughconversion)/i, /pagead\/(?:conversion|viewthroughconversion)/i],
    cookiePatterns: [/^_gcl_/i]
  },
  {
    id: 'meta_pixel', name: 'Meta Pixel', category: 'marketing',
    urlPatterns: [/connect\.facebook\.net\/.*fbevents\.js/i, /facebook\.com\/tr\?/i],
    collectionPatterns: [/facebook\.com\/tr\?/i],
    cookiePatterns: [/^_fbp$/i, /^_fbc$/i]
  },
  {
    id: 'tiktok', name: 'TikTok Pixel', category: 'marketing',
    urlPatterns: [/analytics\.tiktok\.com/i], collectionPatterns: [/analytics\.tiktok\.com\/(?:i18n\/pixel\/events|api\/v\d+\/pixel)/i], cookiePatterns: [/^_ttp$/i]
  },
  {
    id: 'linkedin', name: 'LinkedIn Insight Tag', category: 'marketing',
    urlPatterns: [/snap\.licdn\.com/i, /px\.ads\.linkedin\.com/i], collectionPatterns: [/px\.ads\.linkedin\.com\/(?:collect|wa)/i], cookiePatterns: [/^li_fat_id$/i]
  },
  {
    id: 'pinterest', name: 'Pinterest Tag', category: 'marketing',
    urlPatterns: [/s\.pinimg\.com\/ct\/core\.js/i, /ct\.pinterest\.com/i], collectionPatterns: [/ct\.pinterest\.com\/(?:v3|user|conversion)/i], cookiePatterns: [/^_pin_unauth$/i]
  },
  {
    id: 'hotjar', name: 'Hotjar', category: 'analytics',
    urlPatterns: [/static\.hotjar\.com/i, /hotjar\.com/i], cookiePatterns: [/^_hj/i]
  },
  {
    id: 'clarity', name: 'Microsoft Clarity', category: 'analytics',
    urlPatterns: [/clarity\.ms/i], cookiePatterns: [/^_clck$/i, /^_clsk$/i]
  },
  {
    id: 'matomo', name: 'Matomo', category: 'analytics',
    urlPatterns: [/matomo\.(js|php)/i, /piwik\.(js|php)/i], cookiePatterns: [/^_pk_/i]
  },
  {
    id: 'segment', name: 'Segment', category: 'analytics',
    urlPatterns: [/cdn\.segment\.com/i, /api\.segment\.io/i], cookiePatterns: [/^ajs_/i]
  }
];

export const POTENTIAL_NONESSENTIAL_COOKIE_PATTERNS = [
  /^_ga(?:_|$)/i, /^_gid$/i, /^_gat/i, /^_gcl_/i, /^_fbp$/i, /^_fbc$/i,
  /^_hj/i, /^_clck$/i, /^_clsk$/i, /^_ttp$/i, /^li_fat_id$/i, /^_pin_/i,
  /^ajs_/i, /^_pk_/i
];
