// Minimal self-check for the pure web-search formatting logic in
// src/modules/api.js. The module has no imports, so it's copied to a temp
// .mjs (node treats bare .js as CommonJS in this package) and imported from
// there. Run with: npm test
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const src = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/modules/api.js",
);
const tmpDir = mkdtempSync(join(tmpdir(), "grok-check-"));
const tmp = join(tmpDir, "api.mjs");
copyFileSync(src, tmp);

const { formatSearchResults, readStream } = await import(tmp);
rmSync(tmpDir, { recursive: true, force: true });

assert.equal(formatSearchResults([]), "No results found.");
assert.equal(formatSearchResults(null), "No results found.");
assert.equal(formatSearchResults("error string"), "No results found.");

const results = [
  { title: "Ollama", url: "https://ollama.com/", content: "Cloud models..." },
  { title: "", url: "https://b.example/", content: "x".repeat(1500) },
];
const out = formatSearchResults(results);
assert.ok(out.startsWith("1. Ollama — https://ollama.com/\nCloud models..."));
assert.ok(out.includes("2. Untitled — https://b.example/"));
assert.ok(out.length < 2100, "per-result snippet must be capped");

// 9 results × 1000-char snippets exceeds the 8000-char total ceiling
const many = Array.from({ length: 9 }, (_, i) => ({
  title: `r${i}`,
  url: `https://e/${i}`,
  content: "y".repeat(1000),
}));
assert.ok(
  formatSearchResults(many).length <= 8000,
  "total output must be capped",
);

// readStream: parallel tool_calls in one response must accumulate per
// stream index. Previously their arguments were concatenated into one
// corrupt blob and JSON.parse threw "Unexpected non-whitespace character
// after JSON" — killing the whole reply.
function fakeResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    body: {
      getReader() {
        return {
          read: async () =>
            i < chunks.length
              ? { done: false, value: enc.encode(chunks[i++]) }
              : { done: true },
          releaseLock() {},
        };
      },
    },
  };
}

const sseChunks = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"web_search","arguments":"{\\"query\\":"}}]}}]}\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"glm-5.3 flash\\"}"}}]}}]}\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call-2","function":{"name":"fetch_url","arguments":"{\\"url\\":\\"https://example.com\\"}"}}]}}]}\n',
  "data: [DONE]\n",
];
const { toolCalls } = await readStream(
  fakeResponse(sseChunks),
  "test",
  () => {},
);
assert.equal(toolCalls.length, 2, "parallel tool calls must not be merged");
assert.equal(toolCalls[0].id, "call-1");
assert.equal(toolCalls[0].name, "web_search");
assert.deepEqual(JSON.parse(toolCalls[0].args), { query: "glm-5.3 flash" });
assert.equal(toolCalls[1].id, "call-2");
assert.equal(toolCalls[1].name, "fetch_url");
assert.deepEqual(JSON.parse(toolCalls[1].args), {
  url: "https://example.com",
});

console.log("check-websearch: all assertions passed");