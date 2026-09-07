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

let loginAbort = null;

export function isOAuthToken(token) {
  return typeof token === "string" && token.split(".").length === 3;
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

async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error(OAUTH_403_MESSAGE);
    throw new Error(
      `xAI token refresh failed (${response.status}): ${await readError(response)}`,
    );
  }
  return response.json();
}

async function ensureFreshSession(session) {
  const expiring =
    !session.expiresAt || session.expiresAt - Date.now() <= REFRESH_SKEW_MS;
  if (!expiring) return session;
  if (!session.refreshToken) {
    throw new Error("SuperGrok session expired. Sign in again, or enter an API key.");
  }
  const next = toSession(await refreshAccessToken(session.refreshToken), session.refreshToken);
  await chrome.storage.local.set({ xaiOAuth: next });
  return next;
}

export async function getBearerToken() {
  const data = await chrome.storage.local.get(["authMode", "xaiOAuth", "xaiApiKey"]);
  const mode = data.authMode || AUTH_MODE_API_KEY;
  if (mode === AUTH_MODE_OAUTH && data.xaiOAuth?.accessToken) {
    try {
      const session = await ensureFreshSession(data.xaiOAuth);
      return session.accessToken;
    } catch (error) {
      if (data.xaiApiKey) {
        await chrome.storage.local.set({ authMode: AUTH_MODE_API_KEY });
        return data.xaiApiKey;
      }
      throw error;
    }
  }
  return data.xaiApiKey || null;
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
