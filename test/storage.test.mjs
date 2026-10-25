import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { importSrcModules } from "../scripts/load-src.mjs";

describe("storage", () => {
  let store;
  let currentTabId;

  beforeEach(() => {
    store = Object.create(null);
    currentTabId = 1;
    global.chrome = {
      storage: {
        local: {
          get: (keys, cb) => {
            if (keys === null) {
              cb({ ...store });
              return;
            }
            if (typeof keys === "string") {
              cb({ [keys]: store[keys] });
              return;
            }
            if (Array.isArray(keys)) {
              const out = {};
              keys.forEach((k) => { if (k in store) out[k] = store[k]; });
              cb(out);
              return;
            }
            if (keys && typeof keys === "object") {
              const out = { ...keys };
              Object.keys(keys).forEach((k) => { if (k in store) out[k] = store[k]; });
              cb(out);
              return;
            }
            cb({ ...store });
          },
          set: async (obj) => {
            Object.assign(store, obj);
          },
          remove: (keys, cb) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach((k) => delete store[k]);
            if (typeof cb === "function") cb();
          },
        },
      },
    };
  });

  it("limits message history", async () => {
    const { storage } = await importSrcModules(["storage"]);
    const s = storage.createStorage({
      currentTabId: () => currentTabId,
      conversationHistory: () => [],
      MAX_MESSAGES_PER_TAB: 2,
      MAX_TABS_TO_STORE: 1,
    });
    assert.deepEqual(s.limitMessageHistory([1, 2, 3, 4]), [3, 4]);
  });

  it("strips images when saving conversation history", async () => {
    const history = [{ content: "hi", images: ["data:image/png;base64,abc"], role: "user" }];
    const { storage } = await importSrcModules(["storage"]);
    const s = storage.createStorage({
      currentTabId: () => currentTabId,
      conversationHistory: () => history,
      MAX_MESSAGES_PER_TAB: 10,
      MAX_TABS_TO_STORE: 10,
    });
    await s.saveConversationHistory();
    assert.deepEqual(store.conversationHistory_1, [{ content: "hi", role: "user" }]);
  });

  it("cleans up old conversations beyond the store limit", async () => {
    store.conversationHistory_1 = [{ content: "one" }];
    store.conversationHistory_2 = [{ content: "two" }];
    store.conversationHistory_3 = [{ content: "three" }];
    const { storage } = await importSrcModules(["storage"]);
    const s = storage.createStorage({
      currentTabId: () => currentTabId,
      conversationHistory: () => [],
      MAX_MESSAGES_PER_TAB: 10,
      MAX_TABS_TO_STORE: 1,
    });
    await s.cleanupOldConversations();
    const keys = Object.keys(store).filter((k) => k.startsWith("conversationHistory_"));
    assert.equal(keys.length, 1);
    assert.ok(store.conversationHistory_3);
  });

  it("does nothing when current tab is missing", async () => {
    currentTabId = null;
    const history = [{ content: "hi" }];
    const { storage } = await importSrcModules(["storage"]);
    const s = storage.createStorage({
      currentTabId: () => currentTabId,
      conversationHistory: () => history,
      MAX_MESSAGES_PER_TAB: 10,
      MAX_TABS_TO_STORE: 10,
    });
    await s.saveConversationHistory();
    assert.equal(Object.keys(store).length, 0);
  });
});