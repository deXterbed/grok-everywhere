# Grok Everywhere

A Chrome extension that puts Grok AI in your browser's side panel. Chat with Grok while browsing, share screenshots, and get instant help with any webpage.

<img width="1552" alt="Screenshot 2025-01-11 at 16 41 11" src="https://github.com/user-attachments/assets/ba1d45a7-49b3-4fc0-a706-17582c72fdc6" />

## Features

- Access Grok directly from your browser's side panel
- **Three context modes**: No context, content-based context, or screenshot context
- **Smart content extraction**: Automatically extracts relevant webpage content
- **Intelligent model selection**: Automatically chooses the best Grok model for each task
- **Keyboard shortcuts**: Quick access to context features
- Works on any webpage

## Context Modes

The extension offers three different ways to provide context to Grok:

### 1. **No Context** (Default)

- Ask questions without any webpage context
- **Uses**: Grok 3 (text-only model)
- Perfect for general questions or when you want Grok's knowledge only

### 2. **Content Context** ⭐ (Recommended)

- Automatically extracts relevant text content from the current webpage
- **Uses**: Grok 3 (text-only model)
- Sends cleaned, relevant content to Grok for better assistance
- More efficient than screenshots and provides better text understanding

### 3. **Screenshot Context**

- Takes a screenshot of the current browser view
- **Uses**: Grok Vision (multimodal model)
- Useful for visual content, layouts, or when you need Grok to see the actual page appearance

## Intelligent Model Selection

The extension automatically selects the optimal Grok model based on your context:

- **Grok 3**: Used for text-only conversations (no context or content context)

  - Faster responses
  - Lower cost
  - Better for text analysis and general questions

- **Grok Vision**: Used when screenshots are involved
  - Can analyze images and visual content
  - Understands layouts, charts, and visual elements
  - Perfect for visual questions and analysis

The model selection is automatic and transparent - you'll see which model is being used in the interface.

## Keyboard Shortcuts

- **`Ctrl+Shift+\` (Windows) / `Cmd+Shift+\` (Mac)**: Toggle the side panel
- **`Ctrl+Shift+C` (Windows) / `Cmd+Shift+C` (Mac)**: Extract page content and prepare for chat
- **`Ctrl+Shift+S` (Windows) / `Cmd+Shift+S` (Mac)**: Take screenshot and prepare for chat

## Installation

Since this extension isn't available in the Chrome Web Store, you'll need to install it manually. Here's how:

1. Download and unzip the extension files to a folder on your computer

2. Open Google Chrome and go to the Extensions page:

   - Click the three dots menu (⋮) in the top-right corner
   - Go to "Extensions"
   - Or type `chrome://extensions/` in the address bar

3. Enable "Developer mode":

   - Look for the "Developer mode" toggle in the top-right corner
   - Turn it ON

4. Load the extension:

   - Click "Load unpacked" button in the top-left
   - Navigate to the folder where you unzipped the extension files
   - Select the `dist` folder
   - Click "Select Folder"

5. The extension is now installed! You should see the Grok icon in your Chrome toolbar.

## How to Use

1. Click the Grok icon in your Chrome toolbar to open the side panel

   - Or use the keyboard shortcut `Ctrl+Shift+\` (Windows) / `Cmd+Shift+\` (Mac) to toggle the side panel

2. Log in with your Grok account credentials

3. **Choose your context mode**:

   - Click the context button (Chrome icon) to cycle through modes
   - **Blue border**: Content context (recommended)
   - **Orange border**: Screenshot context
   - **No border**: No context
   - The info panel shows which model will be used
   - The model badge above the input shows the current model

4. Start chatting with Grok!
   - Ask questions about any webpage you're viewing
   - Use keyboard shortcuts for quick context extraction
   - Get instant help and explanations
   - See which model is being used for each response

## Troubleshooting

If the extension isn't working:

1. Make sure you selected the correct `dist` folder during installation
2. Try disabling and re-enabling the extension
3. Check that you're logged in to your Grok account
4. Verify your API key is correctly set

## Note

This extension requires a valid Grok account to use. If you don't have one, you'll need to sign up at [x.ai](https://x.ai) first.
