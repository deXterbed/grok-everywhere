# Grok Everywhere — Chrome Extension

A Chrome extension that brings xAI's Grok AI assistant into the browser sidepanel for intelligent web browsing assistance.

## Architecture Overview

```
src/                        # Source files
  manifest.json             # Manifest V3
  background.js             # Service worker (persists no state)
  content.js                # Content script injected into web pages
  sidepanel.html            # Side panel UI shell
  sidepanel.js              # Side panel logic (entry point)
  modules/
    api.js                  # xAI API client, streaming, fetch_url tool
    content.js              # Screenshot & page content extraction helpers
    context.js              # Context mode cycling ("none" / "content" / "screenshot")
    markdown.js             # Markdown → HTML renderer (with KaTeX math)
    storage.js              # chrome.storage.local persistence per tab
    ui.js                   # Loading/typing indicator helpers
  styles/                   # CSS files
    main.css
    conversation.css
    sidepanel.css
    icon.css
    katex.min.css
  icons/
    grok.png
    chrome.png
dist/                       # Build output (gitignored)
scripts/                    # Build utilities
  build.mjs                 # esbuild-based build script
  zip.mjs                   # Chrome Web Store packaging
```

## Key Architecture Details

### Message Flow

```
Sidepanel (sidepanel.js) ←→ Background (background.js) ←→ Content Script (content.js) ←→ Web Page
```

- **Sidepanel** is the main UI — sends messages, renders responses, manages conversation history
- **Background service worker** is stateless — relays messages, handles tab capture (screenshots), and does URL fetching for the `fetch_url` tool
- **Content script** is injected into `<all_urls>` — extracts page text content and captures screenshots on demand

### Context Modes

The sidepanel has 3 context modes, cycled by clicking the context button:

| Mode | Model | Behavior |
|---|---|---|
| `none` | selected text model | No page context sent |
| `content` | selected text model | Extracts page text content and prepends to messages. Has `fetch_url` tool. |
| `screenshot` | selected vision model | Takes a tab screenshot and sends as image |

The actual model is user-selectable in Settings (text model + vision model), not hardcoded per mode. Choices are defined in `TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js` and persisted to `chrome.storage.local` (`textModel`/`visionModel`). `api.js` sends the chosen model ID directly and gates image input via `modelSupportsVision(modelId)`.

### API

- Endpoint: `https://api.x.ai/v1/chat/completions`
- Models: user-selected text/vision model IDs (see `TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js`)
- Streaming: SSE-based streaming, parsed line by line
- Tool support: non-vision (text) requests include a `fetch_url` function tool for reading arbitrary URLs; vision requests send no tools

### Conversation Storage

- Keyed by tab ID: `conversationHistory_{tabId}`
- Screenshots are stripped before saving (to save storage)
- Max ~100 messages per tab, ~50 tabs stored
- Cleaned up when tabs are closed

### Content Extraction (content.js)

1. Clones `document.body`
2. Removes script/style/nav/header/footer/sidebar elements
3. Tries to find main content area via selectors (`main`, `article`, `[role="main"]`, `.content`, etc.)
4. Strips HTML tags, trims whitespace, truncates to 8000 chars
5. Prepends page title + URL metadata

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Shift+C / Cmd+Shift+C | Extract page content and send to Grok |
| Ctrl+Shift+S / Cmd+Shift+S | Take screenshot and send to Grok |

## Development

### Build pipeline (esbuild)

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build → dist/
npm run zip      # Package for Chrome Web Store
npm run clean    # Remove dist/
```

- esbuild bundles all 4 JS files as **IIFE** (Chrome content scripts can't use ES modules)
- Minified in production, sourcemaps in dev
- Target: Chrome 110+
- KaTeX is bundled into sidepanel.js via esbuild

**Always run `npm run build` after making changes** — Chrome loads from `dist/`, not `src/`, so source edits don't take effect until rebuilt. This also surfaces syntax/bundling errors.

### Loading in Chrome

1. Go to `chrome://extensions/`, enable Developer mode
2. "Load unpacked" → select `dist/`

### Adding dependencies

Import npm packages normally in JS files; esbuild bundles them automatically.

## Commands

| Script | Description |
|---|---|
| `npm run dev` | Watch mode rebuild |
| `npm run build` | Production build |
| `npm run zip` | Package dist/ for Chrome Web Store |
| `npm run clean` | Delete dist/ |

## Key Dependencies

- **esbuild** (devDependency) — bundler
- **katex** — LaTeX math rendering in chat responses

## Important Constraints

- Content scripts can't use ES modules → all JS bundles are IIFE
- `type="module"` stripped from HTML during build
- `host_permissions` requires `<all_urls>` for content script injection and `https://api.x.ai/*` for API calls
- Content script uses a `window.__grokContentScriptLoaded` guard to prevent duplicate listener registration when injected programmatically