// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Configure the side panel to open when the action icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Tab activation handling removed - no longer needed without port connections

// Tab update handling removed - no longer needed without port connections

// Handle tab removal to clean up chat history
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    // Clean up chat history for the closed tab
    const storageKey = `conversationHistory_${tabId}`;
    await chrome.storage.local.remove([storageKey]);
    console.log(`Cleaned up chat history for closed tab: ${tabId}`);
  } catch (error) {
    console.error("Error cleaning up chat history for closed tab:", error);
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
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
  }
});
