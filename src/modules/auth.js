// Optional SuperGrok OAuth. Device-code (RFC 8628) against the public Grok CLI
// client — the CLI also supports PKCE loopback on 127.0.0.1:56121, which a
// Chrome extension cannot bind. API-key auth remains the default and fallback.

export const AUTH_MODE_API_KEY = "api_key";
export const AUTH_MODE_OAUTH = "oauth";

export const OAUTH_403_MESSAGE =
  "xAI returned 403. SuperGrok OAuth is not entitled for api.x.ai on this account. This is not retried. Use an xAI API key, or confirm SuperGrok / X Premium+ is active.";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 1000;
const SLOW_DOWN_MS = 5000;
const DEFAULT_EXPIRES_MS = 5 * 60 * 1000;

const AUTH_REFRESH_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_token",
  "invalid_client",
]);

let loginAbort = null;
let refreshInFlight = null;

// True only when the refresh token itself was rejected. Network failures,
// 408/429/5xx, and anything else must not log the user out of SuperGrok.
export function isAuthRefreshFailure(error) {
  if (!error || error.transient) return false;
  if (error.name === "TypeError" || error.name === "AbortError") return false;
  if (AUTH_REFRESH_ERROR_CODES.has(error.code)) return true;
  return error.status === 401 || error.status === 403;
}

export function cancelDeviceLogin() {
  loginAbort?.abort();
  loginAbort = null;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Login cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Login cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function positiveSecondsToMs(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

function toSession(tokens, fallbackRefresh = "") {
  if (!tokens?.access_token) throw new Error("xAI token response missing access_token");
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || fallbackRefresh,
    expiresAt: Date.now() + (tokens.expires_in > 0 ? tokens.expires_in : 3600) * 1000,
  };
}

async function readError(response) {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.error_description || json.error || json.message || text;
  } catch {
    return text;
  }
}

async function requestDeviceCode(signal) {
  const response = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
      referrer: "grok-everywhere",
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `xAI device code request failed (${response.status}): ${await readError(response)}`,
    );
  }
  const device = await response.json();
  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error("xAI device code response was malformed");
  }
  return device;
}

async function pollDeviceCodeToken(device, signal) {
  const deadline = Date.now() + positiveSecondsToMs(device.expires_in, DEFAULT_EXPIRES_MS);
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEFAULT_INTERVAL_MS),
    MIN_INTERVAL_MS,
  );

  while (Date.now() < deadline) {
    await sleep(intervalMs, signal);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }),
      signal,
    });
    if (response.ok) return response.json();

    const body = await response.json().catch(() => ({}));
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      intervalMs += SLOW_DOWN_MS;
      continue;
    }
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("SuperGrok authorization was denied");
    }
    if (body.error === "expired_token") {
      throw new Error("SuperGrok device code expired. Sign in again.");
    }
    throw new Error(
      `xAI device token exchange failed (${response.status}): ${body.error_description || body.error || ""}`,
    );
  }
  throw new Error("SuperGrok authorization timed out");
}

function refreshError(message, status, code, transient) {
  const error = new Error(message);
  error.status = status;
  error.code = code || "";
  error.transient = Boolean(transient);
  return error;
}

async function refreshAccessToken(refreshToken) {
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });
  } catch (error) {
    throw refreshError(
      error?.message || "xAI token refresh failed",
      0,
      "",
      true,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    const code = typeof body.error === "string" ? body.error : "";
    const transient =
      response.status === 408 || response.status === 429 || response.status >= 500;
    const detail = body.error_description || code || text;
    const message =
      response.status === 403
        ? OAUTH_403_MESSAGE
        : `xAI token refresh failed (${response.status}): ${detail}`;
    throw refreshError(message, response.status, code, transient);
  }
  return response.json();
}

function sessionIsFresh(session) {
  return Boolean(
    session?.accessToken &&
      session.expiresAt &&
      session.expiresAt - Date.now() > REFRESH_SKEW_MS,
  );
}

async function refreshAndStore(session) {
  const next = toSession(
    await refreshAccessToken(session.refreshToken),
    session.refreshToken,
  );
  await chrome.storage.local.set({ xaiOAuth: next });
  return next;
}

async function ensureFreshSession(session) {
  if (sessionIsFresh(session)) return session;
  if (!session?.refreshToken && !session?.accessToken) {
    throw refreshError(
      "SuperGrok session expired. Sign in again, or enter an API key.",
      401,
      "invalid_grant",
      false,
    );
  }
  // Assign before the first await so overlapping upload + send share one POST.
  // The body re-reads storage so a caller that still holds the pre-refresh
  // session does not send the rotated refresh token a second time.
  if (!refreshInFlight) {
    const pending = (async () => {
      const stored = await chrome.storage.local.get("xaiOAuth");
      const current = stored.xaiOAuth?.refreshToken ? stored.xaiOAuth : session;
      if (sessionIsFresh(current)) return current;
      if (!current?.refreshToken) {
        throw refreshError(
          "SuperGrok session expired. Sign in again, or enter an API key.",
          401,
          "invalid_grant",
          false,
        );
      }
      return refreshAndStore(current);
    })().finally(() => {
      if (refreshInFlight === pending) refreshInFlight = null;
    });
    refreshInFlight = pending;
  }
  return refreshInFlight;
}

async function fallBackToApiKey() {
  await chrome.storage.local.remove("xaiOAuth");
  await chrome.storage.local.set({ authMode: AUTH_MODE_API_KEY });
}

export async function getBearerToken() {
  const data = await chrome.storage.local.get(["authMode", "xaiOAuth", "xaiApiKey"]);
  const mode = data.authMode || AUTH_MODE_API_KEY;
  if (mode === AUTH_MODE_OAUTH) {
    if (!data.xaiOAuth?.accessToken) {
      if (data.xaiApiKey) {
        await fallBackToApiKey();
        return { token: data.xaiApiKey, oauth: false };
      }
      throw refreshError(
        "SuperGrok session expired. Sign in again, or enter an API key.",
        401,
        "invalid_grant",
        false,
      );
    }
    try {
      const session = await ensureFreshSession(data.xaiOAuth);
      return { token: session.accessToken, oauth: true };
    } catch (error) {
      if (isAuthRefreshFailure(error) && data.xaiApiKey) {
        await fallBackToApiKey();
        return { token: data.xaiApiKey, oauth: false };
      }
      throw error;
    }
  }
  return { token: data.xaiApiKey || null, oauth: false };
}

export async function startDeviceLogin(onDevice) {
  cancelDeviceLogin();
  const controller = new AbortController();
  loginAbort = controller;
  try {
    const device = await requestDeviceCode(controller.signal);
    onDevice?.(device);
    const url = device.verification_uri_complete || device.verification_uri;
    chrome.tabs.create({ url });
    const tokens = await pollDeviceCodeToken(device, controller.signal);
    const session = toSession(tokens);
    await chrome.storage.local.set({
      authMode: AUTH_MODE_OAUTH,
      xaiOAuth: session,
    });
    return session;
  } finally {
    if (loginAbort === controller) loginAbort = null;
  }
}

export async function logoutOAuth() {
  cancelDeviceLogin();
  await chrome.storage.local.remove("xaiOAuth");
  await chrome.storage.local.set({ authMode: AUTH_MODE_API_KEY });
}
