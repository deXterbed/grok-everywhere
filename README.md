# Grok Everywhere

A powerful Chrome extension that brings xAI's Grok AI assistant directly into your browser for intelligent web browsing assistance.

## 🚀 Quick Start

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn)**

## ✨ Features

- **🤖 AI-Powered Conversations**: Chat with Grok 3 and Grok Vision directly in your browser
- **📄 Page Content Analysis**: Ask questions about any webpage content
- **📸 Screenshot Analysis**: Take screenshots and get AI-powered insights
- **⚡ Quick Actions**: One-click buttons to summarize the page or suggest questions
- **🔄 Real-time Streaming**: See responses being generated in real-time
- **💬 Tab-Specific Conversations**: Each tab maintains its own conversation history
- **🪟 Per-Tab Side Panel**: The panel opens only on the tab you click it on and stays closed on others
- **🎯 Context-Aware**: Automatically extracts and analyzes page content
- **🌐 URL Fetching**: Mention a URL and Grok can read and analyze it
- **🎨 Theme Support**: Dark and light themes for comfortable use
- **⌨️ Keyboard Shortcuts**: Quick access with customizable shortcuts

## 🎯 How It Works

1. **Install the Extension**: Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn)
2. **Set Your API Key**: Enter your xAI API key to get started
3. **Choose Context Mode** (click the chrome icon button to cycle):
   - **No Context** — General conversations with Grok 3
   - **Content Mode** — Analyzes webpage text; Grok can also fetch any URL you mention
   - **Screenshot Mode** — Takes a screenshot for visual analysis using Grok Vision
4. **Ask Questions**: Get intelligent responses based on the current page
5. **Streaming Responses**: Watch as Grok generates responses in real-time

## 🎨 Perfect For

- **Researchers**: Analyze web content and get summaries
- **Students**: Get help understanding complex web pages
- **Professionals**: Quick insights from technical documentation
- **Content Creators**: Analyze and understand web content
- **Anyone**: Get AI assistance while browsing the web

## 🔒 Privacy & Security

- **Local Storage**: Your API key is stored locally in your browser
- **No Server Data**: No data is sent to our servers
- **Tab-Specific**: Conversations are stored per tab and cleared when tabs are closed
- **Direct API**: All communication goes directly to xAI's secure API

## 📋 Requirements

- **xAI API key** (get one at [https://x.ai](https://x.ai))
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

**Note**: This extension requires an xAI API key to function. You can get one by signing up at [https://x.ai](https://x.ai).
