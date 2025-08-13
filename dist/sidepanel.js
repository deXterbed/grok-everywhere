document.addEventListener("DOMContentLoaded", async () => {
  const messageInput = document.getElementById("message-input");
  const chatContainer = document.getElementById("chat-container");
  const apiKeyInput = document.getElementById("api-key-input");
  const saveApiKeyButton = document.getElementById("save-api-key");
  const imageButton = document.querySelector(".image-button");
  let apiKey = null;
  let currentScreenshot = null;
  let currentContent = null;
  let contextMode = "content"; // 'none', 'content', 'screenshot'
  let isShortcutMode = false;
  let lastAutoScreenshot = null; // Track auto mode screenshot separately
  let port = null; // Store port at module level

  // Load API key
  const result = await chrome.storage.local.get(["xaiApiKey"]);
  apiKey = result.xaiApiKey;

  if (apiKey) {
    showContextLoading("Validating API key...");
    apiKeyInput.value = "API key saved";
    apiKeyInput.classList.add("saved");
    saveApiKeyButton.classList.add("active");
    messageInput.disabled = false;
    // Hide the API key input and save button, but keep the close button visible
    apiKeyInput.style.display = "none";
    saveApiKeyButton.style.display = "none";
    // Adjust chat container margin since API section is hidden
    document.getElementById("chat-container").style.marginTop = "0px";
    setTimeout(() => {
      hideContextLoading();
    }, 300);
  } else {
    messageInput.disabled = true;
    // Ensure save button is visible when no API key is set
    saveApiKeyButton.style.display = "flex";
    apiKeyInput.style.display = "block";
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

    if (apiKeyInput.classList.contains("saved")) {
      apiKeyInput.classList.remove("saved");
      saveApiKeyButton.classList.remove("active");
    }

    // If the input is empty, remove the API key from storage
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
      // Show the API key input and save button again
      apiKeyInput.style.display = "block";
      saveApiKeyButton.style.display = "flex";
      // Adjust chat container margin back
      document.getElementById("chat-container").style.marginTop = "64px";
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
        // Hide the API key input and save button, but keep the close button visible
        apiKeyInput.style.display = "none";
        saveApiKeyButton.style.display = "none";
        // Adjust chat container margin since API section is hidden
        document.getElementById("chat-container").style.marginTop = "0px";
        hideContextLoading();
      }
    }
  });

  // Set initial context mode and update UI
  updateContextModeUI();

  // Enhanced loading and typing indicator functions
  function showLoading(message = "Processing...") {
    const inputContainer = document.getElementById("input-container");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    console.log("Showing loading state:", message);

    if (inputContainer) {
      inputContainer.classList.add("loading");
    }

    if (sendButton) {
      sendButton.classList.add("loading");
      sendButton.disabled = true;
    }

    if (messageInput) {
      messageInput.disabled = true;
    }

    // Show context loading indicator if needed
    showContextLoading(message);
  }

  function hideLoading() {
    const inputContainer = document.getElementById("input-container");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    console.log("Hiding loading state");

    if (inputContainer) {
      inputContainer.classList.remove("loading");
    }

    if (sendButton) {
      sendButton.classList.remove("loading");
      sendButton.disabled = false;
    }

    // Re-enable input and send button
    if (messageInput) {
      messageInput.disabled = false;
      messageInput.focus();
    }

    // Hide context loading indicator
    hideContextLoading();
  }

  function showContextLoading(message) {
    const inputContainer = document.getElementById("input-container");
    const modelBadge = document.getElementById("model-badge");

    // Remove any existing context loading indicator first
    hideContextLoading();

    // Create new context loading indicator
    const contextLoading = document.createElement("div");
    contextLoading.className = "context-loading";
    contextLoading.textContent = message;

    // Insert before the model badge
    if (modelBadge && modelBadge.parentNode) {
      inputContainer.insertBefore(contextLoading, modelBadge);
    } else {
      inputContainer.appendChild(contextLoading);
    }

    console.log("Showing context loading:", message);
  }

  function hideContextLoading() {
    const contextLoading = document.querySelector(".context-loading");
    if (contextLoading) {
      contextLoading.remove();
      console.log("Hiding context loading");
    }
  }

  function showTypingIndicator(model) {
    const modelBadge = document.getElementById("model-badge");
    const currentModelDisplay = document.getElementById(
      "current-model-display"
    );
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    // Update the model badge to show thinking status
    if (currentModelDisplay) {
      currentModelDisplay.textContent = `${model} is thinking...`;
    }

    // Add thinking animation to the model badge
    if (modelBadge) {
      modelBadge.style.animation = "typingPulse 2s ease-in-out infinite";
      modelBadge.style.background = "rgba(64, 128, 64, 0.8)"; // Green background to indicate active thinking
      // Ensure the badge stays within the input container bounds
      modelBadge.style.position = "relative";
      modelBadge.style.zIndex = "1001";
    }

    // Disable input and send button while typing indicator is shown
    if (messageInput) {
      messageInput.disabled = true;
      messageInput.classList.add("loading");
    }

    if (sendButton) {
      sendButton.disabled = true;
    }
  }

  function hideTypingIndicator() {
    const modelBadge = document.getElementById("model-badge");
    const currentModelDisplay = document.getElementById(
      "current-model-display"
    );
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    // Restore the original model display
    if (currentModelDisplay) {
      // Determine which model to show based on current context mode
      let modelText = "Grok 3";
      if (contextMode === "screenshot") {
        modelText = "Grok Vision";
      }
      currentModelDisplay.textContent = modelText;
    }

    // Remove thinking animation from the model badge
    if (modelBadge) {
      modelBadge.style.animation = "";
      modelBadge.style.background = "rgba(64, 64, 64, 0.8)"; // Restore original background
    }

    // Re-enable input and send button when typing indicator is hidden
    if (messageInput) {
      messageInput.disabled = false;
      messageInput.classList.remove("loading");
      messageInput.focus();
    }

    if (sendButton) {
      sendButton.disabled = false;
    }
  }

  // Connect to the background script and handle reconnection
  function connectToBackground() {
    if (port) {
      try {
        port.disconnect();
      } catch (e) {
        console.error("Error disconnecting port:", e);
      }
    }

    showContextLoading("Connecting...");
    port = chrome.runtime.connect({ name: "sidepanel" });

    port.onMessage.addListener((message) => {
      if (message.action === "clearConversation") {
        clearConversation();
      }

      if (message.action === "tabSwitched") {
        handleTabSwitch(message);
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      showContextLoading("Reconnecting...");
      setTimeout(connectToBackground, 1000);
    });

    // Hide loading after successful connection
    setTimeout(() => {
      hideContextLoading();
    }, 500);
  }

  // Initial connection
  connectToBackground();

  // Initialize current tab ID and load conversation
  async function initializeCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        currentTabId = tab.id;
        // Load conversation for current tab
        const result = await chrome.storage.local.get([
          `conversationHistory_${tab.id}`,
        ]);
        if (result[`conversationHistory_${tab.id}`]) {
          conversationHistory = result[`conversationHistory_${tab.id}`];
          // Restore the conversation UI
          conversationHistory.forEach((msg) => {
            addMessage(msg.content, msg.isUser, msg.screenshot, msg.model);
          });
        }
      }
    } catch (error) {
      console.error("Error initializing current tab:", error);
    }
  }

  // Initialize on load
  initializeCurrentTab();

  // Keep track of conversation history per tab
  let conversationHistory = [];
  let currentTabId = null;

  function clearConversation() {
    showContextLoading("Clearing conversation...");
    conversationHistory = [];
    // Clear conversation for current tab
    if (currentTabId) {
      chrome.storage.local.remove([`conversationHistory_${currentTabId}`]);
    }
    chatContainer.innerHTML = "";
    messageInput.value = "";
    messageInput.focus();
    setTimeout(() => {
      hideContextLoading();
    }, 500); // Brief delay to show the loading state
  }

  function handleTabSwitch(message) {
    showContextLoading("Switching to new tab...");

    // Save current conversation for the previous tab
    if (currentTabId && conversationHistory.length > 0) {
      chrome.storage.local.set({
        [`conversationHistory_${currentTabId}`]: conversationHistory,
      });
    }

    // Get the new tab ID from the message
    const newTabId = message.tabId || Date.now().toString(); // Fallback if no tabId provided
    currentTabId = newTabId;

    // Load conversation for the new tab
    chrome.storage.local.get([`conversationHistory_${newTabId}`], (result) => {
      if (result[`conversationHistory_${newTabId}`]) {
        conversationHistory = result[`conversationHistory_${newTabId}`];
        // Restore the conversation UI
        chatContainer.innerHTML = "";
        conversationHistory.forEach((msg) => {
          addMessage(msg.content, msg.isUser, msg.screenshot, msg.model);
        });
      } else {
        // No previous conversation for this tab, start fresh
        conversationHistory = [];
        chatContainer.innerHTML = "";
      }
    });

    // Update current content based on the new tab
    if (message.available && message.content) {
      currentContent = message.content;
      // If we're in content mode, enable shortcut mode with the new content
      if (contextMode === "content") {
        isShortcutMode = true;
        showContextLoading("New page content loaded");
      }
    } else {
      currentContent = null;
      isShortcutMode = false;
      showContextLoading("Content not available on this page");
    }

    // Update the UI to reflect the new tab
    updateContextModeUI();

    // Hide loading after a brief delay
    setTimeout(() => {
      hideContextLoading();
    }, 1000);
  }

  async function takeScreenshot() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "captureTab" }, resolve);
      });
      return response?.dataUrl || null;
    } catch (error) {
      console.error("Failed to take screenshot:", error);
      return null;
    }
  }

  async function extractPageContent() {
    try {
      const response = await Promise.race([
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "extractContent" },
            (response) => {
              // Handle cases where response might be undefined
              if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                resolve({
                  content: null,
                  error: chrome.runtime.lastError.message,
                });
              } else {
                resolve(
                  response || { content: null, error: "No response received" }
                );
              }
            }
          );
        }),
        new Promise((resolve) => {
          // Timeout after 5 seconds
          setTimeout(() => {
            resolve({ content: null, error: "Content extraction timeout" });
          }, 5000);
        }),
      ]);

      if (response && response.content) {
        console.log(
          "Content extracted successfully:",
          response.content.substring(0, 200) + "..."
        );
        return response.content;
      } else {
        console.error("No content extracted:", response);
        // Provide more specific error message
        const errorMsg = response?.error || "Unknown extraction error";
        console.error("Content extraction failed:", errorMsg);

        // Check for specific error types
        if (errorMsg.includes("Receiving end does not exist")) {
          console.error("Content script not available on this page");
          return null;
        }

        return null;
      }
    } catch (error) {
      console.error("Failed to extract content:", error);
      return null;
    }
  }

  async function checkContentScriptAvailability() {
    try {
      // Try to get the current tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) {
        return { available: false, reason: "No active tab found" };
      }

      // Check if content script can be injected on this page
      const url = new URL(tab.url);

      // Chrome extensions, chrome://, chrome-extension://, and some other schemes don't allow content scripts
      if (
        url.protocol === "chrome:" ||
        url.protocol === "chrome-extension:" ||
        url.protocol === "moz-extension:" ||
        url.protocol === "edge:" ||
        url.protocol === "about:" ||
        url.protocol === "data:" ||
        url.protocol === "view-source:"
      ) {
        return {
          available: false,
          reason: `Content scripts not allowed on ${url.protocol} pages`,
        };
      }

      // Check if the page is accessible
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "ping" });
        return { available: true };
      } catch (error) {
        return {
          available: false,
          reason: "Content script not loaded on this page",
        };
      }
    } catch (error) {
      return { available: false, reason: error.message };
    }
  }

  function updateContextModeUI() {
    // Remove all active classes first
    imageButton.classList.remove("active", "content-mode", "screenshot-mode");

    // Get info panel elements - handle case where they might not exist
    const currentModelDisplay = document.getElementById(
      "current-model-display"
    );

    // Remove existing refresh button if it exists
    const existingRefreshButton = document.querySelector(".refresh-button");
    if (existingRefreshButton) {
      existingRefreshButton.remove();
    }

    // Add appropriate class and update placeholder
    switch (contextMode) {
      case "none":
        messageInput.placeholder = "Ask anything";
        if (currentModelDisplay) {
          currentModelDisplay.textContent = "Grok 3";
        }
        break;
      case "content":
        imageButton.classList.add("active", "content-mode");
        messageInput.placeholder = "Ask anything with page content";
        if (currentModelDisplay) {
          currentModelDisplay.textContent = "Grok 3";
        }
        break;
      case "screenshot":
        imageButton.classList.add("active", "screenshot-mode");
        messageInput.placeholder = "Ask anything with screenshot";
        if (currentModelDisplay) {
          currentModelDisplay.textContent = "Grok Vision";
        }
        break;
    }

    // Check content script availability and show warning if needed
    checkContentScriptAvailability().then((availability) => {
      if (contextMode === "content" && !availability.available) {
        // Show a subtle warning in the model badge
        if (currentModelDisplay) {
          currentModelDisplay.textContent = "Grok 3 (Content unavailable)";
          currentModelDisplay.style.color = "#ff6b6b";
        }

        // Add refresh button
        addRefreshButton();
      } else if (currentModelDisplay) {
        currentModelDisplay.style.color = "";
      }
    });
  }

  function addRefreshButton() {
    const modelBadge = document.getElementById("model-badge");
    if (!modelBadge) return;

    // Create refresh button
    const refreshButton = document.createElement("button");
    refreshButton.className = "refresh-button";
    refreshButton.textContent = "Refresh Page";
    refreshButton.style.cssText = `
      margin-left: 8px;
      padding: 4px 8px;
      background: #ff6b6b;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      transition: background-color 0.2s ease;
    `;

    // Add hover effect
    refreshButton.addEventListener("mouseenter", () => {
      refreshButton.style.background = "#ff5252";
    });
    refreshButton.addEventListener("mouseleave", () => {
      refreshButton.style.background = "#ff6b6b";
    });

    // Add click handler
    refreshButton.addEventListener("click", async () => {
      try {
        showContextLoading("Refreshing page...");

        // Get current active tab
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab) {
          // Reload the current tab
          await chrome.tabs.reload(tab.id);

          // Wait a bit for the page to load, then check content availability again
          setTimeout(async () => {
            const availability = await checkContentScriptAvailability();
            if (availability.available) {
              showContextLoading("Content now available");
              setTimeout(() => {
                hideContextLoading();
                updateContextModeUI();
              }, 1000);
            } else {
              showContextLoading("Content still unavailable");
              setTimeout(() => {
                hideContextLoading();
              }, 1000);
            }
          }, 2000);
        }
      } catch (error) {
        console.error("Error refreshing page:", error);
        hideContextLoading();
      }
    });

    // Insert the refresh button after the model badge
    modelBadge.parentNode.insertBefore(refreshButton, modelBadge.nextSibling);
  }

  function cycleContextMode() {
    const modes = ["none", "content", "screenshot"];
    const currentIndex = modes.indexOf(contextMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    contextMode = modes[nextIndex];
    updateContextModeUI();
  }

  function clearShortcutMode() {
    isShortcutMode = false;
    currentScreenshot = null;
    currentContent = null;
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
            hideTypingIndicator();
            addMessage(
              `⚠️ Content extraction not available: ${availability.reason}. Try using a different context mode or navigate to a regular webpage.`,
              false
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
            hideTypingIndicator();
            addMessage(
              "⚠️ Content extraction failed. The page might be protected, not fully loaded, or the content script isn't available. Try refreshing the page or using a different context mode.",
              false
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
      hideTypingIndicator();
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

  // Handle send button click
  const sendButton = document.querySelector(".send-button");
  sendButton.addEventListener("click", handleMessageSend);

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
    // Determine which model will be used
    const model = screenshot ? "grok-2-vision" : "grok-3";

    // Add message to UI first
    addMessage(message, true, screenshot, model);

    // Add to conversation history
    conversationHistory.push({
      content: message,
      isUser: true,
      screenshot: screenshot,
      model: model,
    });

    // Save conversation for current tab
    if (currentTabId) {
      await chrome.storage.local.set({
        [`conversationHistory_${currentTabId}`]: conversationHistory,
      });
    }

    try {
      // Create a placeholder message for the streaming response
      const streamingMessageId = Date.now().toString();
      const streamingMessageElement = addStreamingMessage(streamingMessageId);

      // Get streaming reply
      const reply = await fetchStreamingReply(
        message,
        screenshot,
        content,
        streamingMessageId
      );

      // Hide typing indicator
      hideTypingIndicator();

      // Add reply to conversation history
      conversationHistory.push({
        content: reply,
        isUser: false,
        model: model,
      });

      // Save conversation for current tab
      if (currentTabId) {
        await chrome.storage.local.set({
          [`conversationHistory_${currentTabId}`]: conversationHistory,
        });
      }

      // Update the streaming message with final content
      updateStreamingMessage(streamingMessageId, reply, model);
    } catch (error) {
      // Hide typing indicator on error
      hideTypingIndicator();
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
    cursor.textContent = "▋";
    cursor.style.cssText = `
      animation: blink 1s infinite;
      color: var(--text-primary);
    `;
    contentDiv.appendChild(cursor);

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);

    // Scroll to bottom
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
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

    // Update the text content
    const textSpan = contentDiv.querySelector("span");
    if (textSpan) {
      textSpan.textContent = content;
    }

    // Add model indicator for assistant messages
    if (model) {
      const modelIndicator = document.createElement("div");
      modelIndicator.style.fontSize = "0.75em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      let modelText = "";
      if (model === "grok-2-vision") {
        modelText = "🤖 Using Grok Vision (image analysis)";
      } else if (model === "grok-3") {
        modelText = "🤖 Using Grok 3 (text analysis)";
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
      textSpan.textContent = content;
    }

    // Scroll to bottom to follow the streaming content
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 10);
  }

  async function fetchStreamingReply(
    message,
    screenshot,
    content,
    streamingMessageId
  ) {
    try {
      // Select the best model based on context type
      const model = screenshot ? "grok-2-vision" : "grok-3";

      const messages = [
        {
          role: "system",
          content:
            "You are Grok, a helpful AI assistant created by xAI. You will be provided context from the user's current webpage to help answer their questions more effectively. When asked to summarize, focus on the main content and provide a clear, concise summary.",
        },
      ];

      let contextMessage = "";

      if (screenshot) {
        contextMessage = "This is a screenshot of my current browser view:";
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: contextMessage,
            },
            {
              type: "image_url",
              image_url: {
                url: screenshot,
              },
            },
          ],
        });
      } else if (content) {
        contextMessage = `Here is the content from my current webpage:\n\n${content}\n\nPlease use this context to help answer my question. If I ask for a summary, summarize the main content from this webpage.`;
        messages.push({
          role: "user",
          content: contextMessage,
        });
      }

      messages.push({
        role: "user",
        content: message,
      });

      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0.7,
          max_tokens: 4096,
          stream: true, // Enable streaming
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        let errorMessage;
        try {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.error?.message || "API request failed";
        } catch {
          errorMessage =
            errorData || `API request failed with status ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                return fullContent;
              }

              try {
                const parsed = JSON.parse(data);
                if (
                  parsed.choices &&
                  parsed.choices[0] &&
                  parsed.choices[0].delta &&
                  parsed.choices[0].delta.content
                ) {
                  const content = parsed.choices[0].delta.content;
                  fullContent += content;
                  updateStreamingContent(streamingMessageId, fullContent);
                }
              } catch (e) {
                // Ignore parsing errors for incomplete JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return fullContent;
    } catch (error) {
      const errorMessage = error.message || "An unknown error occurred";
      updateStreamingContent(streamingMessageId, `Error: ${errorMessage}`);
      throw error;
    }
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
    textSpan.textContent = content;
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
      modelIndicator.style.fontSize = "0.75em";
      modelIndicator.style.color = "#666";
      modelIndicator.style.marginTop = "4px";
      modelIndicator.style.fontStyle = "italic";

      let modelText = "";
      if (model === "grok-2-vision") {
        modelText = "🤖 Using Grok Vision (image analysis)";
      } else if (model === "grok-3") {
        modelText = "🤖 Using Grok 3 (text analysis)";
      }

      modelIndicator.textContent = modelText;
      contentDiv.appendChild(modelIndicator);
    }

    messageDiv.appendChild(contentDiv);
    wrapperDiv.appendChild(messageDiv);
    chatContainer.appendChild(wrapperDiv);

    // Scroll to bottom with a small delay to ensure proper rendering
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 10);
  }

  // Test function to demonstrate loading states
  function testLoadingStates() {
    console.log("Testing loading states...");

    // Test context loading
    showContextLoading("Testing context loading...");
    setTimeout(() => {
      hideContextLoading();

      // Test main loading
      showLoading("Testing main loading...");
      setTimeout(() => {
        hideLoading();

        // Test typing indicator (this should show in model badge and disable input)
        showTypingIndicator("Test Model");
        setTimeout(() => {
          hideTypingIndicator();
          console.log(
            "Loading states test complete! Input should now be enabled and model badge restored."
          );
        }, 3000);
      }, 2000);
    }, 2000);
  }

  // Add test function to window for debugging
  window.testLoadingStates = testLoadingStates;
});
