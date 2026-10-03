// Background service worker (MV3). Its only job is the keyboard shortcut:
// the toolbar-button click opens the popup directly (handled by the manifest's
// default_popup), so no click listener is needed here.
import { getBaseUrl, buildAddUrl } from './config.js';

const api = globalThis.chrome;

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-tab') return;
  await saveActiveTab();
});

async function saveActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return; // skip chrome:// etc.
  const baseUrl = await getBaseUrl();
  const addUrl = buildAddUrl(baseUrl, { url: tab.url, title: tab.title ?? '' });
  await api.tabs.create({ url: addUrl });
}
