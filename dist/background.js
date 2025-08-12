// Global ports collection
const sidePanelPorts = new Set();

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Configure the side panel to open when the action icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle connections from sidepanel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") {
    sidePanelPorts.add(port);
    port.onDisconnect.addListener(() => {
      sidePanelPorts.delete(port);
    });
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Always try to send clear message
  sidePanelPorts.forEach((port) => {
    try {
      port.postMessage({ action: "clearConversation" });
    } catch (error) {
      console.error("Error sending message to port:", error);
    }
  });

  // Ensure the panel is enabled for this tab
  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      enabled: true,
    });
  } catch (error) {
    console.error("Error enabling panel:", error);
  }
});

// Handle keyboard command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "take-screenshot") {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab) {
        console.error("No active tab found");
        return;
      }

      // Take the screenshot
      chrome.tabs.sendMessage(activeTab.id, { action: "takeScreenshot" });

      // Send message to all tabs to broadcast to sidepanel
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs
            .sendMessage(tab.id, {
              action: "broadcastToSidePanel",
              message: { type: "focusInput" },
            })
            .catch(() => {
              // Ignore errors from tabs that don't have a listener
            });
        });
      });
    } catch (error) {
      console.error("Screenshot error:", error);
    }
  }

  if (command === "extract-content") {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab) {
        console.error("No active tab found");
        return;
      }

      // Extract content from the active tab
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "extractContent" },
        (response) => {
          if (response && response.content) {
            // Send content to sidepanel
            chrome.runtime.sendMessage({
              action: "addContentContext",
              content: response.content,
            });
          }
        }
      );

      // Send message to all tabs to broadcast to sidepanel
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs
            .sendMessage(tab.id, {
              action: "broadcastToSidePanel",
              message: { type: "focusInput" },
            })
            .catch(() => {
              // Ignore errors from tabs that don't have a listener
            });
        });
      });
    } catch (error) {
      console.error("Content extraction error:", error);
    }
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureTab") {
    chrome.tabs.captureVisibleTab(
      null,
      { format: "jpeg", quality: 80 },
      (dataUrl) => {
        sendResponse({ dataUrl });
      }
    );
    return true;
  }

  if (request.action === "extractContent") {
    // Forward the content extraction request to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "extractContent" },
          (response) => {
            // Handle cases where response might be undefined or have errors
            if (chrome.runtime.lastError) {
              console.error(
                "Runtime error during content extraction:",
                chrome.runtime.lastError
              );
              sendResponse({
                content: null,
                error: chrome.runtime.lastError.message,
              });
            } else if (response && response.content) {
              console.log(
                "Content extracted successfully, length:",
                response.content.length
              );
              sendResponse({ content: response.content });
            } else if (response && response.error) {
              console.error("Content extraction failed:", response.error);
              sendResponse({ content: null, error: response.error });
            } else {
              console.error("Unexpected response format:", response);
              sendResponse({
                content: null,
                error: "Unexpected response format",
              });
            }
          }
        );
      } else {
        console.error("No active tab found for content extraction");
        sendResponse({ content: null, error: "No active tab found" });
      }
    });
    return true; // Keep the message channel open for async response
  }

  if (request.action === "screenshotTaken") {
    // Forward the screenshot to the sidepanel
    chrome.runtime.sendMessage({
      action: "addScreenshotContext",
      dataUrl: request.dataUrl,
    });

    // Also broadcast to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            action: "broadcastToSidePanel",
            message: { type: "focusInput" },
          })
          .catch(() => {
            // Ignore errors from tabs that don't have a listener
          });
      });
    });
  }
});
