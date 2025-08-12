// Function to capture visible viewport
async function captureVisibleArea() {
  const dataUrl = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
      resolve(response.dataUrl);
    });
  });
  return dataUrl;
}

// Function to extract relevant webpage content
function extractPageContent() {
  try {
    // Remove script and style elements
    const scripts = document.querySelectorAll(
      "script, style, noscript, iframe, embed, object, nav, header, footer, .nav, .header, .footer, .sidebar, .menu"
    );
    scripts.forEach((el) => el.remove());

    // Get the main content areas
    const contentSelectors = [
      "main",
      "article",
      '[role="main"]',
      ".content",
      ".main-content",
      "#content",
      "#main",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".page-content",
      ".text-content",
      ".body-content",
    ];

    let content = "";
    let mainElement = null;

    // Try to find main content area
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        mainElement = element;
        break;
      }
    }

    // If no main content found, use body but filter out navigation and other non-content elements
    if (!mainElement) {
      mainElement = document.body;
    }

    // Extract text content
    content = mainElement.textContent || mainElement.innerText || "";

    // Clean up the content
    content = content
      .replace(/\s+/g, " ") // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, "\n") // Replace multiple newlines with single newline
      .replace(/^\s+|\s+$/g, "") // Trim whitespace
      .trim();

    // Limit content length to avoid token limits
    const maxLength = 8000; // Conservative limit
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + "...";
    }

    // Add page metadata
    const title = document.title || "";
    const url = window.location.href;
    const metadata = `Page: ${title}\nURL: ${url}\n\n`;

    const finalContent = metadata + content;

    // Ensure we have meaningful content
    if (finalContent.length < 100) {
      console.warn("Extracted content seems too short, might be an issue");
    }

    return finalContent;
  } catch (error) {
    console.error("Error in content extraction:", error);
    return `Error extracting content: ${error.message}`;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  // console.log("Content script received message:", request.action);

  if (request.action === "takeScreenshot") {
    try {
      // Request screenshot from background script
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "captureTab" }, resolve);
      });

      // Forward screenshot to background script
      chrome.runtime.sendMessage({
        action: "screenshotTaken",
        dataUrl: response.dataUrl,
      });
    } catch (error) {
      console.error("Screenshot error:", error);
    }
  }

  if (request.action === "extractContent") {
    try {
      // console.log("Extracting content from page:", window.location.href);

      // Check if we're on a valid page
      if (!document.body) {
        console.warn("Document body not available");
        sendResponse({ content: null, error: "Document body not available" });
        return true;
      }

      const content = extractPageContent();
      // console.log("Content extraction result:", content ? "success" : "failed");

      if (!content || content.length < 50) {
        console.warn("Content extraction returned insufficient content");
        sendResponse({
          content: null,
          error: "Insufficient content extracted",
        });
        return true;
      }

      sendResponse({ content: content });
    } catch (error) {
      console.error("Content extraction error:", error);
      sendResponse({ content: null, error: error.message });
    }
    return true; // Keep the message channel open for async response
  }

  if (request.action === "broadcastToSidePanel") {
    // Broadcast message to sidepanel via postMessage
    window.postMessage(
      {
        source: "content-script",
        ...request.message,
      },
      "*"
    );
  }
});

// Test message to verify content script is loaded
// console.log("Grok Everywhere content script loaded on:", window.location.href);
