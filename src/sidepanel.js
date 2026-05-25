import { parseMarkdown } from "./modules/markdown.js";
import {
  takeScreenshot,
  extractPageContent,
  checkContentScriptAvailability,
} from "./modules/content.js";
import { createStorage } from "./modules/storage.js";
import { fetchStreamingReply } from "./modules/api.js";
import {
  showLoading,
  hideLoading,
  showContextLoading,
  hideContextLoading,
  showTypingIndicator,
  hideTypingIndicator,
} from "./modules/ui.js";
import { createContext } from "./modules/context.js";

document.addEventListener("DOMContentLoaded", async () => {
  const messageInput = document.getElementById("message-input");
  const chatContainer = document.getElementById("chat-container");
  // Header is always visible; set consistent top offset
  chatContainer.style.marginTop = "50px";
  const apiKeyInput = document.getElementById("api-key-input");
  const saveApiKeyButton = document.getElementById("save-api-key");
  const imageButton = document.querySelector(".image-button");
  const clearHistoryButton = document.getElementById("clear-history-button");
  let apiKey = null;
  let currentScreenshot = null;
  let currentContent = null;
  let contextMode = "content"; // 'none', 'content', 'screenshot'
  let isShortcutMode = false;
  let lastAutoScreenshot = null; // Track auto mode screenshot separately
  let isUserAtBottom = true; // Track if user is at bottom of chat
  let userScrolledUp = false; // Track if user manually scrolled up

  // Function to check if user is at the bottom of the chat
  function isAtBottom() {
    const threshold = 50; // pixels from bottom to consider "at bottom"
    return (
      chatContainer.scrollTop + chatContainer.clientHeight >=
      chatContainer.scrollHeight - threshold
    );
  }

  // Function to scroll to bottom only if user is at bottom
  function scrollToBottomIfNeeded() {
    if (isUserAtBottom && !userScrolledUp) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // Function to force scroll to bottom (for new messages)
  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
    isUserAtBottom = true;
    userScrolledUp = false;
  }

  // Auto-resize textarea to match content, like standard chat UIs
  function autoResizeTextarea() {
    messageInput.style.height = "0";
    const scrollH = messageInput.scrollHeight;
    const newHeight = Math.min(scrollH, 160);
    messageInput.style.height = newHeight + "px";
    messageInput.style.overflowY = scrollH > 160 ? "auto" : "hidden";
  }

  // Show clear-history only when an API key is set and there's conversation history
  function updateClearHistoryVisibility() {
    if (apiKey && chatContainer.querySelector(".message-wrapper")) {
      clearHistoryButton.style.display = "flex";
    } else {
      clearHistoryButton.style.display = "none";
    }
  }

  // Restore the empty state div after clearing the chat container
  function restoreEmptyState() {
    if (!chatContainer.querySelector("#empty-state")) {
      const div = document.createElement("div");
      div.id = "empty-state";
      const emptyTexts = {
        none: "Ask anything",
        content: "Ask about this page",
        screenshot: "Ask about screenshot",
      };
      const text = emptyTexts[contextMode] || "Ask anything";
      div.innerHTML = `<img src="icons/grok.png" alt="Grok"><p>${text}</p>`;
      chatContainer.appendChild(div);
    }
  }

  // Switch header to page-context view and update with current tab info
  function showPageContext() {
    const apiKeySection = document.getElementById("api-key-section");
    const pageContext = document.getElementById("page-context");
    if (apiKeySection) apiKeySection.style.display = "none";
    if (pageContext) pageContext.style.display = "flex";
    document.getElementById("chat-container").style.marginTop = "50px";
    updatePageContext();
  }

  // Switch header to API key entry view
  function showApiKeySection() {
    const apiKeySection = document.getElementById("api-key-section");
    const pageContext = document.getElementById("page-context");
    if (apiKeySection) apiKeySection.style.display = "flex";
    if (pageContext) pageContext.style.display = "none";
    document.getElementById("chat-container").style.marginTop = "50px";
  }

  // Fetch and display current tab title + URL in the header
  async function updatePageContext() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) return;
      const titleEl = document.getElementById("page-title-text");
      const urlEl = document.getElementById("page-url-text");
      const faviconEl = document.getElementById("page-favicon");
      if (titleEl) titleEl.textContent = tab.title || "Untitled page";
      if (urlEl) {
        try {
          const u = new URL(tab.url);
          urlEl.textContent = u.hostname + u.pathname;
        } catch {
          urlEl.textContent = tab.url || "";
        }
      }
      if (faviconEl && tab.favIconUrl) {
        faviconEl.src = tab.favIconUrl;
        faviconEl.onerror = () => {
          faviconEl.src = "icons/grok.png";
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // Add scroll event listener to track user scroll position
  chatContainer.addEventListener("scroll", () => {
    const wasAtBottom = isUserAtBottom;
    isUserAtBottom = isAtBottom();

    // If user scrolled up from bottom, mark as user-initiated scroll
    if (wasAtBottom && !isUserAtBottom) {
      userScrolledUp = true;
    }

    // If user scrolled back to bottom, reset the flag
    if (isUserAtBottom) {
      userScrolledUp = false;
    }
  });

  // Load API key
  const result = await chrome.storage.local.get(["xaiApiKey"]);
  apiKey = result.xaiApiKey;

  if (apiKey) {
    apiKeyInput.value = "API key saved";
    apiKeyInput.classList.add("saved");
    saveApiKeyButton.classList.add("active");
    messageInput.disabled = false;
    showPageContext();
    updateClearHistoryVisibility();
  } else {
    messageInput.disabled = true;
    saveApiKeyButton.style.display = "flex";
    apiKeyInput.style.display = "block";
    showApiKeySection();
    clearHistoryButton.style.display = "none";
  }

  // Handle API key input and save
  apiKeyInput.addEventListener("focus", () => {
    if (apiKey && apiKeyInput.classList.contains("saved")) {
      apiKeyInput.value = apiKey;
    }
  });

  apiKeyInput.addEventListener("blur", () => {
    if (apiKey && apiKeyInput.classList.contains("saved")) {
      apiKeyInput.value = "API key saved";
    }
  });

  apiKeyInput.addEventListener("input", async () => {
    const newValue = apiKeyInput.value.trim();

    // Ignore browser-initiated input events (autofill) when key is already loaded.
    // Only react if the user is actually typing a new key or intentionally clearing.
    if (apiKey && apiKeyInput.classList.contains("saved")) {
      // User is editing a saved key — un-mark as saved but don't delete yet
      apiKeyInput.classList.remove("saved");
      saveApiKeyButton.classList.remove("active");
      // Only delete from storage if user intentionally cleared the field
      if (!newValue) {
        await chrome.storage.local.remove("xaiApiKey");
        apiKey = null;
        clearHistoryButton.style.display = "none";
      }
      messageInput.disabled = !newValue;
      return;
    }

    // No saved key yet — normal input handling
    if (!newValue) {
      await chrome.storage.local.remove("xaiApiKey");
      apiKey = null;
    }

    messageInput.disabled = !newValue;
  });

  saveApiKeyButton.addEventListener("click", async () => {
    if (saveApiKeyButton.classList.contains("active")) {
      // If button is active, clicking it should delete the API key
      showContextLoading("Removing API key...");
      await chrome.storage.local.remove("xaiApiKey");
      apiKey = null;
      apiKeyInput.value = "";
      apiKeyInput.classList.remove("saved");
      saveApiKeyButton.classList.remove("active");
      messageInput.disabled = true;
      showApiKeySection();
      updateClearHistoryVisibility();
      hideContextLoading();
    } else {
      // If button is not active, save the new API key
      const newApiKey = apiKeyInput.value.trim();
      if (newApiKey) {
        showContextLoading("Saving API key...");
        await chrome.storage.local.set({ xaiApiKey: newApiKey });
        apiKey = newApiKey;
        apiKeyInput.value = "API key saved";
        apiKeyInput.classList.add("saved");
        saveApiKeyButton.classList.add("active");
        messageInput.disabled = false;
        showPageContext();
        updateClearHistoryVisibility();
        hideContextLoading();
      }
    }
  });

  // Create context mode management (needs to be before updateContextModeUI call)
  const { updateContextModeUI, cycleContextMode, clearShortcutMode } =
    createContext({
      imageButton,
      messageInput,
      getContextMode: () => contextMode,
      setContextMode: (val) => {
        contextMode = val;
      },
      clearShortcutState: () => {
        isShortcutMode = false;
        currentScreenshot = null;
        currentContent = null;
      },
    });

  // Set initial context mode and update UI
  updateContextModeUI();

  // No port connections needed - extension works independently

  // Initialize current tab ID and load conversation
  async function initializeCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        await switchToTab(tab.id);
      }
    } catch (error) {
      console.error("Error initializing current tab:", error);
    }
  }

  // Switch to a specific tab and load its conversation
  async function switchToTab(tabId) {
    try {
      // Only switch if it's actually a different tab
      if (currentTabId === tabId) {
        return;
      }

      // Save current conversation before switching
      if (currentTabId && conversationHistory.length > 0) {
        await saveConversationHistory();
      }

      // Update current tab ID
      currentTabId = tabId;

      // Load conversation for the new tab
      const result = await chrome.storage.local.get([
        `conversationHistory_${tabId}`,
      ]);

      // Clear current conversation display
      chatContainer.innerHTML = "";
      restoreEmptyState();
      conversationHistory = [];
      // Reset scroll position when switching tabs
      isUserAtBottom = true;
      userScrolledUp = false;

      if (result[`conversationHistory_${tabId}`]) {
        conversationHistory = limitMessageHistory(
          result[`conversationHistory_${tabId}`],
        );
        // Restore the conversation UI
        conversationHistory.forEach((msg) => {
          addMessage(msg.content, msg.isUser, msg.screenshot, msg.model);
        });
      }
      updateClearHistoryVisibility();
      if (apiKey) updatePageContext();

      // Clear any existing context when switching tabs
      currentContent = null;
      currentScreenshot = null;
      isShortcutMode = false;

      // Tab switching completed

      console.log(
        `Switched to tab ${tabId}, loaded ${conversationHistory.length} messages`,
      );
    } catch (error) {
      // Handle cases where tab doesn't exist or other errors
      if (error.message && error.message.includes("No tab with id")) {
        console.log(
          `Tab ${tabId} no longer exists, resetting to current active tab`,
        );
        // Reset to the currently active tab
        try {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (activeTab && activeTab.id !== currentTabId) {
            await switchToTab(activeTab.id);
          }
        } catch (resetError) {
          console.error("Error resetting to active tab:", resetError);
        }
      } else {
        console.error("Error switching to tab:", error);
      }
    }
  }

  // Tab indicator functionality removed - no visual tab names shown

  // Check current tab periodically and switch if needed
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab && tab.id !== currentTabId) {
        await switchToTab(tab.id);
      }
    } catch (error) {
      console.error("Error checking current tab:", error);
    }
  }

  // Initialize on load
  initializeCurrentTab();

  // Check for tab changes every 2 seconds
  setInterval(checkCurrentTab, 2000);

  // Also check when the sidepanel window gains focus (more responsive)
  window.addEventListener("focus", checkCurrentTab);
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkCurrentTab();
    }
  });

  // Keep track of conversation history per tab
  let conversationHistory = [];
  let currentTabId = null;

  // Configuration for chat history management
  const MAX_MESSAGES_PER_TAB = 50;
  const MAX_TABS_TO_STORE = 20;

  const {
    cleanupOldConversations,
    limitMessageHistory,
    saveConversationHistory,
  } = createStorage({
    currentTabId: () => currentTabId,
    conversationHistory: () => conversationHistory,
    MAX_MESSAGES_PER_TAB,
    MAX_TABS_TO_STORE,
  });

  function clearConversation() {
    conversationHistory = [];
    if (currentTabId) {
      chrome.storage.local.remove([`conversationHistory_${currentTabId}`]);
    }
    chatContainer.innerHTML = "";
    restoreEmptyState();
    messageInput.value = "";
    autoResizeTextarea();
    messageInput.focus();
    isUserAtBottom = true;
    userScrolledUp = false;
    updateClearHistoryVisibility();
  }

  // Image button toggle functionality - now cycles through three modes
  imageButton.addEventListener("click", () => {
    cycleContextMode();
  });

  // Function to handle message sending
  async function handleMessageSend() {
    if (!messageInput.value.trim() || !apiKey) {
      return;
    }

    const message = messageInput.value.trim();
    messageInput.value = "";
    autoResizeTextarea();

    let screenshotToSend = null;
    let contentToSend = null;
    let wasShortcutMode = isShortcutMode;

    try {
      // Show initial loading state
      showLoading("Preparing message...");

      if (contextMode === "screenshot") {
        if (isShortcutMode && currentScreenshot) {
          // Shortcut mode: use existing screenshot once
          screenshotToSend = currentScreenshot;
          clearShortcutMode();
        } else {
          // Auto mode: take new screenshot
          showContextLoading("Taking screenshot...");
          screenshotToSend = await takeScreenshot();
          lastAutoScreenshot = screenshotToSend;
        }
      } else if (contextMode === "content") {
        if (isShortcutMode && currentContent) {
          // Shortcut mode: use existing content once
          contentToSend = currentContent;
          clearShortcutMode();
        } else {
          // Auto mode: extract new content
          showContextLoading("Checking page accessibility...");

          // First check if content script is available
          const availability = await checkContentScriptAvailability();
          if (!availability.available) {
            hideLoading();
            hideTypingIndicator(contextMode);
            addMessage(
              `[!] Content extraction not available: ${availability.reason}.`,
              false,
            );
            return;
          }

          showContextLoading("Extracting page content...");
          contentToSend = await extractPageContent();

          // Fallback: if content extraction failed, try again
          if (!contentToSend || contentToSend.length < 50) {
            showContextLoading("Retrying content extraction...");
            contentToSend = await extractPageContent();
          }

          // If content extraction still failed, show error to user
          if (!contentToSend || contentToSend.length < 50) {
            hideLoading();
            hideTypingIndicator(contextMode);
            addMessage(
              "⚠ Content extraction failed. The page might be protected, not fully loaded, or the content script isn't available. Try refreshing the page or using a different context mode.",
              false,
            );
            return;
          }
        }
      } else {
        // No context mode - no content or screenshot
      }

      // Hide loading and show typing indicator
      hideLoading();

      // Determine which model will be used for typing indicator
      const model = screenshotToSend ? "Grok Vision" : "Grok 3";
      showTypingIndicator(model);

      await sendMessage(message, screenshotToSend, contentToSend);
    } catch (error) {
      // If sending fails and we were in shortcut mode, restore the context
      if (wasShortcutMode) {
        if (screenshotToSend) {
          currentScreenshot = screenshotToSend;
          isShortcutMode = true;
        } else if (contentToSend) {
          currentContent = contentToSend;
          isShortcutMode = true;
        }
      }
      hideLoading();
      hideTypingIndicator(contextMode);
      throw error;
    }
  }

  // Handle Enter key press
  messageInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await handleMessageSend();
    }
  });

  // Auto-resize textarea as user types
  messageInput.addEventListener("input", autoResizeTextarea);

  // Handle send button click
  const sendButton = document.querySelector(".send-button");
  sendButton.addEventListener("click", handleMessageSend);

  // Settings button — switch back to API key entry
  const settingsButton = document.getElementById("settings-button");
  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      showApiKeySection();
      document.getElementById("api-key-input").focus();
    });
  }

  // Handle clear history button click
  clearHistoryButton.addEventListener("click", () => {
    // Show confirmation dialog
    if (
      confirm(
        "Are you sure you want to clear the conversation history? This action cannot be undone.",
      )
    ) {
      // Add visual feedback
      clearHistoryButton.style.background = "rgba(255, 107, 107, 0.3)";
      clearHistoryButton.style.opacity = "0.7";

      // Clear the conversation
      clearConversation();

      // Reset button appearance after a short delay
      setTimeout(() => {
        clearHistoryButton.style.background = "";
        clearHistoryButton.style.opacity = "1";
      }, 1000);
    }
  });

  // Listen for context messages (from shortcut)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "addScreenshotContext") {
      if (contextMode === "screenshot") {
        showContextLoading("Processing screenshot...");
        clearShortcutMode();
        currentScreenshot = request.dataUrl;
        isShortcutMode = true;
        setTimeout(() => {
          hideContextLoading();
        }, 1000);
      }
      messageInput.focus();
    }

    if (request.action === "addContentContext") {
      if (contextMode === "content") {
        showContextLoading("Processing page content...");
        clearShortcutMode();
        currentContent = request.content;
        isShortcutMode = true;
        setTimeout(() => {
          hideContextLoading();
        }, 1000);
      }
      messageInput.focus();
    }
  });

  async function sendMessage(message, screenshot, content) {
    // Determine which model will be used based on context mode
    let model;
    if (screenshot) {
      model = "Grok Vision";
    } else {
      model = "Grok 3";
    }

    // Add message to UI first
    addMessage(message, true, screenshot, model);

    // Add to conversation history
    conversationHistory.push({
      content: message,
      isUser: true,
      screenshot: screenshot,
      model: model,
    });

    // Limit message history
    conversationHistory = limitMessageHistory(conversationHistory);

    // Save conversation for current tab
    if (currentTabId) {
      await saveConversationHistory();
      // Clean up old conversations periodically
      cleanupOldConversations();
    }

    try {
      // Create a placeholder message for the streaming response
      const streamingMessageId = Date.now().toString();
      const streamingMessageElement = addStreamingMessage(streamingMessageId);

      // Get streaming reply
      const reply = await fetchStreamingReply({
        message,
        screenshot,
        content,
        streamingMessageId,
        model,
        apiKey,
        conversationHistory,
        onStream: updateStreamingContent,
      });

      // Hide typing indicator
      hideTypingIndicator(contextMode);

      // Add reply to conversation history
      conversationHistory.push({
        content: reply,
        isUser: false,
        model: model,
      });

      // Limit message history
      conversationHistory = limitMessageHistory(conversationHistory);

      // Save conversation for current tab
      if (currentTabId) {
        await saveConversationHistory();
        // Clean up old conversations periodically
        cleanupOldConversations();
      }

      // Update the streaming message with final content
      updateStreamingMessage(streamingMessageId, reply, model);
    } catch (error) {
      // Hide typing indicator on error
      hideTypingIndicator(contextMode);
      throw error;
    }
  }

  function addStreamingMessage(messageId) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.className = "message-wrapper";
    wrapperDiv.id = `streaming-${messageId}`;

    const messageDiv = document.createElement("div");
    messageDiv.className = "message";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Create text content with cursor
    const textSpan = document.createElement("span");
    textSpan.textContent = "";
    contentDiv.appendChild(textSpan);

    // Add streaming cursor
    const cursor = document.createElement("span");
    cursor.className = "streaming-cursor";
    cursor.textContent = "|";
    cursor.style.cssText = `
      animation: blink 1s infinite;
      color: var(--text-primary);
    `;
    contentDiv.appendChild(cursor);

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);

    // Scroll to bottom for new streaming messages
    setTimeout(() => {
      scrollToBottom();
    }, 10);

    return textSpan;
  }

  function updateStreamingMessage(messageId, content, model = null) {
    const wrapperDiv = document.getElementById(`streaming-${messageId}`);
    if (!wrapperDiv) return;

    const contentDiv = wrapperDiv.querySelector(".message-content");
    if (!contentDiv) return;

    // Remove the cursor
    const cursor = contentDiv.querySelector(".streaming-cursor");
    if (cursor) {
      cursor.remove();
    }

    // Update the text content with markdown rendering
    const textSpan = contentDiv.querySelector("span");
    if (textSpan) {
      // For assistant messages, render markdown; for user messages, keep as plain text
      if (model) {
        textSpan.innerHTML = parseMarkdown(content);
      } else {
        textSpan.textContent = content;
      }
    }

    // Add model indicator for assistant messages
    if (model) {
      const modelIndicator = document.createElement("div");
      modelIndicator.style.fontSize = "0.7em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      let modelText = "";
      if (model === "Grok Vision" || model === "grok-2-vision") {
        modelText = "Using Grok Vision (image analysis)";
      } else if (model === "Grok 3" || model === "grok-3-mini") {
        modelText = "Using Grok 3 (text analysis)";
      }

      modelIndicator.textContent = modelText;
      contentDiv.appendChild(modelIndicator);
    }

    // Remove the streaming ID
    wrapperDiv.removeAttribute("id");
  }

  function updateStreamingContent(messageId, content) {
    const wrapperDiv = document.getElementById(`streaming-${messageId}`);
    if (!wrapperDiv) return;

    const textSpan = wrapperDiv.querySelector(".message-content span");
    if (textSpan) {
      // For streaming content, render markdown as it comes in
      textSpan.innerHTML = parseMarkdown(content);
    }

    // Scroll to bottom during streaming only if user is at bottom
    setTimeout(() => {
      scrollToBottomIfNeeded();
    }, 10);
  }

  function addMessage(content, isUser, screenshot = null, model = null) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.className = `message-wrapper${isUser ? " user" : ""}`;

    const messageDiv = document.createElement("div");
    messageDiv.className = "message";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Create text content
    const textSpan = document.createElement("span");
    // For assistant messages, render markdown; for user messages, keep as plain text
    if (!isUser) {
      textSpan.innerHTML = parseMarkdown(content);
    } else {
      textSpan.textContent = content;
    }
    contentDiv.appendChild(textSpan);

    // Add small inline image if screenshot exists
    if (screenshot) {
      const img = document.createElement("img");
      img.src = screenshot;
      img.style.height = "1.2em";
      img.style.width = "auto";
      img.style.verticalAlign = "middle";
      img.style.marginLeft = "0.5em";
      img.style.display = "inline-block";
      img.style.borderRadius = "4px";
      img.style.border = "4px solid #BCDCF5";
      contentDiv.appendChild(img);
    }

    // Add model indicator for assistant messages
    if (!isUser && model) {
      const modelIndicator = document.createElement("div");
      modelIndicator.style.fontSize = "0.7em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      let modelText = "";
      if (model === "Grok Vision" || model === "grok-2-vision") {
        modelText = "Using Grok Vision (image analysis)";
      } else if (model === "Grok 3" || model === "grok-3-mini") {
        modelText = "Using Grok 3 (text analysis)";
      }

      modelIndicator.textContent = modelText;
      contentDiv.appendChild(modelIndicator);
    }

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);
    updateClearHistoryVisibility();

    // Ensure the message is visible
    setTimeout(() => {
      // If this is the first message, scroll to top to make sure it's visible
      if (chatContainer.children.length === 1) {
        chatContainer.scrollTop = 0;
        isUserAtBottom = false;
        userScrolledUp = true;
      } else {
        // Otherwise scroll to bottom for new messages
        scrollToBottom();
      }
    }, 10);
  }
});
