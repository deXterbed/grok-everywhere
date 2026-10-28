import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { importSrcModules } from "../scripts/load-src.mjs";

const body = JSON.stringify({ error: { message: "nope" } });

function err(fields) {
  return Object.assign(new Error("x"), fields);
}

describe("auth helpers", () => {
  it("maps OAuth 403 messages based on oauth flag", async () => {
    const { api, auth } = await importSrcModules(["auth", "api"]);
    const { parseHttpError } = api;
    const { OAUTH_403_MESSAGE } = auth;
    assert.equal(
      parseHttpError(403, body, "fallback", { oauth: true }),
      OAUTH_403_MESSAGE
    );
    assert.equal(
      parseHttpError(403, body, "fallback", { oauth: false }),
      "nope"
    );
    assert.equal(
      parseHttpError(401, body, "fallback", { oauth: true }),
      "nope"
    );
    assert.equal(
      parseHttpError(500, "not-json", "fallback", { oauth: true }),
      "not-json"
    );
    assert.equal(parseHttpError(403, "", "fallback"), "fallback");
  });

  it("classifies refresh failures", async () => {
    const { auth } = await importSrcModules(["auth"]);
    const { isAuthRefreshFailure } = auth;
    assert.equal(
      isAuthRefreshFailure(err({ code: "invalid_grant", status: 400 })),
      true
    );
    assert.equal(
      isAuthRefreshFailure(err({ code: "invalid_token", status: 400 })),
      true
    );
    assert.equal(
      isAuthRefreshFailure(err({ code: "invalid_client", status: 401 })),
      true
    );
    assert.equal(isAuthRefreshFailure(err({ status: 401 })), true);
    assert.equal(isAuthRefreshFailure(err({ status: 403 })), true);
    assert.equal(
      isAuthRefreshFailure(err({ status: 500, transient: true })),
      false
    );
    assert.equal(
      isAuthRefreshFailure(err({ status: 429, transient: true })),
      false
    );
    assert.equal(
      isAuthRefreshFailure(err({ status: 408, transient: true })),
      false
    );
    assert.equal(
      isAuthRefreshFailure(err({ status: 400, code: "server_error" })),
      false
    );
    assert.equal(isAuthRefreshFailure(new TypeError("Failed to fetch")), false);
    assert.equal(isAuthRefreshFailure(null), false);
  });

  it("builds a session from tokens", async () => {
    const { auth } = await importSrcModules(["auth"]);
    const { toSession } = auth;
    const session = toSession(
      { access_token: "abc", refresh_token: "ref", expires_in: 10 },
      "fallback"
    );
    assert.equal(session.accessToken, "abc");
    assert.equal(session.refreshToken, "ref");
    assert.ok(session.expiresAt > Date.now());
  });

  it("treats fresh sessions correctly", async () => {
    const { auth } = await importSrcModules(["auth"]);
    const { sessionIsFresh } = auth;
    assert.equal(
      sessionIsFresh({ accessToken: "a", expiresAt: Date.now() + 600000 }),
      true
    );
    assert.equal(
      sessionIsFresh({ accessToken: "a", expiresAt: Date.now() + 1000 }),
      false
    );
    assert.equal(sessionIsFresh(null), false);
  });
});

describe("auth flows", () => {
  beforeEach(() => {
    const store = {};
    global.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            if (Array.isArray(keys)) {
              const out = {};
              keys.forEach((k) => {
                if (k in store) out[k] = store[k];
              });
              return out;
            }
            if (typeof keys === "string") return { [keys]: store[keys] };
            if (keys && typeof keys === "object") {
              const out = { ...keys };
              Object.keys(keys).forEach((k) => {
                if (k in store) out[k] = store[k];
              });
              return out;
            }
            return { ...store };
          },
          set: async (obj) => {
            Object.assign(store, obj);
          },
          remove: async (keys) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach((k) => delete store[k]);
          },
        },
      },
    };
    globalThis.__authStore = store;
  });

  it("returns api key in api_key mode", async () => {
    const store = globalThis.__authStore;
    store.authMode = "api_key";
    store.xaiApiKey = "secret";
    const { auth } = await importSrcModules(["auth"]);
    const result = await auth.getBearerToken();
    assert.deepEqual(result, { token: "secret", oauth: false });
  });

  it("falls back to api key when OAuth session is missing token", async () => {
    const store = globalThis.__authStore;
    store.authMode = "oauth";
    store.xaiApiKey = "fallback-key";
    const { auth } = await importSrcModules(["auth"]);
    const result = await auth.getBearerToken();
    assert.deepEqual(result, { token: "fallback-key", oauth: false });
    assert.equal(store.authMode, "api_key");
  });

  it("refreshes an expired OAuth session", async () => {
    const store = globalThis.__authStore;
    store.authMode = "oauth";
    store.xaiOAuth = {
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: 0,
    };
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        access_token: "new-token",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
      text: async () => "",
    });
    try {
      const { auth } = await importSrcModules(["auth"]);
      const result = await auth.getBearerToken();
      assert.equal(result.token, "new-token");
      assert.equal(result.oauth, true);
      assert.equal(store.xaiOAuth.accessToken, "new-token");
      assert.equal(store.xaiOAuth.refreshToken, "new-refresh");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
