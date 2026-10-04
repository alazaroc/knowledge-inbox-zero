# Knowledge Inbox Zero — browser extension

A tiny toolbar button that sends the **current tab** to your Knowledge Inbox
Zero inbox with one click. Click it (or press the shortcut) and the link lands
pre-filled on the app's **Add content** page, ready to analyze.

- **Manifest V3** — works in Chrome, Brave, Edge, and Firefox (121+).
- **No login, no token.** It opens `…/app/add?url=…&title=…` in a new tab and
  rides your existing logged-in app session. If you're not logged in, the app
  asks you to; then the link is waiting for you.
- **No build step.** Plain HTML/CSS/JS, zero dependencies — load it unpacked as-is.
- **Not required to use the app.** This is an optional convenience; everything
  works from the web app itself.

## How it works

The button opens a new tab at:

```
<baseUrl>/app/add?url=<ENCODED_URL>&title=<ENCODED_TITLE>
```

The app's `AddContentPage` reads those query params, pre-fills the "Add content"
textarea, and clears the params. The extension needs no API credentials because
the browser already carries your app session — the same reason the Settings
bookmarklet works. Nothing is sent anywhere except opening that app URL.

## Install (load unpacked)

### Chrome / Brave / Edge

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `browser-extension/` folder.
4. The icon appears in the toolbar. Pin it for one-click access.

### Firefox (121+)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `browser-extension/manifest.json`.
   (Temporary add-ons are removed when Firefox restarts — that's expected for
   unpacked loading. For a permanent install, publish to AMO.)

## Use

- **Click the toolbar button** → a small popup shows the current tab; press
  **Save this tab**.
- **Keyboard shortcut**: `Ctrl+Shift+S` (`Cmd+Shift+S` on macOS) saves the
  active tab without opening the popup. Rebind it on your browser's shortcuts
  page if it clashes.

Pages that aren't `http(s)` (e.g. `chrome://` internal pages) can't be saved —
the button is disabled for those.

## Point it at a different instance (self-hosters & forks)

The default base URL is `https://inbox.playingaws.com`, but it is **fully
configurable without touching code** so a fork never inherits someone else's
instance:

- **In the popup** → open **Settings**, enter your own app URL (e.g.
  `https://inbox.yourdomain.com`), click **Save URL**. Stored in
  `chrome.storage.sync`. "Reset to default" clears it.
- **In code** (for a published fork): change `DEFAULT_BASE_URL` in
  `src/config.js` — a single line — before packaging.

## Package for the stores

```bash
./package.sh          # or:  make extension-package   (from the repo root)
```

Produces `dist/knowledge-inbox-zero-extension-<version>.zip`, ready to upload to
the Chrome Web Store, Firefox AMO, or Edge Add-ons. **Publishing is up to you** —
this repo does not publish anything.

## Files

```
browser-extension/
├── manifest.json       # MV3 manifest (action popup + background worker + shortcut)
├── src/
│   ├── config.js       # DEFAULT_BASE_URL + storage helpers + add-URL builder
│   ├── background.js    # service worker — handles the keyboard shortcut only
│   ├── popup.html / popup.css / popup.js   # the toolbar popup
├── icons/              # 16/48/128/192/512 (derived from the app's PWA icons)
└── package.sh          # zip the extension for store upload
```
