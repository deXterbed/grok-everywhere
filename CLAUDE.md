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
    api.js                  # xAI API client, streaming, fetch_url + web_search tools
    auth.js                 # Optional SuperGrok device-code OAuth; API key stays the default
    content.js              # Screenshot & page content extraction helpers
    context.js              # Context mode cycling ("none" / "content" / "screenshot")
    markdown.js             # Markdown → HTML renderer (with KaTeX math)
    storage.js              # chrome.storage.local persistence per tab
    ui.js                   # Loading/typing indicator helpers
  styles/                   # CSS files
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
- **Background service worker** is stateless — relays messages, handles tab capture (screenshots), does URL fetching for the `fetch_url` tool and web search requests for the `web_search` tool, and opens the side panel per tab
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

- Chat endpoint (default, no files involved): `https://api.x.ai/v1/chat/completions` — SSE streaming, parsed line by line. Models: user-selected text/vision model IDs (see `TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js`). `grok-4.20-multi-agent-0309` is **Responses-only** — chat completions 400s with "Multi Agent requests are not allowed on chat completions" — so it is no longer offered; a saved pick is migrated by the `removedModel` guard at startup. Every model in `VISION_MODELS` must also be listed in `modelSupportsVision()` in `api.js`, or attached images get dropped for it.
- Files endpoint (any turn with a file attachment, current or historical): `https://api.x.ai/v1/responses` via `modules/responses.js` — see Attachments above. Always uses `FILE_MODEL` ("grok-4.5"), regardless of the user's selected text/vision model.
- File upload endpoint: `https://api.x.ai/v1/files` via `modules/files.js`.
- Web search endpoint (only when enabled in Settings): `https://ollama.com/api/web_search` — called from `background.js` with the user's Ollama API key, returned to the model as `web_search` tool results. See Web Search (Ollama) below.

### SuperGrok OAuth (`modules/auth.js`)

Optional device-code login beside the API key. `authMode` is `api_key` (default) or `oauth`. The access token is sent as `Authorization: Bearer` on the existing `api.x.ai` calls. `getBearerToken()` returns `{ token, oauth }` for the credential it actually handed back.

- **Refresh fallback is auth-failure only.** `isAuthRefreshFailure` is true for `invalid_grant` / `invalid_token` / `invalid_client`, or HTTP 401/403. Only then does a saved `xaiApiKey` replace the session (`authMode: "api_key"`, `xaiOAuth` removed). Network errors, 408, 429, and 5xx throw and leave `authMode` and `xaiOAuth` alone, so Sign out stays available. Do not catch every refresh error and downgrade.
- **One refresh at a time — but only within one panel.** `ensureFreshSession` assigns `refreshInFlight` before its first await, so a file upload and a send in the same side panel share one POST. It is *not* global: the panel is a separate document per tab, so two tabs with panels open each refresh independently, the rotated refresh token makes the loser `invalid_grant`, and the fallback rule below then drops the session. Serialize refresh in the background worker, or re-read storage after an `invalid_grant` and use the rotated pair if it changed, before deleting anything.
- **403 entitlement copy is keyed off `oauth`, not token shape.** `parseHttpError(status, body, fallback, { oauth })` returns `OAUTH_403_MESSAGE` only when the caller says this request used an OAuth access token. An opaque token is still OAuth. An API key that happens to contain two dots is not. Thread the flag from `getBearerToken().oauth` through `fetchStreamingReply`, `uploadFile`, and `fetchFileResponse`. Ollama's `web_search` path does not use `parseHttpError`.
- **Host permissions.** `https://auth.x.ai/*` and `https://accounts.x.ai/*` are covered by `<all_urls>`. `privacy.md` still names those hosts because the extension contacts them. Device-code only — the public client is registered to `127.0.0.1:56121`, which this extension cannot bind.
- **Expiry is assumed, not decoded.** `toSession` uses the token response's `expires_in`, falling back to 3600 s. xAI device-code tokens can be far shorter than that and do not always return `expires_in`, so a stale token can be treated as fresh; there is also no reactive refresh on a 401 from `api.x.ai`, only the pre-flight check. Decoding the access token's `exp` claim (unverified) is the cheap fix.
- **The fallback changes billing silently.** A rejected refresh moves the user onto their saved API key — pay-per-token instead of their subscription — with no user-visible notice (only the Settings label flips). If that ever bites, add a one-line message where `fallBackToApiKey()` is reached.
- **Device-code facts, verified live without an account.** `POST https://auth.x.ai/oauth2/device/code` returns 200 with `verification_uri: https://accounts.x.ai/oauth2/device`, `expires_in: 1800`, `interval: 5`. Polling the token endpoint before approval returns **HTTP 400** `{"error":"authorization_pending"}`, so the pending branch must be read from the body after checking `response.ok`, not inferred from the status. Whether `api.x.ai` accepts a subscription bearer is still unverified here — other projects report a 402/403 tier gate and use the Grok CLI proxy (`cli-chat-proxy.grok.com`) instead.

**`fetch_url` tool gating — don't reuse `supportsVision` for this.** `grok-4.3` is xAI's flagship model and is the *default* for both `textModel` and `visionModel` (`TEXT_MODELS`/`VISION_MODELS` in `sidepanel.js`), so `modelSupportsVision(model)` returns `true` even in a plain-text conversation with zero images attached. `fetchStreamingReply` (`api.js`) previously gated the `fetch_url` tool on `supportsVision`, which silently stripped the tool from every request on the default model — the model would then respond with a canned "I can't browse the web" instead of fetching anything, with no error surfaced anywhere. Tool/URL-fetch availability must be gated on `hasImagesThisTurn` (whether `images` is actually non-empty *this turn*), not on whether the selected model is merely vision-*capable*. `supportsVision` stays correct for the image-content-type decisions (whether to render `image_url` parts) — the bug was specifically conflating "model can do vision" with "this request is a vision request."

Separately: forcing `tool_choice` to a named function (`{ type: "function", function: { name: "fetch_url" } }`) to make the model call fetch_url was tried and **did not reliably work** — the model streamed acknowledgment text ("I'll read that... one moment") without ever emitting a `tool_calls` delta, silently doing nothing. Don't rely on forced `tool_choice` for this; instead `fetchStreamingReply` now deterministically extracts a URL from the user's message client-side (`extractFirstUrl()`) and fetches it via `fetchUrl()` *before* calling the model at all, injecting the content as context. The `fetch_url` tool is still offered (`tool_choice: "auto"`) as a fallback for URLs the model encounters indirectly (e.g. referenced from earlier turns), but the primary "read this URL" case no longer depends on the model choosing to call anything.

**The injected page content is context, not the scope of the answer.** Left to itself, the model treats the extract as a closed corpus and answers "the page/blog doesn't say whether X" instead of searching — e.g. asked whether Ollama is profitable with a blog post attached, it listed the post's funding bullets and stopped. `fetchStreamingReply` therefore states the rule in two places: the system prompt (`contentRule`, built once from `searchOn`) and the injected page-content user message itself, which also notes the extract is **truncated** (see Content Extraction — 8000 chars), so absence there is not evidence. With `searchOn` the rule is "must call `web_search` and answer from results, never substitute 'the page doesn't say' for an answer"; without it, "answer from your own knowledge" instead (there is no search tool to call). `WEB_SEARCH_TOOL`'s description names this case too. When search is off or unconfigured this is prompt-only behavior with no tool fallback — don't expect a search without a key.

### Web Search (Ollama)

Optional `web_search` tool backed by Ollama's hosted web search API (separate provider from xAI; free key at ollama.com/settings/keys, configured in Settings → Web Search).

- **Gating mirrors the `fetch_url` lesson**: the tool is offered only when `webSearchEnabled && ollamaApiKey && !hasImagesThisTurn` — config/turn state, never model capability. The system prompt only mentions `web_search` when it will actually be offered, so the model can't pretend to search.
- **Date injection**: the system prompt always states today's date (client-side `new Date()`). Models hallucinate the date when asked directly instead of calling `web_search` — providing it removes the need to search for that case entirely.
- **Networking rail**: sidepanel (`api.js` `webSearch()`) → `chrome.runtime.sendMessage({action: "webSearch"})` → `background.js` POSTs to `https://ollama.com/api/web_search` with the key passed per-request (the worker stays stateless). No manifest change was needed — `host_permissions` already includes `<all_urls>`, which covers ollama.com.
- **Tool loop**: `fetchStreamingReply` runs a bounded tool loop (`MAX_TOOL_ROUNDS = 4`) — each round either returns the answer or executes the requested tool(s) (`fetch_url` or `web_search`), appends the results, and calls again. This replaced the old fixed two-call flow (whose second call passed `tools: []`), enabling chains like search → fetch a result link. `readStream` accumulates tool calls per stream index, so parallel calls in one response (e.g. two `web_search` calls for a comparison question — this used to concatenate their args into one corrupt JSON blob and crash the turn) are all executed and returned as separate tool results; a malformed single call is reported back as the tool result instead of throwing.
- **Result size**: snippets capped at 1000 chars each / 8000 total (`formatSearchResults`) — Ollama warns search results can be thousands of tokens, and tool input eats the model's reply budget. `scripts/check-websearch.mjs` (`npm test`) asserts the caps. `scripts/check-auth.mjs` asserts the OAuth 403 mapping and refresh classification.
- **Settings**: `ollamaApiKey` (password input; saving empty clears it — together with the toggle, that's the off switch) and `webSearchEnabled` (checkbox) in `chrome.storage.local`.

### Conversation Storage

- Keyed by tab ID: `conversationHistory_{tabId}`
- Images (`msg.images`, from screenshots and/or attachments) are stripped before saving (to save storage) — reload after a tab switch shows text-only history, no thumbnails
- Max ~100 messages per tab, ~50 tabs stored
- Cleaned up when tabs are closed

### Math & Code Rendering

`parseMarkdown()` (`modules/markdown.js`) renders LaTeX through KaTeX and must not turn ordinary text into math:

- **Currency is not math.** Inline math needs delimiters that hug non-space content, can't cross another `$` or a line break, and a closing `$` followed by a digit is rejected. Without those guards `$5–$10` and `between $88 million and $120 million` were captured as math, mangling the answer and making KaTeX log `Unrecognized Unicode character` for en dashes.
- **Code is stashed before math extraction** — fenced blocks, an unclosed fence at end of input, and inline code spans are replaced with placeholders and restored before HTML escaping, so `$x$` inside code stays code instead of being rendered as KaTeX inside `<code>`.
- **Unclosed fences flush at end of input** (`flushCodeBlock()`), so code renders while the reply is still streaming instead of every line after the opening fence disappearing until the closing fence arrives.
- `strict: false` on both `renderToString` calls: model-authored math often contains Unicode that KaTeX only warns about, and the warning is console noise only.

`scripts/check-markdown.mjs` (`npm test`) asserts all of the above by bundling the module with esbuild (it imports `katex`, so it can't be imported as a plain `.js` from an `.mjs` script).

### Markdown Table Rendering

`.message-content th/td` in `sidepanel.css` use `white-space: normal` + `overflow-wrap: anywhere` so long unbroken tokens (e.g. inline code) wrap inside the narrow sidepanel column instead of forcing horizontal scroll.

### User Message Line Breaks

User messages are rendered via `textSpan.textContent = content` in `addMessage()` (`sidepanel.js`), not through the markdown parser, so literal `\n` characters need `white-space: pre-wrap` on `.message-wrapper.user .message-content` (`sidepanel.css`) to display as line breaks — the base `.message-content` rule uses `white-space: normal`, which collapses them.

### Copy Button (assistant messages)

`appendAssistantFooter()` in `sidepanel.js` renders the "Using \<model\>" label and a copy button together under every assistant reply (shared by `addMessage()` and `updateStreamingMessage()` — previously two near-duplicated inline-styled blocks). `createCopyButton()` copies the raw reply string (not rendered HTML/markdown) via `navigator.clipboard.writeText()`. **Always attach a `.catch()` here** — a rejected clipboard write (e.g. focus/permission issues in the side panel context) fails silently with no visible error otherwise, since there's nothing else in the click handler to surface it. On success the button icon swaps to a checkmark for ~1.2s (`.message-copy-button.copied`) — a color/opacity change alone was tried first and was too subtle to register as feedback.

### Input Textarea Auto-Resize

`#message-input` uses native autosizing via `field-sizing: content` (Chrome 123+), guarded by `@supports` in `sidepanel.css`. `autoResizeTextarea()` in `sidepanel.js` bails out when `CSS.supports("field-sizing: content")` — its per-keystroke `height`/`scrollHeight` writes forced synchronous layouts and made fast typing appear in bursts. Don't remove that guard or write an inline height with `field-sizing` active.

### Chat Auto-Scroll

While a reply streams, `updateStreamingContent()` → `scrollToBottomIfNeeded()` follows the bottom only if the user hasn't scrolled up. The gate is `isUserAtBottom` plus a live `isAtBottom()` check, because the cached flag can be a frame stale when a delta lands mid-scroll. The scroll handler treats any decrease in `scrollTop` as a user scroll-up regardless of `isAtBottom()`'s 50px threshold — trackpad scrolls smaller than that otherwise stayed "at bottom" and every streamed chunk yanked the view back — and an upward `wheel` disables follow immediately, even before the content is tall enough to scroll. Reaching the bottom re-enables it; sending a message force-scrolls via `scrollToBottom()`, which also syncs `lastScrollTop` so programmatic scrolls aren't mistaken for user input.

### Send Button Loading State

`showLoading()` (`ui.js`) adds a `.loading` class to the send button on every send — CSS swaps the arrow for a spinner. `hideTypingIndicator()` is the single cleanup point for all loading/typing state on **every** path (success, error, extraction failure): it must reset `disabled` AND remove `.loading` from the send button and message input, otherwise the spinner spins forever after the reply. `hideLoading()` deliberately clears only the input-container overlay — keep cleanup in `hideTypingIndicator`, don't split it again.

While generating, `currentAbortController` is set and the send button becomes a square Stop icon that calls `controller.abort()`; `handleMessageSend`/Enter are ignored in that state. `fetchStreamingReply`/`fetchFileResponse` accept `signal`/`abortSignal`/`abortController`/`controller` (normalized internally) and pass it to `fetch` + the tool loop; `readStream`/`readResponsesStream` cancel the reader on abort and return the partial content, so an aborted turn finalizes the partial reply instead of overwriting it with an error. Don't re-flag abuse.

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

Version lives in **two** files that must be kept in sync: `package.json` and `src/manifest.json`. Bump both, add a dated entry to `CHANGELOG.md` (newest at top), run `npm run build`, commit, then tag `vX.Y.Z`. Keep commit messages short: one-line subject by default, no body unless the why genuinely isn't obvious from the diff. Latest release: 1.9.0 (2026-10-25) — SuperGrok OAuth + Grok 4.7/4.6.

`README.md`'s Features list and "How It Works" steps are user-facing marketing/docs and are **not** covered by anything else in this repo — CHANGELOG.md tracks version history, CLAUDE.md tracks internals, but neither one keeps README in sync automatically. Several feature commits (image/file attachments, the copy button) landed without a README update and it drifted stale until caught by an explicit "make sure README is up to date" ask. When shipping a user-visible feature, check whether README's Features/How It Works/Privacy sections need a matching line, don't wait to be asked.

## Commands

| Script | Description |
|---|---|
| `npm run dev` | Watch mode rebuild |
| `npm run build` | Production build |
| `npm run zip` | Package dist/ for Chrome Web Store |
| `npm run clean` | Delete dist/ |
| `npm test` | Self-checks for web search formatting, markdown/math rendering, and OAuth error mapping |

## Key Dependencies

- **esbuild** (devDependency) — bundler
- **katex** — LaTeX math rendering in chat responses

## Important Constraints

- Content scripts can't use ES modules → all JS bundles are IIFE
- `type="module"` stripped from HTML during build
- `host_permissions` requires `<all_urls>` for content script injection and `https://api.x.ai/*` for API calls
- Content script uses a `window.__grokContentScriptLoaded` guard to prevent duplicate listener registration when injected programmatically