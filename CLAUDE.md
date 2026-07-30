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
- **Background service worker** is stateless — relays messages, handles tab capture (screenshots), does URL fetching for the `fetch_url` tool, and opens the side panel per tab
- **Content script** is injected into `<all_urls>` — extracts page text content and captures screenshots on demand

### Per-Tab Side Panel

The side panel is opened **per tab**, not globally. Key constraints (learned the hard way):

- **No `side_panel` key in `manifest.json`.** A `side_panel.default_path` registers the panel *globally*, so it appears on every tab — `onActivated`/`enabled:false` toggling cannot reliably override it. Omit the manifest key entirely.
- The panel path is set only per tab in `background.js` on `chrome.action.onClicked`: `setOptions({ tabId, path: "sidepanel.html", enabled: true })` then `open({ tabId })`. With no global default, tabs you never opened it on simply show no panel, and Chrome remembers the per-tab enabled state so it reappears when you return.
- **`setOptions()` and `open()` must run synchronously** in the click handler — no `await` before `open()`, or Chrome rejects it with "`sidePanel.open()` may only be called in response to a user gesture." Use `.catch()` for error handling, not `try/await`.

### Context Modes

The sidepanel has 3 context modes, cycled by clicking the context button:

| Mode | Model | Behavior |
|---|---|---|
| `none` | selected text model | No page context sent |
| `content` | selected text model | Extracts page text content and prepends to messages. Has `fetch_url` tool. |
| `screenshot` | selected vision model | Takes a tab screenshot and sends as image |

The actual model is user-selectable in Settings (text model + vision model), not hardcoded per mode. Choices are defined in `TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js` and persisted to `chrome.storage.local` (`textModel`/`visionModel`). `api.js` sends the chosen model ID directly and gates image input via `modelSupportsVision(modelId)`.

### Attachments (Images & Files)

Independent of context mode, users can attach images and other files to a message via the paperclip button (`#attach-button` → `#attachment-input`, a hidden multi-file `<input type="file">`) or by pasting from the clipboard while focused in `#message-input` (`paste` listener reads `clipboardData.items`, filtered by `item.kind === "file"`). `addAttachedFileOrImage()` routes each file by MIME type.

**Images** (jpg/jpeg, png; ≤20MiB) are read client-side into dataURLs (`pendingAttachments`) and sent inline as base64 via the `image_url` content part — no network call until the message itself is sent. Any non-empty `images` array forces the vision model.

**Other files** (PDF, .txt, .md, .csv, .json, code files; ≤48MB) go through `modules/files.js` (`uploadFile`), which immediately `POST`s a `multipart/form-data` request to `https://api.x.ai/v1/files` (`purpose: "assistants"`, `expires_after: 86400`) and gets back a `file_id`. Staged as `pendingFiles` entries (`{ localId, name, status: uploading|uploaded|error, fileId, error, uploadPromise }`), rendered as chips in `#attachment-preview` showing upload/error state. `handleMessageSend` awaits any in-flight `uploadPromise`s before sending and drops failed uploads back into `pendingFiles` for retry.

**IMPORTANT — files require a different endpoint than everything else in this app.** xAI's `input_file`/attachment support (server-side `attachment_search`) only exists on **`POST /v1/responses`** (`input` array, `input_text`/`input_image`/`input_file`/`output_text` content types, `instructions` field for the system prompt) — it does **not** work on `/v1/chat/completions` (`messages` array, `text`/`image_url` types), which is what every other request in this app uses. Sending `input_file` to chat completions fails with a 400. `modules/responses.js` implements this second path (`fetchFileResponse`, model hardcoded to `FILE_MODEL = "grok-4.5"`, xAI's documented agentic-capable model for files — not user-selectable, mirrors how image attachments force `visionModel`). `sendMessage()` in `sidepanel.js` picks the endpoint per turn: if the current message or **any prior turn in the conversation** has `files`, the whole request (full history, rebuilt as `input`) goes through `fetchFileResponse` instead of `fetchStreamingReply`, since once a file is part of the conversation, replaying that history requires the Responses API's shape. `content` (page-content context mode) is not currently threaded through the file path — mixing "extract this page" context with a file attachment in the same turn is unhandled.

The exact Responses API streaming event schema (`response.output_text.delta` with a `delta` field, `data: [DONE]` termination) is inferred from xAI's docs plus their Responses API being OpenAI-SDK-compatible — it has **not been validated against a live response**, since no API key was available while building this. If files still 400 or stream incorrectly, check the real response body/event shape first before assuming the request-building logic is wrong.

Both attachment kinds flow end-to-end alongside `images`: `sidepanel.js` → `api.js`/`responses.js` → conversation history entries (`msg.images` / `msg.files`). Unlike `images` (large base64, stripped before `chrome.storage.local` persistence — see Conversation Storage below), `files` are just tiny `{ name, fileId }` refs and are persisted as-is, so file references (but not their content) survive a tab switch/reload.

### API

- Chat endpoint (default, no files involved): `https://api.x.ai/v1/chat/completions` — SSE streaming, parsed line by line. Models: user-selected text/vision model IDs (see `TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js`).
- Files endpoint (any turn with a file attachment, current or historical): `https://api.x.ai/v1/responses` via `modules/responses.js` — see Attachments above. Always uses `FILE_MODEL` ("grok-4.5"), regardless of the user's selected text/vision model.
- File upload endpoint: `https://api.x.ai/v1/files` via `modules/files.js`.

**`fetch_url` tool gating — don't reuse `supportsVision` for this.** `grok-4.3` is xAI's flagship model and is the *default* for both `textModel` and `visionModel` (`TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js`), so `modelSupportsVision(model)` returns `true` even in a plain-text conversation with zero images attached. `fetchStreamingReply` (`api.js`) previously gated the `fetch_url` tool on `supportsVision`, which silently stripped the tool from every request on the default model — the model would then respond with a canned "I can't browse the web" instead of fetching anything, with no error surfaced anywhere. Tool/URL-fetch availability must be gated on `hasImagesThisTurn` (whether `images` is actually non-empty *this turn*), not on whether the selected model is merely vision-*capable*. `supportsVision` stays correct for the image-content-type decisions (whether to render `image_url` parts) — the bug was specifically conflating "model can do vision" with "this request is a vision request."

Separately: forcing `tool_choice` to a named function (`{ type: "function", function: { name: "fetch_url" } }`) to make the model call fetch_url was tried and **did not reliably work** — the model streamed acknowledgment text ("I'll read that... one moment") without ever emitting a `tool_calls` delta, silently doing nothing. Don't rely on forced `tool_choice` for this; instead `fetchStreamingReply` now deterministically extracts a URL from the user's message client-side (`extractFirstUrl()`) and fetches it via `fetchUrl()` *before* calling the model at all, injecting the content as context. The `fetch_url` tool is still offered (`tool_choice: "auto"`) as a fallback for URLs the model encounters indirectly (e.g. referenced from earlier turns), but the primary "read this URL" case no longer depends on the model choosing to call anything.

### Conversation Storage

- Keyed by tab ID: `conversationHistory_{tabId}`
- Images (`msg.images`, from screenshots and/or attachments) are stripped before saving (to save storage) — reload after a tab switch shows text-only history, no thumbnails
- Max ~100 messages per tab, ~50 tabs stored
- Cleaned up when tabs are closed

### Markdown Table Rendering

`.message-content th/td` in `sidepanel.css` use `white-space: normal` + `overflow-wrap: anywhere` so long unbroken tokens (e.g. inline code) wrap inside the narrow sidepanel column instead of forcing horizontal scroll.

### User Message Line Breaks

User messages are rendered via `textSpan.textContent = content` in `addMessage()` (`sidepanel.js`), not through the markdown parser, so literal `\n` characters need `white-space: pre-wrap` on `.message-wrapper.user .message-content` (`sidepanel.css`) to display as line breaks — the base `.message-content` rule uses `white-space: normal`, which collapses them.

### Copy Button (assistant messages)

`appendAssistantFooter()` in `sidepanel.js` renders the "Using \<model\>" label and a copy button together under every assistant reply (shared by `addMessage()` and `updateStreamingMessage()` — previously two near-duplicated inline-styled blocks). `createCopyButton()` copies the raw reply string (not rendered HTML/markdown) via `navigator.clipboard.writeText()`. **Always attach a `.catch()` here** — a rejected clipboard write (e.g. focus/permission issues in the side panel context) fails silently with no visible error otherwise, since there's nothing else in the click handler to surface it. On success the button icon swaps to a checkmark for ~1.2s (`.message-copy-button.copied`) — a color/opacity change alone was tried first and was too subtle to register as feedback.

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

### Releasing

Version lives in **two** files that must be kept in sync: `package.json` and `src/manifest.json`. Bump both, add a dated entry to `CHANGELOG.md` (newest at top), run `npm run build`, commit, then tag `vX.Y.Z`.

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