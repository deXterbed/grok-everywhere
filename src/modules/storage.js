export function createStorage({ currentTabId, conversationHistory, MAX_MESSAGES_PER_TAB, MAX_TABS_TO_STORE }) {
  function cleanupOldConversations() {
    chrome.storage.local.get(null, (result) => {
      const conversationKeys = Object.keys(result).filter((key) =>
        key.startsWith("conversationHistory_"),
      );

      if (conversationKeys.length > MAX_TABS_TO_STORE) {
        const sortedKeys = conversationKeys.sort((a, b) => {
          const tabIdA = parseInt(a.replace("conversationHistory_", ""));
          const tabIdB = parseInt(b.replace("conversationHistory_", ""));
          return tabIdA - tabIdB;
        });

        const keysToRemove = sortedKeys.slice(
          0,
          conversationKeys.length - MAX_TABS_TO_STORE,
        );
        chrome.storage.local.remove(keysToRemove);
      }
    });
  }

  function limitMessageHistory(history) {
    if (history.length > MAX_MESSAGES_PER_TAB) {
      return history.slice(-MAX_MESSAGES_PER_TAB);
    }
    return history;
  }

  async function saveConversationHistory() {
    if (!currentTabId()) return;
    const sanitized = conversationHistory().map((msg) => {
      const { screenshot, ...rest } = msg;
      return rest;
    });
    await chrome.storage.local.set({
      [`conversationHistory_${currentTabId()}`]: sanitized,
    });
  }

  return { cleanupOldConversations, limitMessageHistory, saveConversationHistory };
}
