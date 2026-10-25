import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { importSrcModules } from "../scripts/load-src.mjs";

const { api } = await importSrcModules(["auth", "api"]);
const { formatSearchResults, readStream, extractFirstUrl, modelSupportsVision, MAX_SNIPPET_CHARS, MAX_RESULTS_CHARS } = api;

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

describe("web search formatting", () => {
  it("handles empty results", () => {
    assert.equal(formatSearchResults([]), "No results found.");
    assert.equal(formatSearchResults(null), "No results found.");
    assert.equal(formatSearchResults("error string"), "No results found.");
  });

  it("caps snippets and total output", () => {
    const results = [
      { title: "Ollama", url: "https://ollama.com/", content: "Cloud models..." },
      { title: "", url: "https://b.example/", content: "x".repeat(1500) },
    ];
    const out = formatSearchResults(results);
    assert.ok(out.startsWith("1. Ollama — https://ollama.com/\nCloud models..."));
    assert.ok(out.includes("2. Untitled — https://b.example/"));
    assert.ok(out.length < 2100, "per-result snippet must be capped");

    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `r${i}`,
      url: `https://e/${i}`,
      content: "y".repeat(1000),
    }));
    assert.ok(formatSearchResults(many).length <= MAX_RESULTS_CHARS, "total output must be capped");
    assert.ok(MAX_SNIPPET_CHARS === 1000);
    assert.ok(MAX_RESULTS_CHARS === 8000);
  });
});

describe("tool execution helpers", () => {
  it("extracts first url and strips trailing punctuation", () => {
    assert.equal(extractFirstUrl("See https://example.com/path."), "https://example.com/path");
    assert.equal(extractFirstUrl("no url here"), null);
  });

  it("reports vision capability", () => {
    assert.equal(modelSupportsVision("grok-4.3"), true);
    assert.equal(modelSupportsVision("unknown-model"), false);
  });

  it("accumulates parallel tool calls by stream index", async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"web_search","arguments":"{\\"query\\":"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"glm-5.3 flash\\"}"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call-2","function":{"name":"fetch_url","arguments":"{\\"url\\":\\"https://example.com\\"}"}}]}}]}\n',
      "data: [DONE]\n",
    ];
    const { toolCalls } = await readStream(fakeResponse(sseChunks), "test", () => {});
    assert.equal(toolCalls.length, 2, "parallel tool calls must not be merged");
    assert.equal(toolCalls[0].id, "call-1");
    assert.equal(toolCalls[0].name, "web_search");
    assert.deepEqual(JSON.parse(toolCalls[0].args), { query: "glm-5.3 flash" });
    assert.equal(toolCalls[1].id, "call-2");
    assert.equal(toolCalls[1].name, "fetch_url");
    assert.deepEqual(JSON.parse(toolCalls[1].args), { url: "https://example.com" });
  });
});