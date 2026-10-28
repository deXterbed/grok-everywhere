// Pure checks for SuperGrok refresh classification and the OAuth 403 message.
// Run with: npm test
import assert from "node:assert";
import { importSrcModules } from "./load-src.mjs";

const { api, auth } = await importSrcModules(["auth", "api"]);
const { parseHttpError } = api;
const { isAuthRefreshFailure, OAUTH_403_MESSAGE } = auth;

const body = JSON.stringify({ error: { message: "nope" } });

assert.equal(
  parseHttpError(403, body, "fallback", { oauth: true }),
  OAUTH_403_MESSAGE
);
assert.equal(parseHttpError(403, body, "fallback", { oauth: false }), "nope");
assert.equal(parseHttpError(401, body, "fallback", { oauth: true }), "nope");
assert.equal(
  parseHttpError(500, "not-json", "fallback", { oauth: true }),
  "not-json"
);
assert.equal(parseHttpError(403, "", "fallback"), "fallback");

function err(fields) {
  return Object.assign(new Error("x"), fields);
}

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

console.log("check-auth: all assertions passed");
