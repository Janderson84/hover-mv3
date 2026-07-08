// ===== Hover MV3 Service Worker =====
// Replaces all 12 MV2 background scripts using declarativeNetRequest

// ==================== PAYWALL SITE DATA ====================

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const PAYWALL_BLACKLIST = [
  "adelaidenow.com.au", "baltimoresun.com", "barrons.com", "bloomberg.com",
  "businessinsider.com", "chicagobusiness.com", "chicagotribune.com", "chip.de",
  "clarin.com", "courant.com", "couriermail.com.au", "cricketarchive.com",
  "dailypress.com", "dailytelegraph.com.au", "durangoherald.com", "economist.com",
  "fd.nl", "forbes.com", "ft.com", "geelongadvertiser.com.au", "glassdoor.com",
  "goldcoastbulletin.com.au", "haaretz.co.il", "haaretz.com", "hbr.org",
  "heraldsun.com.au", "inc.com", "independent.co.uk", "investingdaily.com",
  "irishtimes.com", "kansas.com", "kansascity.com", "latimes.com",
  "lanacion.com.ar", "letemps.ch", "mcall.com", "medium.com",
  "medscape.com", "nationalpost.com", "newsweek.com", "newyorker.com",
  "nikkei.com", "nrc.nl", "nytimes.com", "ocregister.com",
  "orlandosentinel.com", "quora.com", "scmp.com", "seattletimes.com",
  "slashdot.org", "smh.com.au", "sun-sentinel.com", "technologyreview.com",
  "theage.com.au", "theaustralian.com.au", "theathletic.com",
  "theathletic.co.uk", "thenation.com", "thestreet.com", "thesundaytimes.co.uk",
  "thetimes.co.uk", "towardsdatascience.com", "washingtonpost.com", "wired.com",
  "wsj.com", "wsj.net"
];

// Sites where we skip UA spoofing (just change Referer)
const SPOOF_WHITELIST = new Set([
  "medium.com", "towardsdatascience.com", "glassdoor.com", "bloomberg.com"
]);

// Sites where we allow cookies (don't strip Set-Cookie)
const COOKIE_WHITELIST = new Set([
  "medium.com", "towardsdatascience.com", "nytimes.com", "quora.com",
  "wired.com", "newyorker.com", "theathletic.com", "theathletic.co.uk",
  "businessinsider.com"
]);

// ==================== RULE ID RANGES ====================
const PAYWALL_RULE_START = 10000;
const AD_RULE_START = 20000;
const USER_AD_RULE_START = 30000;

// ==================== INITIALIZATION ====================

chrome.runtime.onInstalled.addListener(async (details) => {
  // Initialize storage with default lists
  if (details.reason === 'install') {
    // Generate ad block rules from the bundled data
    const adDomains = await fetchAdDomains();
    await chrome.storage.sync.set({
      adblockWhitelistDict: {},
      paywallBlacklistDict: arrayToDict(PAYWALL_BLACKLIST),
      paywallSMWhitelistDict: {},
      paywallSpoofWhitelistDict: arrayToDict([...SPOOF_WHITELIST]),
      paywallCookieWhitelistDict: arrayToDict([...COOKIE_WHITELIST])
    });
  }
  
  await setupRules();
});

// ==================== RULE SETUP ====================

async function setupRules() {
  // Remove all existing dynamic rules
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);
  
  const paywallRules = buildPaywallRules();
  const adDomains = await fetchAdDomains();
  const adRules = buildAdBlockRules(adDomains);
  
  // Check if user has any custom whitelist entries from storage
  const storage = await chrome.storage.sync.get([
    'adblockWhitelistDict',
    'paywallBlacklistDict',
    'paywallCookieWhitelistDict',
    'paywallSpoofWhitelistDict',
    'paywallSMWhitelistDict'
  ]);
  
  // Filter out whitelisted ad domains
  const adblockWhitelist = storage.adblockWhitelistDict || {};
  const filteredAdRules = adRules.filter(rule => {
    // Check if any of this rule's domains are whitelisted
    const domains = rule.condition?.requestDomains || [];
    return !domains.some(d => d in adblockWhitelist);
  });
  
  // Build custom paywall rules from user's blacklist
  const userBlacklist = storage.paywallBlacklistDict || {};
  const userCookieWhitelist = storage.paywallCookieWhitelistDict || {};
  const userSpoofWhitelist = storage.paywallSpoofWhitelistDict || {};
  
  // Merge default + user-defined paywall sites
  const allPaywallSites = [...PAYWALL_BLACKLIST];
  for (const pattern in userBlacklist) {
    // Extract domain from pattern like "*://*.domain.com/*"
    const match = pattern.match(/:\/\*\.(.+?)\//);
    if (match && !PAYWALL_BLACKLIST.includes(match[1])) {
      allPaywallSites.push(match[1]);
    }
  }
  
  const customPaywallRules = buildPaywallRulesForSites(allPaywallSites, userCookieWhitelist, userSpoofWhitelist);
  
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules: [...customPaywallRules, ...filteredAdRules]
  });
}

function buildPaywallRulesForSites(sites, cookieWhitelist, spoofWhitelist) {
  const rules = [];
  let id = PAYWALL_RULE_START;
  
  for (const domain of sites) {
    const pattern = `*://*.${domain}/*`;
    const requestHeaders = [];
    
    // Always set Referer to t.co
    requestHeaders.push(
      { header: "Referer", operation: "set", value: "https://t.co/" }
    );
    
    // Spoof User-Agent and X-Forwarded-For unless in spoof whitelist
    if (!(pattern in spoofWhitelist)) {
      requestHeaders.push(
        { header: "User-Agent", operation: "set", value: GOOGLEBOT_UA },
        { header: "X-Forwarded-For", operation: "set", value: "66.249.66.1" }
      );
    }
    
    const responseHeaders = [];
    // Block cookies unless in cookie whitelist
    if (!(pattern in cookieWhitelist)) {
      responseHeaders.push(
        { header: "Set-Cookie", operation: "remove" }
      );
    }
    
    const rule = {
      id: id++,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: requestHeaders
      },
      condition: {
        requestDomains: [domain],
        resourceTypes: ["main_frame"]
      }
    };
    
    // Only add responseHeaders if we're blocking cookies
    if (responseHeaders.length > 0) {
      rule.action.responseHeaders = responseHeaders;
    }
    
    rules.push(rule);
  }
  
  return rules;
}

function buildPaywallRules() {
  return buildPaywallRulesForSites(
    PAYWALL_BLACKLIST,
    arrayToDict([...COOKIE_WHITELIST]),
    arrayToDict([...SPOOF_WHITELIST])
  );
}

function buildAdBlockRules(domains) {
  // Group domains into batches of 100 (declarativeNetRequest limit)
  const rules = [];
  const batchSize = 100;
  
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const ruleId = AD_RULE_START + (i / batchSize);
    
    rules.push({
      id: ruleId,
      priority: 1,
      action: { type: "block" },
      condition: {
        requestDomains: batch,
        resourceTypes: ["script", "image", "sub_frame", "xmlhttprequest", "other"]
      }
    });
  }
  
  return rules;
}

// ==================== AD DOMAIN DATA ====================

// Bundled as a function that returns the domain list.
// Reduced to well-known domains for reasonable size.
async function fetchAdDomains() {
  // If custom ad domains were saved to storage, use those
  const stored = await chrome.storage.sync.get(['adDomains']);
  if (stored.adDomains) return stored.adDomains;
  return getDefaultAdDomains();
}

function getDefaultAdDomains() {
  return [
    // Major ad networks
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "googletagservices.com", "googletagmanager.com", "google-analytics.com",
    "adservice.google.com", "pagead2.googlesyndication.com",
    "pubmatic.com", "openx.net", "appnexus.com", "rubiconproject.com",
    "criteo.com", "criteo.net", "casalemedia.com", "contextweb.com",
    "sojern.com", "adnxs.com", "adsrvr.org", "adpushup.com",
    "amazon-adsystem.com", "aax.amazon-adsystem.com",
    "adsafeprotected.com", "moatads.com", "moat.com",
    "scorecardresearch.com", "quantserve.com", "comscore.com",
    "taboola.com", "taboolasyndication.com", "outbrain.com",
    "outbrainimg.com", "sharethrough.com", "undertone.com",
    "adzerk.net", "exponential.com", "tribalfusion.com",
    // Social & tracking
    "facebook.com/tr", "connect.facebook.net", "analytics.twitter.com",
    "ads.linkedin.com", "bat.bing.com", "pinterest.com/audience",
    "ct.pinterest.com", "redditstatic.com", "sb.scorecardresearch.com",
    // Analytics & telemetry
    "hotjar.com", "mouseflow.com", "fullstory.com", "luckyorange.com",
    "crazyegg.com", "clicky.com", "mixpanel.com", "amplitude.com",
    "segment.io", "segment.com", "heap.io", "intercom.io",
    "intercomcdn.com", "driftt.com", "olark.com", "usefathom.com",
    "simpleanalytics.com", "plausible.io", "matomo.org",
    // Ad exchanges & DSPs
    "advertising.com", "atdmt.com", "bluekai.com", "demdex.net",
    "krxd.net", "rfihub.com", "turn.com", "xaxis.com",
    "media.net", "adroll.com", "optimizely.com",
    // Affiliate & content marketing
    "skimlinks.com", "skimresources.com", "viglink.com", "shareasale.com",
    "impactradius.com", "commissionjunction.com", "rakutenmarketing.com",
    "linksynergy.com", "awin1.com", "cj.com",
    // Popups & widgets
    "sumo.com", "sumome.com", "optinmonster.com", "hello-bar.com",
    "addtoany.com", "sharethis.com", "addthis.com",
    // Consent & CMP
    "cookiebot.com", "onetrust.com", "onetrust.io",
    "consentmanager.net", "cmp.usercentrics.eu",
    "cmpquantcast.com", "quantcast.mgr.consensu.org",
    // Fonts & CDN tracking
    "typekit.com", "fast.fonts.net",
    "fonts.googleapis.com", "fonts.gstatic.com",
    // Cloud & infrastructure with tracking
    "cloudflare.com/cdn-cgi/rum", "cdn.optimizely.com",
    // Extras from the original list
    "analytics.163.com", "mt.analytics.163.com", "crash.163.com",
    "crashlytics.163.com", "iad.g.163.com",
    "ads.1mobile.com", "phads.com", "x1rank.com",
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "googletagservices.com", "googletagmanager.com", "google-analytics.com",
    "adservice.google.com", "pagead2.googlesyndication.com",
    "pubmatic.com", "openx.net", "appnexus.com", "rubiconproject.com",
    "criteo.com", "criteo.net", "casalemedia.com", "contextweb.com",
    "sojern.com", "adnxs.com", "adsrvr.org", "adpushup.com",
    "amazon-adsystem.com", "aax.amazon-adsystem.com",
    "adsafeprotected.com", "moatads.com", "moat.com",
    "scorecardresearch.com", "quantserve.com", "comscore.com",
    "taboola.com", "taboolasyndication.com", "outbrain.com",
    "outbrainimg.com", "sharethrough.com", "undertone.com",
    "adzerk.net", "exponential.com", "tribalfusion.com",
    "adnxs.com", "adsrvr.org"
  ];
}

// ==================== STORAGE HELPERS ====================

function arrayToDict(arr) {
  const dict = {};
  for (const key of arr) {
    dict[`*://*.${key}/*`] = '1';
  }
  return dict;
}

function extractRootWebsite(url) {
  try {
    if (url.substring(0, 4) !== "http") return "failed";
    let root = url.split("://")[1];
    root = root.split("/")[0];
    if (root.includes("www.")) root = root.substring(4);
    const parts = root.split(".");
    if (parts.length < 2) return "failed";
    return parts[parts.length - 2] + "." + parts[parts.length - 1];
  } catch {
    return "failed";
  }
}

function getDomainFromPattern(pattern) {
  const match = pattern.match(/:\/\*\.(.+?)\//);
  return match ? match[1] : null;
}

function patternFromDomain(domain) {
  return `*://*.${domain}/*`;
}

// ==================== POPUP MESSAGING ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getTabInfo':
      getTabInfo().then(sendResponse);
      return true;
      
    case 'addToBlacklist':
      handleAddToBlacklist(message.domain).then(sendResponse);
      return true;
      
    case 'removeFromBlacklist':
      handleRemoveFromBlacklist(message.domain).then(sendResponse);
      return true;
      
    case 'addToAdblockWhitelist':
      handleAddToAdblockWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'removeFromAdblockWhitelist':
      handleRemoveFromAdblockWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'addToCookieWhitelist':
      handleAddToCookieWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'removeFromCookieWhitelist':
      handleRemoveFromCookieWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'addToSpoofWhitelist':
      handleAddToSpoofWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'removeFromSpoofWhitelist':
      handleRemoveFromSpoofWhitelist(message.domain).then(sendResponse);
      return true;
      
    case 'getPaywallStatus':
      getPaywallStatus(message.domain).then(sendResponse);
      return true;
      
    case 'getAdblockStatus':
    getAdblockStatus(message.domain).then(sendResponse);
    return true;

    case 'addToSMWhitelist':
      handleAddToSMWhitelist(message.domain).then(sendResponse);
      return true;

    case 'removeFromSMWhitelist':
      handleRemoveFromSMWhitelist(message.domain).then(sendResponse);
      return true;

    case 'addToBlacklist':
      handleAddToBlacklist(message.domain).then(sendResponse);
      return true;

    case 'removeFromBlacklist':
      handleRemoveFromBlacklist(message.domain).then(sendResponse);
      return true;

    case 'addToAdblockWhitelist':
      handleAddToAdblockWhitelist(message.domain).then(sendResponse);
      return true;

    case 'removeFromAdblockWhitelist':
      handleRemoveFromAdblockWhitelist(message.domain).then(sendResponse);
      return true;

    case 'addToCookieWhitelist':
      handleAddToCookieWhitelist(message.domain).then(sendResponse);
      return true;

    case 'removeFromCookieWhitelist':
      handleRemoveFromCookieWhitelist(message.domain).then(sendResponse);
      return true;

    case 'addToSpoofWhitelist':
      handleAddToSpoofWhitelist(message.domain).then(sendResponse);
      return true;

    case 'removeFromSpoofWhitelist':
      handleRemoveFromSpoofWhitelist(message.domain).then(sendResponse);
      return true;

    case 'getPaywallStatus':
      getPaywallStatus(message.domain).then(sendResponse);
      return true;

    case 'getAdblockStatus':
      getAdblockStatus(message.domain).then(sendResponse);
      return true;
  }
});

// ==================== HANDLERS ====================

async function getTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { root: "failed", url: "unknown" };
    return {
      root: extractRootWebsite(tab.url),
      url: tab.url
    };
  } catch {
    return { root: "failed", url: "unknown" };
  }
}

async function getPaywallStatus(domain) {
  const pattern = patternFromDomain(domain);
  const result = await chrome.storage.sync.get([
    'paywallBlacklistDict', 'paywallCookieWhitelistDict',
    'paywallSpoofWhitelistDict', 'paywallSMWhitelistDict'
  ]);
  
  return {
    inBlacklist: pattern in (result.paywallBlacklistDict || {}),
    inCookieWhitelist: pattern in (result.paywallCookieWhitelistDict || {}),
    inSpoofWhitelist: pattern in (result.paywallSpoofWhitelistDict || {}),
    inSMWhitelist: pattern in (result.paywallSMWhitelistDict || {})
  };
}

async function getAdblockStatus(domain) {
  const result = await chrome.storage.sync.get(['adblockWhitelistDict']);
  return {
    inAdblockWhitelist: domain in (result.adblockWhitelistDict || {})
  };
}

async function handleAddToBlacklist(domain) {
  const result = await chrome.storage.sync.get(['paywallBlacklistDict']);
  const dict = result.paywallBlacklistDict || {};
  const pattern = patternFromDomain(domain);
  dict[pattern] = '1';
  await chrome.storage.sync.set({ paywallBlacklistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleRemoveFromBlacklist(domain) {
  const result = await chrome.storage.sync.get(['paywallBlacklistDict']);
  const dict = result.paywallBlacklistDict || {};
  const pattern = patternFromDomain(domain);
  delete dict[pattern];
  await chrome.storage.sync.set({ paywallBlacklistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleAddToAdblockWhitelist(domain) {
  const result = await chrome.storage.sync.get(['adblockWhitelistDict']);
  const dict = result.adblockWhitelistDict || {};
  dict[domain] = '1';
  await chrome.storage.sync.set({ adblockWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleRemoveFromAdblockWhitelist(domain) {
  const result = await chrome.storage.sync.get(['adblockWhitelistDict']);
  const dict = result.adblockWhitelistDict || {};
  delete dict[domain];
  await chrome.storage.sync.set({ adblockWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleAddToCookieWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallCookieWhitelistDict']);
  const dict = result.paywallCookieWhitelistDict || {};
  dict[patternFromDomain(domain)] = '1';
  await chrome.storage.sync.set({ paywallCookieWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleRemoveFromCookieWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallCookieWhitelistDict']);
  const dict = result.paywallCookieWhitelistDict || {};
  delete dict[patternFromDomain(domain)];
  await chrome.storage.sync.set({ paywallCookieWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleAddToSpoofWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallSpoofWhitelistDict']);
  const dict = result.paywallSpoofWhitelistDict || {};
  dict[patternFromDomain(domain)] = '1';
  await chrome.storage.sync.set({ paywallSpoofWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleRemoveFromSpoofWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallSpoofWhitelistDict']);
  const dict = result.paywallSpoofWhitelistDict || {};
  delete dict[patternFromDomain(domain)];
  await chrome.storage.sync.set({ paywallSpoofWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleAddToSMWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallSMWhitelistDict']);
  const dict = result.paywallSMWhitelistDict || {};
  dict[patternFromDomain(domain)] = '1';
  await chrome.storage.sync.set({ paywallSMWhitelistDict: dict });
  await setupRules();
  return { success: true };
}

async function handleRemoveFromSMWhitelist(domain) {
  const result = await chrome.storage.sync.get(['paywallSMWhitelistDict']);
  const dict = result.paywallSMWhitelistDict || {};
  delete dict[patternFromDomain(domain)];
  await chrome.storage.sync.set({ paywallSMWhitelistDict: dict });
  await setupRules();
  return { success: true };
}
