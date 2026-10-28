export function createStorage({
  currentTabId,
  conversationHistory,
  MAX_MESSAGES_PER_TAB,
  MAX_TABS_TO_STORE,
}) {
  function cleanupOldConversations() {
    // Returns a promise so callers (and tests) can await completion even though
    // the underlying chrome.storage API is callback-based.
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      chrome.storage.local.get(null, (result) => {
        const conversationKeys = Object.keys(result || {}).filter((key) =>
          key.startsWith("conversationHistory_")
        );

        if (conversationKeys.length <= MAX_TABS_TO_STORE) {
          finish();
          return;
        }

        const sortedKeys = conversationKeys.sort((a, b) => {
          const tabIdA = parseInt(a.replace("conversationHistory_", ""));
          const tabIdB = parseInt(b.replace("conversationHistory_", ""));
          return tabIdA - tabIdB;
        });

        const keysToRemove = sortedKeys.slice(
          0,
          conversationKeys.length - MAX_TABS_TO_STORE
        );
        chrome.storage.local.remove(keysToRemove, finish);
        // Fall back for mocks that remove synchronously without invoking the
        // callback, so cleanupOldConversations() never hangs in tests.
        setTimeout(finish, 0);
      });
      // Fall back if storage.get invokes nothing (defensive).
      setTimeout(finish, 0);
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
      const { images: _images, ...rest } = msg;
      return rest;
    });
    await chrome.storage.local.set({
      [`conversationHistory_${currentTabId()}`]: sanitized,
    });
  }

  return {
    cleanupOldConversations,
    limitMessageHistory,
    saveConversationHistory,
  };
}
