import {
  DEFAULT_BASE_URL,
  getBaseUrl,
  setBaseUrl,
  buildAddUrl,
  normalizeBaseUrl,
} from './config.js';

const api = globalThis.chrome;

const els = {
  tabTitle: document.getElementById('tabTitle'),
  tabUrl: document.getElementById('tabUrl'),
  saveBtn: document.getElementById('saveBtn'),
  status: document.getElementById('status'),
  baseUrl: document.getElementById('baseUrl'),
  saveUrlBtn: document.getElementById('saveUrlBtn'),
  resetUrlBtn: document.getElementById('resetUrlBtn'),
  urlStatus: document.getElementById('urlStatus'),
};

let currentTab = null;

async function init() {
  // Load the active tab and the configured base URL in parallel.
  const [[tab], baseUrl] = await Promise.all([
    api.tabs.query({ active: true, currentWindow: true }),
    getBaseUrl(),
  ]);

  els.baseUrl.value = baseUrl;
  els.baseUrl.placeholder = DEFAULT_BASE_URL;

  currentTab = tab ?? null;
  const savable = Boolean(tab?.url && /^https?:\/\//i.test(tab.url));

  els.tabTitle.textContent = tab?.title || 'Untitled tab';
  els.tabUrl.textContent = tab?.url || '';
  els.saveBtn.disabled = !savable;
  if (!savable) {
    setStatus(els.status, 'This page cannot be saved (not an http/https URL).', 'err');
  }
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}

els.saveBtn.addEventListener('click', async () => {
  if (!currentTab?.url) return;
  const baseUrl = await getBaseUrl();
  const addUrl = buildAddUrl(baseUrl, {
    url: currentTab.url,
    title: currentTab.title ?? '',
  });
  await api.tabs.create({ url: addUrl });
  window.close(); // the new tab now carries the user to the app
});

els.saveUrlBtn.addEventListener('click', async () => {
  const raw = els.baseUrl.value;
  if (raw && !normalizeBaseUrl(raw)) {
    setStatus(els.urlStatus, 'Enter a full http(s):// URL.', 'err');
    return;
  }
  const saved = await setBaseUrl(raw);
  els.baseUrl.value = saved;
  setStatus(els.urlStatus, `Saved. Links will open at ${saved}`, 'ok');
});

els.resetUrlBtn.addEventListener('click', async () => {
  await setBaseUrl('');
  els.baseUrl.value = DEFAULT_BASE_URL;
  setStatus(els.urlStatus, `Reset to default (${DEFAULT_BASE_URL}).`, 'ok');
});

void init();
