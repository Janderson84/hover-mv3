// ===== Hover MV3 Popup =====
// Uses chrome.runtime.sendMessage to communicate with the service worker.
// No chrome.extension.getBackgroundPage() calls — that's MV2 only.

let currentRoot = null;
let currentData = {};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab info
  const tabInfo = await sendMessage({ action: 'getTabInfo' });
  currentRoot = tabInfo.root;
  
  if (currentRoot === 'failed') {
    showError('Unable to determine current site');
    return;
  }
  
  // Load both paywall and adblock status
  const [paywallStatus, adblockStatus] = await Promise.all([
    sendMessage({ action: 'getPaywallStatus', domain: currentRoot }),
    sendMessage({ action: 'getAdblockStatus', domain: currentRoot })
  ]);
  
  currentData = { ...paywallStatus, ...adblockStatus };
  
  render();
  setupListeners();
});

function showError(msg) {
  document.getElementById('paywallStatusText').textContent = msg;
  const advBtns = document.querySelectorAll('#cAdvanced .btn');
  advBtns.forEach(b => b.disabled = true);
}

// ===== MESSAGING =====
async function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response || {});
    });
  });
}

// ===== RENDER =====
function render() {
  // Paywall section
  const inBlacklist = currentData.inBlacklist || false;
  const paywallSwitch = document.getElementById('paywallSwitch');
  const paywallLabel = document.getElementById('paywallLabel');
  const paywallStatusText = document.getElementById('paywallStatusText');
  
  paywallSwitch.checked = inBlacklist;
  paywallLabel.textContent = inBlacklist ? 'On' : 'Off';
  paywallStatusText.textContent = inBlacklist
    ? `${currentRoot} — paywall bypass is active`
    : `${currentRoot} — not a paywall site or bypass off`;
  
  // Adblock section
  const inAdblockWhitelist = currentData.inAdblockWhitelist || false;
  const adblockSwitch = document.getElementById('adblockSwitch');
  const adblockLabel = document.getElementById('adblockLabel');
  const adblockStatusText = document.getElementById('adblockStatusText');
  
  adblockSwitch.checked = !inAdblockWhitelist;
  adblockLabel.textContent = !inAdblockWhitelist ? 'On' : 'Off';
  adblockStatusText.textContent = !inAdblockWhitelist
    ? 'Ads are being blocked on this site'
    : 'Ads are allowed on this site';
  
  // Advanced buttons
  const inSMWhitelist = currentData.inSMWhitelist || false;
  const inSpoofWhitelist = currentData.inSpoofWhitelist || false;
  const inCookieWhitelist = currentData.inCookieWhitelist || false;
  
  document.getElementById('btnSMWhitelist').textContent = inSMWhitelist
    ? 'Unchange Referrer Header' : 'Change Referrer Header';
  document.getElementById('btnSMWhitelist').className = inSMWhitelist
    ? 'btn btn-warning btn-sm btn-block mb-2' : 'btn btn-outline-info btn-sm btn-block mb-2';
  document.getElementById('btnSMWhitelist').disabled = !inBlacklist;
  
  document.getElementById('btnSpoofWhitelist').textContent = inSpoofWhitelist
    ? 'Unspoof Site as Crawler' : 'Spoof Site as Crawler';
  document.getElementById('btnSpoofWhitelist').className = inSpoofWhitelist
    ? 'btn btn-warning btn-sm btn-block mb-2' : 'btn btn-outline-info btn-sm btn-block mb-2';
  document.getElementById('btnSpoofWhitelist').disabled = !inBlacklist;
  
  document.getElementById('btnCookieWhitelist').textContent = inCookieWhitelist
    ? 'Unblock Cookies' : 'Block Cookies';
  document.getElementById('btnCookieWhitelist').className = inCookieWhitelist
    ? 'btn btn-warning btn-sm btn-block mb-2' : 'btn btn-outline-info btn-sm btn-block mb-2';
  document.getElementById('btnCookieWhitelist').disabled = !inBlacklist;
}

// ===== LISTENERS =====
function setupListeners() {
  // Paywall toggle
  document.getElementById('paywallSwitch').addEventListener('change', async (e) => {
    const enable = e.target.checked;
    const action = enable ? 'addToBlacklist' : 'removeFromBlacklist';
    await sendMessage({ action, domain: currentRoot });
    
    // Reload tab and close popup
    chrome.tabs.reload();
    window.close();
  });
  
  // Adblock toggle
  document.getElementById('adblockSwitch').addEventListener('change', async (e) => {
    const disable = !e.target.checked;
    const action = disable ? 'addToAdblockWhitelist' : 'removeFromAdblockWhitelist';
    await sendMessage({ action, domain: currentRoot });
    
    chrome.tabs.reload();
    window.close();
  });
  
  // Advanced buttons
  document.getElementById('btnSMWhitelist').addEventListener('click', async () => {
    const isInWhitelist = currentData.inSMWhitelist || false;
    const action = isInWhitelist ? 'removeFromSMWhitelist' : 'addToSMWhitelist';
    await sendMessage({ action, domain: currentRoot });
    
    // Update state and re-render
    const status = await sendMessage({ action: 'getPaywallStatus', domain: currentRoot });
    Object.assign(currentData, status);
    render();
    chrome.tabs.reload();
  });
  
  document.getElementById('btnSpoofWhitelist').addEventListener('click', async () => {
    const isInWhitelist = currentData.inSpoofWhitelist || false;
    const action = isInWhitelist ? 'removeFromSpoofWhitelist' : 'addToSpoofWhitelist';
    await sendMessage({ action, domain: currentRoot });
    
    const status = await sendMessage({ action: 'getPaywallStatus', domain: currentRoot });
    Object.assign(currentData, status);
    render();
    chrome.tabs.reload();
  });
  
  document.getElementById('btnCookieWhitelist').addEventListener('click', async () => {
    const isInWhitelist = currentData.inCookieWhitelist || false;
    const action = isInWhitelist ? 'removeFromCookieWhitelist' : 'addToCookieWhitelist';
    await sendMessage({ action, domain: currentRoot });
    
    const status = await sendMessage({ action: 'getPaywallStatus', domain: currentRoot });
    Object.assign(currentData, status);
    render();
    chrome.tabs.reload();
  });
  
  // Report bug
  document.getElementById('btnReportBug').addEventListener('click', () => {
    chrome.tabs.create({
      url: 'https://github.com/nang-dev/hover-paywalls-browser-extension/issues/new',
      active: true
    });
  });
}
