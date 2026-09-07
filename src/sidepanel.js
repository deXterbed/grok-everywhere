import { parseMarkdown } from "./modules/markdown.js";
import {
  takeScreenshot,
  extractPageContent,
  checkContentScriptAvailability,
} from "./modules/content.js";
import { createStorage } from "./modules/storage.js";
import { fetchStreamingReply } from "./modules/api.js";
import { uploadFile, MAX_FILE_SIZE } from "./modules/files.js";
import { fetchFileResponse, FILE_MODEL } from "./modules/responses.js";
import {
  AUTH_MODE_API_KEY,
  AUTH_MODE_OAUTH,
  getBearerToken,
  startDeviceLogin,
  cancelDeviceLogin,
  logoutOAuth,
} from "./modules/auth.js";
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
  const quickActionsEl = document.getElementById("quick-actions");
  const attachButton = document.getElementById("attach-button");
  const attachmentInput = document.getElementById("attachment-input");
  const attachmentPreview = document.getElementById("attachment-preview");
  let apiKey = null; // active bearer (API key or OAuth access token)
  let storedApiKey = null;
  let authMode = AUTH_MODE_API_KEY;
  let currentScreenshot = null;
  let currentContent = null;
  let contextMode = "content"; // 'none', 'content', 'screenshot'
  let isShortcutMode = false;
  let lastAutoScreenshot = null; // Track auto mode screenshot separately
  let pendingAttachments = []; // Image attachments (dataURLs) staged for the next message
  let pendingFiles = []; // Non-image file attachments staged for the next message
  let fileAttachmentCounter = 0;
  // ── Lightbox references ────────────────────────────────────────────
  const lightbox = document.getElementById("screenshot-lightbox");
  const lightboxImg = lightbox.querySelector(".screenshot-lightbox-image");
  const lightboxClose = lightbox.querySelector(".screenshot-lightbox-close");
  const lightboxPrev = lightbox.querySelector(".screenshot-lightbox-prev");
  const lightboxNext = lightbox.querySelector(".screenshot-lightbox-next");
  let lightboxImages = [];
  let lightboxIndex = -1;

  function openLightbox(index) {
    if (index < 0 || index >= lightboxImages.length) return;
    lightboxIndex = index;
    lightboxImg.src = lightboxImages[index];
    lightbox.style.display = "flex";
    lightboxPrev.style.display = lightboxImages.length > 1 ? "block" : "none";
    lightboxNext.style.display = lightboxImages.length > 1 ? "block" : "none";
  }

  function closeLightbox() {
    lightbox.style.display = "none";
    lightboxImg.src = "";
  }

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightboxPrev.addEventListener("click", () => {
    openLightbox(lightboxIndex - 1);
  });
  lightboxNext.addEventListener("click", () => {
    openLightbox(lightboxIndex + 1);
  });
  document.addEventListener("keydown", (e) => {
    if (lightbox.style.display !== "flex") return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") openLightbox(lightboxIndex - 1);
    if (e.key === "ArrowRight") openLightbox(lightboxIndex + 1);
  });

  // ── Attachment (upload / clipboard paste) handling ────────────────
  function renderAttachmentPreview() {
    attachmentPreview.innerHTML = "";
    if (pendingAttachments.length === 0 && pendingFiles.length === 0) {
      attachmentPreview.style.display = "none";
      return;
    }
    attachmentPreview.style.display = "flex";
    pendingAttachments.forEach((dataUrl, index) => {
      const thumb = document.createElement("div");
      thumb.className = "attachment-thumb";

      const img = document.createElement("img");
      img.src = dataUrl;
      thumb.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.className = "attachment-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        pendingAttachments.splice(index, 1);
        renderAttachmentPreview();
      });
      thumb.appendChild(removeBtn);

      attachmentPreview.appendChild(thumb);
    });

    pendingFiles.forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = `attachment-file ${entry.status}`;
      chip.title = entry.error || entry.name;

      const nameSpan = document.createElement("span");
      nameSpan.className = "attachment-file-name";
      nameSpan.textContent =
        entry.status === "uploading"
          ? `Uploading ${entry.name}…`
          : entry.status === "error"
            ? `${entry.name} (failed)`
            : entry.name;
      chip.appendChild(nameSpan);

      const removeBtn = document.createElement("button");
      removeBtn.className = "attachment-remove-inline";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        pendingFiles = pendingFiles.filter((f) => f.localId !== entry.localId);
        renderAttachmentPreview();
      });
      chip.appendChild(removeBtn);

      attachmentPreview.appendChild(chip);
    });
  }

  function addAttachmentFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      // Sanity-check: reject empty or trivial data URLs that can appear when
      // clipboard representations are corrupted or placeholder-only.
      if (!dataUrl || dataUrl.length < 100) {
        console.warn("Attachment image data URL too short, ignoring");
        return;
      }
      pendingAttachments.push(dataUrl);
      renderAttachmentPreview();
    };
    reader.readAsDataURL(file);
  }

  function addFileAttachment(file) {
    if (!file) return;
    const entry = {
      localId: ++fileAttachmentCounter,
      name: file.name,
      status: "uploading",
      fileId: null,
      error: null,
      uploadPromise: null,
    };

    if (!apiKey) {
      entry.status = "error";
      entry.error = "Sign in with SuperGrok or enter an API key";
      pendingFiles.push(entry);
      renderAttachmentPreview();
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      entry.status = "error";
      entry.error = "File exceeds 48MB limit";
      pendingFiles.push(entry);
      renderAttachmentPreview();
      return;
    }

    pendingFiles.push(entry);
    renderAttachmentPreview();

    entry.uploadPromise = getBearerToken()
      .then((token) => {
        if (!token) throw new Error("Sign in with SuperGrok or enter an API key");
        apiKey = token;
        return uploadFile(token, file);
      })
      .then((result) => {
        entry.status = "uploaded";
        entry.fileId = result.id;
        renderAttachmentPreview();
      })
      .catch((error) => {
        entry.status = "error";
        entry.error = error.message || "Upload failed";
        renderAttachmentPreview();
      });
  }

  function addAttachedFileOrImage(file) {
    if (!file) return;
    if (file.type.startsWith("image/")) {
      addAttachmentFile(file);
    } else {
      addFileAttachment(file);
    }
  }

  attachButton.addEventListener("click", () => {
    attachmentInput.click();
  });

  attachmentInput.addEventListener("change", () => {
    Array.from(attachmentInput.files || []).forEach(addAttachedFileOrImage);
    attachmentInput.value = "";
  });

  messageInput.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter((item) => item.kind === "file");
    if (fileItems.length === 0) return;
    e.preventDefault();

    // Clipboard paste can expose the same image in multiple formats
    // (e.g. PNG + TIFF on macOS). Dedupe by file size so distinct images
    // pasted together are still both attached.
    const seenImageSizes = new Set();
    fileItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      if (file.type.startsWith("image/")) {
        if (seenImageSizes.has(file.size)) return;
        seenImageSizes.add(file.size);
      }
      addAttachedFileOrImage(file);
    });
  });

  let isUserAtBottom = true; // Track if user is at bottom of chat

  // ── Model definitions ──────────────────────────────────────────────
  // Based on xAI docs — active models as of September 2026
  const TEXT_MODELS = [
    {
      id: "grok-4.6",
      label: "Grok 4.6",
      description: "Current flagship — coding, agents, vision",
    },
    {
      id: "grok-4.5",
      label: "Grok 4.5",
      description: "Agentic — required for file attachments",
    },
    {
      id: "grok-4.3",
      label: "Grok 4.3",
      description: "Strong chat & page content",
    },
    {
      id: "grok-4.20-0309-reasoning",
      label: "Grok 4.20 Reasoning",
      description: "Low hallucination, strong tool calling",
    },
    {
      id: "grok-4.20-0309-non-reasoning",
      label: "Grok 4.20 (fast)",
      description: "Low latency, non-thinking",
    },
    {
      id: "grok-4.20-multi-agent-0309",
      label: "Grok 4.20 Multi-Agent",
      description: "Multi-agent research, 2M context",
    },
    {
      id: "grok-build-0.1",
      label: "Grok Build 0.1",
      description: "Fast coding specialist (vision-capable)",
    },
  ];

  const VISION_MODELS = [
    {
      id: "grok-4.6",
      label: "Grok 4.6",
      description: "Current flagship — image input",
    },
    {
      id: "grok-4.5",
      label: "Grok 4.5",
      description: "Agentic with image input",
    },
    {
      id: "grok-4.3",
      label: "Grok 4.3",
      description: "Supports image input",
    },
    {
      id: "grok-4.20-0309-reasoning",
      label: "Grok 4.20 Reasoning",
      description: "Image input, low hallucination",
    },
    {
      id: "grok-4.20-0309-non-reasoning",
      label: "Grok 4.20 (fast)",
      description: "Image input, low latency",
    },
    {
      id: "grok-4.20-multi-agent-0309",
      label: "Grok 4.20 Multi-Agent",
      description: "Image input, multi-agent research",
    },
    {
      id: "grok-build-0.1",
      label: "Grok Build 0.1",
      description: "Fast coding with vision",
    },
  ];

  const DEFAULT_TEXT_MODEL = "grok-4.3";
  const DEFAULT_VISION_MODEL = "grok-4.3";
  let textModel = DEFAULT_TEXT_MODEL;
  let visionModel = DEFAULT_VISION_MODEL;

  const modelSelectEl = document.getElementById("model-text-select");
  const visionSelectEl = document.getElementById("model-vision-select");

  function populateModelSelect(selectEl, models, currentId) {
    selectEl.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === currentId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function getTextModelLabel() {
    const m = TEXT_MODELS.find((m) => m.id === textModel);
    return m ? m.label : textModel;
  }

  function getVisionModelLabel() {
    const m = VISION_MODELS.find((m) => m.id === visionModel);
    return m ? m.label : visionModel;
  }

  function getFileModelLabel() {
    const m = TEXT_MODELS.find((m) => m.id === FILE_MODEL);
    return m ? m.label : FILE_MODEL;
  }

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
    if (isUserAtBottom) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // Function to force scroll to bottom (for new messages)
  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
    isUserAtBottom = true;
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

  // Restore quick actions after clearing the chat container
  function restoreEmptyState() {
    if (quickActionsEl && !chatContainer.querySelector("#quick-actions")) {
      chatContainer.appendChild(quickActionsEl);
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

  // Track whether the user is at the bottom of the chat
  chatContainer.addEventListener("scroll", () => {
    isUserAtBottom = isAtBottom();
  });

  function setOauthPending(device) {
    const banner = document.getElementById("oauth-device-banner");
    const inputs = document.getElementById("api-key-input-container");
    const settingsDevice = document.getElementById("settings-oauth-device");
    if (device) {
      document.getElementById("oauth-user-code").textContent = device.user_code;
      document.getElementById("settings-oauth-user-code").textContent =
        device.user_code;
      banner.hidden = false;
      inputs.style.display = "none";
      settingsDevice.hidden = false;
    } else {
      banner.hidden = true;
      inputs.style.display = "flex";
      settingsDevice.hidden = true;
    }
  }

  function updateOauthSettingsUi() {
    const signedIn = authMode === AUTH_MODE_OAUTH && Boolean(apiKey);
    document.getElementById("oauth-status").textContent = signedIn
      ? "Signed in"
      : "Optional device-code sign-in";
    document.getElementById("oauth-login").hidden = signedIn;
    document.getElementById("oauth-logout").hidden = !signedIn;
  }

  function applyAuthenticatedUi() {
    if (storedApiKey) {
      apiKeyInput.value = "API key saved";
      apiKeyInput.classList.add("saved");
      saveApiKeyButton.classList.add("active");
    } else {
      apiKeyInput.value = "";
      apiKeyInput.classList.remove("saved");
      saveApiKeyButton.classList.remove("active");
    }
    updateOauthSettingsUi();
    if (apiKey) {
      messageInput.disabled = false;
      showPageContext();
    } else {
      messageInput.disabled = true;
      saveApiKeyButton.style.display = "flex";
      apiKeyInput.style.display = "block";
      showApiKeySection();
    }
    updateClearHistoryVisibility();
  }

  async function refreshActiveBearer() {
    apiKey = await getBearerToken();
    const stored = await chrome.storage.local.get(["authMode", "xaiApiKey"]);
    authMode = stored.authMode || AUTH_MODE_API_KEY;
    storedApiKey = stored.xaiApiKey || null;
    return apiKey;
  }

  async function runDeviceLogin() {
    showContextLoading("Starting SuperGrok sign-in...");
    try {
      const session = await startDeviceLogin((device) => {
        hideContextLoading();
        setOauthPending(device);
        addMessage(
          `SuperGrok sign-in: enter ${device.user_code} at ${device.verification_uri}`,
          false,
        );
      });
      setOauthPending(null);
      authMode = AUTH_MODE_OAUTH;
      apiKey = session.accessToken;
      applyAuthenticatedUi();
    } catch (error) {
      setOauthPending(null);
      if (error?.name !== "AbortError") {
        addMessage(`[!] ${error.message}`, false);
      }
      await refreshActiveBearer().catch(() => {
        apiKey = storedApiKey;
      });
      applyAuthenticatedUi();
    } finally {
      hideContextLoading();
    }
  }

  // Load theme, API key / OAuth, and model settings
  const result = await chrome.storage.local.get([
    "xaiApiKey",
    "theme",
    "textModel",
    "visionModel",
    "authMode",
  ]);
  storedApiKey = result.xaiApiKey || null;
  authMode = result.authMode || AUTH_MODE_API_KEY;
  try {
    apiKey = await getBearerToken();
  } catch {
    apiKey = storedApiKey;
    authMode = AUTH_MODE_API_KEY;
  }
  const savedTheme = result.theme || "dark";
  document.documentElement.dataset.theme = savedTheme;
  if (result.textModel) textModel = result.textModel;
  if (result.visionModel) visionModel = result.visionModel;

  // Populate model selects with saved values
  populateModelSelect(modelSelectEl, TEXT_MODELS, textModel);
  populateModelSelect(visionSelectEl, VISION_MODELS, visionModel);

  applyAuthenticatedUi();

  // Handle API key input and save
  apiKeyInput.addEventListener("focus", () => {
    if (storedApiKey && apiKeyInput.classList.contains("saved")) {
      apiKeyInput.value = storedApiKey;
    }
  });

  apiKeyInput.addEventListener("blur", () => {
    if (storedApiKey && apiKeyInput.classList.contains("saved")) {
      apiKeyInput.value = "API key saved";
    }
  });

  apiKeyInput.addEventListener("input", async () => {
    const newValue = apiKeyInput.value.trim();

    // Ignore browser-initiated input events (autofill) when key is already loaded.
    // Only react if the user is actually typing a new key or intentionally clearing.
    if (storedApiKey && apiKeyInput.classList.contains("saved")) {
      // User is editing a saved key — un-mark as saved but don't delete yet
      apiKeyInput.classList.remove("saved");
      saveApiKeyButton.classList.remove("active");
      // Only delete from storage if user intentionally cleared the field
      if (!newValue) {
        await chrome.storage.local.remove("xaiApiKey");
        storedApiKey = null;
        if (authMode !== AUTH_MODE_OAUTH) {
          apiKey = null;
          clearHistoryButton.style.display = "none";
        }
      }
      if (authMode !== AUTH_MODE_OAUTH) messageInput.disabled = !newValue;
      return;
    }

    // No saved key yet — normal input handling
    if (!newValue) {
      await chrome.storage.local.remove("xaiApiKey");
      storedApiKey = null;
      if (authMode !== AUTH_MODE_OAUTH) apiKey = null;
    }

    if (authMode !== AUTH_MODE_OAUTH) messageInput.disabled = !newValue;
  });

  saveApiKeyButton.addEventListener("click", async () => {
    if (saveApiKeyButton.classList.contains("active")) {
      // If button is active, clicking it should delete the API key
      showContextLoading("Removing API key...");
      await chrome.storage.local.remove("xaiApiKey");
      storedApiKey = null;
      if (authMode === AUTH_MODE_OAUTH) {
        await refreshActiveBearer().catch(() => {});
      } else {
        apiKey = null;
      }
      applyAuthenticatedUi();
      hideContextLoading();
    } else {
      // If button is not active, save the new API key
      const newApiKey = apiKeyInput.value.trim();
      if (newApiKey) {
        showContextLoading("Saving API key...");
        await chrome.storage.local.set({
          xaiApiKey: newApiKey,
          authMode: AUTH_MODE_API_KEY,
        });
        storedApiKey = newApiKey;
        authMode = AUTH_MODE_API_KEY;
        apiKey = newApiKey;
        applyAuthenticatedUi();
        hideContextLoading();
      }
    }
  });

  document
    .getElementById("header-oauth-login")
    .addEventListener("click", runDeviceLogin);
  document.getElementById("oauth-cancel").addEventListener("click", () => {
    cancelDeviceLogin();
    setOauthPending(null);
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
      getTextModelLabel,
      getVisionModelLabel,
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

      if (result[`conversationHistory_${tabId}`]) {
        conversationHistory = limitMessageHistory(
          result[`conversationHistory_${tabId}`],
        );
        // Restore the conversation UI
        conversationHistory.forEach((msg) => {
          addMessage(msg.content, msg.isUser, msg.images, msg.model, msg.files);
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

  // Switch conversation when the user activates a different tab
  chrome.tabs.onActivated.addListener(checkCurrentTab);

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
    lightboxImages = [];
    lightboxIndex = -1;
    restoreEmptyState();
    messageInput.value = "";
    autoResizeTextarea();
    messageInput.focus();
    isUserAtBottom = true;
    updateClearHistoryVisibility();
  }

  // Image button toggle functionality - now cycles through three modes
  imageButton.addEventListener("click", () => {
    cycleContextMode();
  });

  // Function to handle message sending
  async function handleMessageSend() {
    if (
      !messageInput.value.trim() &&
      pendingAttachments.length === 0 &&
      pendingFiles.length === 0
    ) {
      return;
    }
    try {
      apiKey = await getBearerToken();
    } catch (error) {
      addMessage(`[!] ${error.message}`, false);
      return;
    }
    if (!apiKey) {
      addMessage(
        "[!] Sign in with SuperGrok or enter an xAI API key.",
        false,
      );
      return;
    }

    const message = messageInput.value.trim();
    messageInput.value = "";
    autoResizeTextarea();

    const attachmentsToSend = pendingAttachments;
    pendingAttachments = [];
    const pendingFileEntries = pendingFiles;
    pendingFiles = [];
    renderAttachmentPreview();

    let screenshotToSend = null;
    let contentToSend = null;
    let wasShortcutMode = isShortcutMode;
    let usesFiles = false;

    try {
      // Show initial loading state
      showLoading("Preparing message...");

      // Wait for any in-flight file uploads, then drop failed ones (restoring
      // them to the input so the user can see the error and retry/remove)
      if (pendingFileEntries.length > 0) {
        showContextLoading("Uploading files...");
        await Promise.all(
          pendingFileEntries.map((f) => f.uploadPromise).filter(Boolean),
        );
      }
      const filesToSend = pendingFileEntries
        .filter((f) => f.status === "uploaded")
        .map((f) => ({ name: f.name, fileId: f.fileId }));
      const failedFiles = pendingFileEntries.filter(
        (f) => f.status === "error",
      );
      if (failedFiles.length > 0) {
        pendingFiles = pendingFiles.concat(failedFiles);
        renderAttachmentPreview();
      }
      usesFiles =
        filesToSend.length > 0 ||
        conversationHistory.some((m) => m.files && m.files.length > 0);

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
            hideTypingIndicator(
              contextMode === "screenshot"
                ? getVisionModelLabel()
                : getTextModelLabel(),
            );
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
            hideTypingIndicator(
              contextMode === "screenshot"
                ? getVisionModelLabel()
                : getTextModelLabel(),
            );
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
      const images = screenshotToSend
        ? [screenshotToSend, ...attachmentsToSend]
        : attachmentsToSend;
      hideLoading();

      // Determine which model will be used for typing indicator
      const model = usesFiles
        ? getFileModelLabel()
        : images.length > 0
          ? getVisionModelLabel()
          : getTextModelLabel();
      showTypingIndicator(model);

      await sendMessage(message, images, contentToSend, filesToSend);
    } catch (error) {
      // If sending fails, restore the attachments so the user doesn't lose them
      pendingAttachments = attachmentsToSend;
      const uploadedFileEntries = pendingFileEntries.filter(
        (f) => f.status === "uploaded",
      );
      if (uploadedFileEntries.length > 0) {
        pendingFiles = pendingFiles.concat(uploadedFileEntries);
      }
      renderAttachmentPreview();
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
      hideTypingIndicator(
        usesFiles
          ? getFileModelLabel()
          : contextMode === "screenshot"
            ? getVisionModelLabel()
            : getTextModelLabel(),
      );
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

  // Quick action buttons
  document.querySelectorAll(".quick-action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const prompt = btn.dataset.prompt;
      if (!prompt || !apiKey) return;
      if (contextMode === "none") {
        contextMode = "content";
        updateContextModeUI();
      }
      messageInput.value = prompt;
      await handleMessageSend();
    });
  });

  // Settings panel
  const settingsView = document.getElementById("settings-view");
  const settingsApiInput = document.getElementById("settings-api-input");
  const settingsApiSave = document.getElementById("settings-api-save");

  function openSettings() {
    settingsApiInput.value = storedApiKey || "";
    settingsApiSave.textContent = "Save";
    settingsApiSave.classList.remove("saved");
    // Sync select values to current state before opening
    modelSelectEl.value = textModel;
    visionSelectEl.value = visionModel;
    updateThemeButtons();
    updateOauthSettingsUi();
    settingsView.style.display = "flex";
    chatContainer.style.display = "none";
    if (inputContainer) inputContainer.style.display = "none";
  }

  function closeSettings() {
    settingsView.style.display = "none";
    chatContainer.style.display = "block";
    if (inputContainer) inputContainer.style.display = "flex";
  }

  function updateThemeButtons() {
    const current = document.documentElement.dataset.theme || "dark";
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === current);
    });
  }

  const settingsButton = document.getElementById("settings-button");
  const inputContainer = document.getElementById("input-container");
  if (settingsButton) {
    settingsButton.addEventListener("click", openSettings);
  }

  document
    .getElementById("settings-close")
    .addEventListener("click", closeSettings);

  settingsApiSave.addEventListener("click", async () => {
    const newKey = settingsApiInput.value.trim();
    if (!newKey) return;
    await chrome.storage.local.set({
      xaiApiKey: newKey,
      authMode: AUTH_MODE_API_KEY,
    });
    storedApiKey = newKey;
    authMode = AUTH_MODE_API_KEY;
    apiKey = newKey;
    applyAuthenticatedUi();
    settingsApiSave.textContent = "Saved";
    settingsApiSave.classList.add("saved");
    setTimeout(() => {
      settingsApiSave.textContent = "Save";
      settingsApiSave.classList.remove("saved");
    }, 2000);
  });

  document.getElementById("oauth-login").addEventListener("click", runDeviceLogin);
  document.getElementById("oauth-logout").addEventListener("click", async () => {
    await logoutOAuth();
    authMode = AUTH_MODE_API_KEY;
    apiKey = storedApiKey;
    applyAuthenticatedUi();
  });

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.theme;
      document.documentElement.dataset.theme = theme;
      await chrome.storage.local.set({ theme });
      updateThemeButtons();
    });
  });

  // Model selection change handlers
  modelSelectEl.addEventListener("change", async () => {
    textModel = modelSelectEl.value;
    await chrome.storage.local.set({ textModel });
    updateContextModeUI();
  });

  visionSelectEl.addEventListener("change", async () => {
    visionModel = visionSelectEl.value;
    await chrome.storage.local.set({ visionModel });
    updateContextModeUI();
  });

  // Handle clear history button click
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmClear = document.getElementById("confirm-clear");

  clearHistoryButton.addEventListener("click", () => {
    confirmDialog.style.display = "block";
  });

  confirmCancel.addEventListener("click", () => {
    confirmDialog.style.display = "none";
  });

  confirmClear.addEventListener("click", () => {
    confirmDialog.style.display = "none";
    clearConversation();
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

  async function sendMessage(message, images, content, files) {
    // Files (any file attached this turn, or in earlier turns of this
    // conversation) require xAI's Responses API — it's the only endpoint
    // that supports input_file / attachment_search. See CLAUDE.md.
    const usesFiles =
      (files && files.length > 0) ||
      conversationHistory.some((m) => m.files && m.files.length > 0);

    // Determine which model ID to use based on context mode
    let model;
    if (usesFiles) {
      model = FILE_MODEL;
    } else if (images && images.length > 0) {
      model = visionModel;
    } else {
      model = textModel;
    }

    // Add message to UI first
    addMessage(message, true, images, model, files);

    // Add to conversation history
    conversationHistory.push({
      content: message,
      isUser: true,
      images: images,
      files: files,
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

    const modelLabel = () =>
      usesFiles
        ? getFileModelLabel()
        : images && images.length > 0
          ? getVisionModelLabel()
          : getTextModelLabel();

    const streamingMessageId = Date.now().toString();
    try {
      // Create a placeholder message for the streaming response
      addStreamingMessage(streamingMessageId);

      // Get streaming reply
      const reply = usesFiles
        ? await fetchFileResponse({
            streamingMessageId,
            apiKey,
            conversationHistory,
            onStream: updateStreamingContent,
          })
        : await fetchStreamingReply({
            message,
            images,
            content,
            streamingMessageId,
            model,
            apiKey,
            conversationHistory,
            onStream: updateStreamingContent,
          });

      // Hide typing indicator
      hideTypingIndicator(modelLabel());

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
      // Hide typing indicator on error. 403 from SuperGrok OAuth is shown
      // once here — no refresh/retry loop.
      hideTypingIndicator(modelLabel());
      updateStreamingMessage(streamingMessageId, error.message);
      throw error;
    }
  }

  const COPY_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const COPIED_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function createCopyButton(text) {
    const button = document.createElement("button");
    button.className = "message-copy-button";
    button.title = "Copy";
    button.innerHTML = COPY_ICON;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard
        .writeText(text)
        .then(() => {
          button.classList.add("copied");
          button.title = "Copied!";
          button.innerHTML = COPIED_ICON;
          setTimeout(() => {
            button.classList.remove("copied");
            button.title = "Copy";
            button.innerHTML = COPY_ICON;
          }, 1200);
        })
        .catch((error) => {
          console.error("Failed to copy message:", error);
        });
    });
    return button;
  }

  // Appends the "Using <model>" indicator + copy button under an assistant message
  function appendAssistantFooter(contentDiv, content, model) {
    const footer = document.createElement("div");
    footer.className = "message-footer";

    if (model) {
      const modelIndicator = document.createElement("span");
      modelIndicator.className = "model-indicator";
      const textDef = TEXT_MODELS.find((m) => m.id === model);
      const visionDef = VISION_MODELS.find((m) => m.id === model);
      const def = textDef || visionDef;
      modelIndicator.textContent = def
        ? `Using ${def.label}`
        : `Using ${model}`;
      footer.appendChild(modelIndicator);
    }

    footer.appendChild(createCopyButton(content));
    contentDiv.appendChild(footer);
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

    // Add model indicator + copy button for assistant messages
    if (model) {
      appendAssistantFooter(contentDiv, content, model);
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

  function addMessage(
    content,
    isUser,
    images = null,
    model = null,
    files = null,
  ) {
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

    // Add small inline thumbnails for any attached images
    if (images && images.length > 0) {
      images.forEach((imageUrl) => {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.className = "screenshot-thumb";

        // Register this image for lightbox navigation
        const imageIndex = lightboxImages.length;
        lightboxImages.push(imageUrl);
        img.addEventListener("click", (e) => {
          e.stopPropagation();
          openLightbox(imageIndex);
        });

        contentDiv.appendChild(img);
      });
    }

    // Add small chips for any attached (non-image) files
    if (files && files.length > 0) {
      files.forEach((file) => {
        const chip = document.createElement("span");
        chip.className = "file-chip";
        chip.textContent = file.name;
        chip.title = file.name;
        contentDiv.appendChild(chip);
      });
    }

    // Add model indicator + copy button for assistant messages
    if (!isUser && model) {
      appendAssistantFooter(contentDiv, content, model);
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
      } else {
        // Otherwise scroll to bottom for new messages
        scrollToBottom();
      }
    }, 10);
  }
});
