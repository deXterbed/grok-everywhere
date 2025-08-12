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
    apiKeyInput.value = "API key saved";
    apiKeyInput.classList.add("saved");
    saveApiKeyButton.classList.add("active");
    messageInput.disabled = false;
    // Hide the API key input and save button, but keep the close button visible
    apiKeyInput.style.display = "none";
    saveApiKeyButton.style.display = "none";
    // Adjust chat container margin since API section is hidden
    document.getElementById("chat-container").style.marginTop = "0px";
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
    } else {
      // If button is not active, save the new API key
      const newApiKey = apiKeyInput.value.trim();
      if (newApiKey) {
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
      }
    }
  });

  // Set initial context mode and update UI
  updateContextModeUI();

  // Loading and typing indicator functions
  function showLoading() {
    const inputContainer = document.getElementById("input-container");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    inputContainer.classList.add("loading");
    sendButton.classList.add("loading");
    messageInput.disabled = true;
    sendButton.disabled = true;
  }

  function hideLoading() {
    const inputContainer = document.getElementById("input-container");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.querySelector(".send-button");

    inputContainer.classList.remove("loading");
    sendButton.classList.remove("loading");
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  }

  function showTypingIndicator(model) {
    const typingIndicator = document.getElementById("typing-indicator");
    const modelIndicator = typingIndicator.querySelector(
      ".typing-model-indicator"
    );

    modelIndicator.textContent = `${model} is thinking...`;
    typingIndicator.style.display = "block";

    // Scroll to bottom to show typing indicator
    const chatContainer = document.getElementById("chat-container");
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function hideTypingIndicator() {
    const typingIndicator = document.getElementById("typing-indicator");
    typingIndicator.style.display = "none";
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

    port = chrome.runtime.connect({ name: "sidepanel" });

    port.onMessage.addListener((message) => {
      if (message.action === "clearConversation") {
        clearConversation();
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectToBackground, 1000);
    });
  }

  // Initial connection
  connectToBackground();

  // Keep track of conversation history
  let conversationHistory = [];

  // Load previous conversation if it exists
  chrome.storage.local.get(["conversationHistory"], (result) => {
    if (result.conversationHistory) {
      conversationHistory = result.conversationHistory;
      // Restore the conversation UI
      conversationHistory.forEach((msg) => {
        addMessage(msg.content, msg.isUser, msg.screenshot, msg.model);
      });
    }
  });

  function clearConversation() {
    conversationHistory = [];
    chrome.storage.local.set({ conversationHistory: [] });
    chatContainer.innerHTML = "";
    messageInput.value = "";
    messageInput.focus();
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
        return null;
      }
    } catch (error) {
      console.error("Failed to extract content:", error);
      return null;
    }
  }

  function updateContextModeUI() {
    // Remove all active classes first
    imageButton.classList.remove("active", "content-mode", "screenshot-mode");

    // Get info panel elements - handle case where they might not exist
    const currentModelDisplay = document.getElementById(
      "current-model-display"
    );

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
    const message = messageInput.value.trim();
    if (message) {
      messageInput.value = "";

      let screenshotToSend = null;
      let contentToSend = null;
      let wasShortcutMode = isShortcutMode;

      // Show loading state
      showLoading();

      try {
        if (contextMode === "screenshot") {
          if (isShortcutMode && currentScreenshot) {
            // Shortcut mode: use existing screenshot once
            screenshotToSend = currentScreenshot;
            clearShortcutMode();
          } else {
            // Auto mode: take new screenshot
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
            contentToSend = await extractPageContent();

            // Fallback: if content extraction failed, try again
            if (!contentToSend || contentToSend.length < 50) {
              contentToSend = await extractPageContent();
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
        clearShortcutMode();
        currentScreenshot = request.dataUrl;
        isShortcutMode = true;
      }
      messageInput.focus();
    }

    if (request.action === "addContentContext") {
      if (contextMode === "content") {
        clearShortcutMode();
        currentContent = request.content;
        isShortcutMode = true;
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
    await chrome.storage.local.set({ conversationHistory });

    try {
      // Get reply
      const reply = await fetchReply(message, screenshot, content);

      // Hide typing indicator
      hideTypingIndicator();

      // Add reply to conversation history
      conversationHistory.push({
        content: reply,
        isUser: false,
        model: model,
      });
      await chrome.storage.local.set({ conversationHistory });

      // Add reply to UI
      addMessage(reply, false, null, model);
    } catch (error) {
      // Hide typing indicator on error
      hideTypingIndicator();
      throw error;
    }
  }

  async function fetchReply(message, screenshot, content) {
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

      const data = await response.json();
      if (!data.choices?.[0]?.message?.content) {
        throw new Error("Invalid response format from API");
      }

      return data.choices[0].message.content;
    } catch (error) {
      const errorMessage = error.message || "An unknown error occurred";
      addMessage(`Error: ${errorMessage}`, false);
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
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});
