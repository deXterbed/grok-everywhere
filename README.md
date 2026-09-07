# Grok Everywhere

A powerful Chrome extension that brings xAI's Grok AI assistant directly into your browser for intelligent web browsing assistance.

## 🚀 Quick Start

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn)**

## ✨ Features

- **🤖 AI-Powered Conversations**: Chat with Grok 4.3 and other selectable Grok text/vision models directly in your browser
- **🔀 Model Selection**: Pick your preferred text and vision model in Settings (Grok 4.3, Grok 4.6, Grok 4.5, Grok 4.20 Reasoning, Grok 4.20 fast, Grok 4.20 Multi-Agent, Grok Build 0.1)
- **📄 Page Content Analysis**: Ask questions about any webpage content
- **📸 Screenshot Analysis**: Take screenshots and get AI-powered insights
- **📎 Image & File Attachments**: Attach images (upload or paste from clipboard) for visual questions, or attach documents (PDF, text, code, CSV, JSON) for Grok to read and answer questions about
- **⚡ Quick Actions**: One-click buttons to summarize the page or suggest questions
- **🔄 Real-time Streaming**: See responses being generated in real-time
- **📋 Copy Responses**: One click to copy any of Grok's replies to your clipboard
- **💬 Tab-Specific Conversations**: Each tab maintains its own conversation history
- **🪟 Per-Tab Side Panel**: The panel opens only on the tab you click it on and stays closed on others
- **🎯 Context-Aware**: Automatically extracts and analyzes page content
- **🌐 URL Fetching**: Mention a URL and Grok can read and analyze it
- **🎨 Theme Support**: Dark and light themes for comfortable use
- **⌨️ Keyboard Shortcuts**: Quick access with customizable shortcuts
- **🔐 SuperGrok Sign-in (optional)**: Device-code login with your xAI / SuperGrok account as an alternative to an API key. The OAuth bearer is sent to `api.x.ai`. Login can succeed and chat can still 403 if the account is not entitled for that API surface — then use an API key. API-key auth stays the default and fallback.

## 🎯 How It Works

1. **Install the Extension**: Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn)
2. **Sign in**: Enter an xAI API key (default), or click **SuperGrok** to sign in with your xAI account via device-code. SuperGrok login can succeed and inference can still 403 on `api.x.ai` if the account is not entitled for that API surface — that error is shown once, with no retry. Use an API key in that case.
3. **Choose Context Mode** (click the chrome icon button to cycle):
   - **No Context** — General conversations with your selected text model
   - **Content Mode** — Analyzes webpage text; Grok can also fetch any URL you mention
   - **Screenshot Mode** — Takes a screenshot for visual analysis using your selected vision model
4. **Ask Questions**: Get intelligent responses based on the current page
5. **Attach Images or Files** (optional): Click the paperclip icon or paste from your clipboard to attach images or documents to your message — independent of context mode
6. **Streaming Responses**: Watch as Grok generates responses in real-time, and copy any reply with one click

## 🎨 Perfect For

- **Researchers**: Analyze web content and get summaries
- **Students**: Get help understanding complex web pages
- **Professionals**: Quick insights from technical documentation
- **Content Creators**: Analyze and understand web content
- **Anyone**: Get AI assistance while browsing the web

## 🔒 Privacy & Security

- **Local Storage**: Your API key and SuperGrok OAuth tokens (if you sign in) are stored locally in your browser
- **No Server Data**: No data is sent to our servers
- **Tab-Specific**: Conversations are stored per tab and cleared when tabs are closed
- **Direct API**: Chat goes directly to xAI's API at `api.x.ai`. SuperGrok sign-in talks to `auth.x.ai` / `accounts.x.ai` only for the device-code login.
- **File Attachments**: Non-image files (PDF, text, code, etc.) are uploaded directly to xAI's Files API so Grok can read them, and automatically expire from xAI's servers after 24 hours

## 📋 Requirements

- **xAI API key** (get one at [https://x.ai](https://x.ai)). SuperGrok OAuth is optional and does not replace an API key for every account or tier — if `api.x.ai` returns 403 after login, use an API key.
- **Chrome browser**
- **Internet connection**

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+C** (Mac: **Cmd+Shift+C**) | Extract page content and send to Grok |
| **Ctrl+Shift+S** (Mac: **Cmd+Shift+S**) | Take screenshot and send to Grok |

## 🛠️ Development

### Prerequisites

- Node.js 18+
- Chrome browser

### Setup

```bash
git clone https://github.com/deXterbed/grok-everywhere.git
cd grok-everywhere
npm install
```

### Build Commands

| Command | Description |
|---|---|
| `npm run dev` | Watch mode — rebuilds on file changes |
| `npm run build` | Production build → `dist/` |
| `npm run zip` | Package `dist/` for Chrome Web Store |
| `npm run clean` | Delete the `dist/` directory |

### Architecture

The extension has three main parts:
- **Sidepanel** (`sidepanel.js`) — the chat UI you interact with
- **Background worker** (`background.js`) — relays messages, captures screenshots, fetches URLs, opens the side panel per tab
- **Content script** (`content.js`) — injected into web pages to extract text content

Messages flow: `Sidepanel ↔ Background ↔ Content Script ↔ Web Page`

### Loading in Chrome

1. Go to `chrome://extensions/` and enable Developer mode
2. Click "Load unpacked" and select the `dist/` folder
3. After code changes, click the refresh button on the extension card

### Adding Dependencies

Import npm packages normally in JS files. The esbuild bundler includes them automatically.

## 📦 Chrome Web Store

**[Install Grok Everywhere](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn)**

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, feature requests, or bug reports:

- Open an issue on GitHub
- Check the [Chrome Web Store listing](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn) for updates

---

**Note**: This extension uses an xAI API key by default. You can get one at [https://x.ai](https://x.ai). SuperGrok OAuth is optional (public Grok CLI client; device-code against `auth.x.ai` / `accounts.x.ai`). The OAuth bearer is sent to `api.x.ai`. Login can succeed and inference can still 403 if the account is not entitled for that API surface — use an API key; there is no retry loop.
