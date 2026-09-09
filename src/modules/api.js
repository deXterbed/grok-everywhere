const FETCH_URL_TOOL = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch and read the text content of a webpage. Use this when the user mentions a specific URL and wants you to read, check, visit, or analyze that page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to fetch" },
      },
      required: ["url"],
    },
  },
};

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Use this for questions about recent events, current facts, or anything you are unsure about.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query string" },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 5, max 10)",
        },
      },
      required: ["query"],
    },
  },
};

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[),.]+$/, "") : null;
}

export function modelSupportsVision(modelId) {
  // Vision-capable Grok models — checked against xAI docs
  const visionModels = [
    "grok-4.3",
    "grok-build-0.1",
    "grok-2-vision",
    "grok-vision-beta",
  ];
  return visionModels.includes(modelId);
}

export function parseApiError(errorData, fallback) {
  try {
    const errorJson = JSON.parse(errorData);
    return errorJson.error?.message || errorJson.message || fallback;
  } catch {
    return errorData || fallback;
  }
}

async function callApi(apiKey, model, messages, tools, toolChoice = "auto") {
  const body = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(
      parseApiError(errorData, `API request failed with status ${response.status}`),
    );
  }
  return response;
}

export async function readStream(response, streamingMessageId, onStream) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  // Tool calls accumulate keyed by their stream index — the model can emit
  // several in parallel (e.g. two web_searches for an "X vs Y" question),
  // and their argument chunks interleave. Concatenating them into one call
  // corrupts the JSON ("Unexpected non-whitespace character after JSON").
  const toolCalls = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]")
          return { content: fullContent, toolCalls: toolCalls.filter(Boolean) };
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onStream(streamingMessageId, fullContent);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx])
                toolCalls[idx] = { id: "", name: "", args: "" };
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments)
                toolCalls[idx].args += tc.function.arguments;
            }
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullContent, toolCalls: toolCalls.filter(Boolean) };
}

async function fetchUrl(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "fetchUrl", url }, (response) => {
      if (chrome.runtime.lastError || response?.error) {
        resolve(
          `Error fetching URL: ${chrome.runtime.lastError?.message || response?.error}`,
        );
      } else {
        resolve(response?.content || "No content found at this URL.");
      }
    });
  });
}

// Ollama's hosted web search API (https://docs.ollama.com/capabilities/web-search),
// routed through the background service worker like fetchUrl. Snippets are
// capped per result and overall — search results can be huge, and tool input
// eats into the model's reply budget.
const MAX_SNIPPET_CHARS = 1000;
const MAX_RESULTS_CHARS = 8000;

export function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "No results found.";
  }
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title || "Untitled"} — ${r.url}\n${(r.content || "").slice(0, MAX_SNIPPET_CHARS)}`,
    )
    .join("\n\n");
  return formatted.slice(0, MAX_RESULTS_CHARS);
}

async function webSearch(query, maxResults, ollamaApiKey) {
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "webSearch", query, maxResults, apiKey: ollamaApiKey },
      (r) => resolve(r),
    );
  });
  if (chrome.runtime.lastError || response?.error) {
    return `Error searching the web: ${chrome.runtime.lastError?.message || response?.error}`;
  }
  return formatSearchResults(response?.results);
}

export async function fetchStreamingReply({
  message,
  images,
  content,
  streamingMessageId,
  model,
  apiKey,
  ollamaApiKey,
  webSearchEnabled,
  conversationHistory,
  onStream,
}) {
  const supportsVision = modelSupportsVision(model);

  // web_search needs its own Ollama API key (separate from xAI) and is off
  // by default — only mention it to the model when it will actually be
  // offered, otherwise it may pretend to search.
  const searchOn = Boolean(webSearchEnabled && ollamaApiKey);

  // Models don't know today's date and will hallucinate it when asked
  // directly (e.g. answered "October 10, 2025" for "today's date?") instead
  // of calling web_search — inject it so date questions never depend on the
  // model choosing to search.
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const messages = [
    {
      role: "system",
      content:
        `You are Grok, a helpful AI assistant created by xAI. Today's date is ${today}. You will be provided context from the user's current webpage to help answer their questions more effectively. Focus on the main content, articles, text, and meaningful information from the webpage. Provide clear, concise responses that directly address the user's question based on the webpage content. You have a fetch_url tool that reads the live content of any webpage — you are not limited to prior knowledge or a training cutoff for this. Whenever the user's message contains or references a specific URL, always call fetch_url to read it before answering; never claim you can't browse or access the internet.` +
        (searchOn
          ? " You also have a web_search tool that queries the live web — use it when the user asks about recent events, current facts, or anything you are not certain about, and cite the source URLs in your answer."
          : ""),
    },
  ];

  // The current turn was already pushed to conversationHistory by
  // sendMessage; only iterate previous history here so we don't duplicate
  // the current message/images in the API request.
  const previousHistory = conversationHistory.slice(0, -1);
  previousHistory.forEach((msg) => {
    if (msg.isUser) {
      if (msg.images && msg.images.length && supportsVision) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: msg.content },
            ...msg.images.map((img) => ({
              type: "image_url",
              image_url: { url: img },
            })),
          ],
        });
      } else {
        messages.push({ role: "user", content: msg.content });
      }
    } else {
      messages.push({ role: "assistant", content: msg.content });
    }
  });

  if (images && images.length && supportsVision) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: "Here are images I've attached:",
        },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: img },
        })),
      ],
    });
  } else if (content) {
    messages.push({
      role: "user",
      content: `Here is the content from my current webpage:\n\n${content}\n\nPlease use this context to help answer my question. If I ask for a summary, summarize the main content from this webpage.`,
    });
  } else if (images && images.length && !supportsVision) {
    messages.push({
      role: "user",
      content:
        "I have attached images, but I'll describe them instead since this model doesn't support images.",
    });
  }

  // Whether THIS turn is actually sending an image — not whether the
  // selected model merely supports vision. grok-4.3 is vision-capable and
  // is the default for both textModel and visionModel, so gating on
  // supportsVision alone would strip fetch_url from every plain-text
  // conversation on the default model, even with zero images attached.
  const hasImagesThisTurn = Boolean(images && images.length);

  // Models sometimes decline with a canned "I can't browse the web" reply
  // instead of calling the fetch_url tool when it's left to their discretion
  // (even with tool_choice forced to it) — so when the user's message itself
  // contains a URL, fetch it deterministically and inject the content,
  // rather than hoping the model calls the tool.
  const urlInMessage = !hasImagesThisTurn ? extractFirstUrl(message) : null;
  if (urlInMessage) {
    onStream(streamingMessageId, `Fetching ${urlInMessage}...`);
    const urlContent = await fetchUrl(urlInMessage);
    messages.push({
      role: "user",
      content: `Here is the content fetched from ${urlInMessage}:\n\n${urlContent}\n\nUse this to answer my question below.`,
    });
  }

  messages.push({ role: "user", content: message });

  const tools = hasImagesThisTurn
    ? []
    : searchOn
      ? [FETCH_URL_TOOL, WEB_SEARCH_TOOL]
      : [FETCH_URL_TOOL];

  // Tool loop: each round either produces the final answer or requests
  // tool call(s), whose results are appended before the next call — so the
  // model can chain (e.g. web_search, then fetch_url on a result link).
  // Capped to bound cost and runaway loops.
  const MAX_TOOL_ROUNDS = 4;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await callApi(apiKey, model, messages, tools);
    const { content, toolCalls } = await readStream(
      response,
      streamingMessageId,
      onStream,
    );

    if (toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) return content;

    const toolResults = [];
    for (const toolCall of toolCalls) {
      // A malformed single call shouldn't kill the whole reply — report the
      // failure back as the tool result so the model can recover.
      let toolResult;
      try {
        if (toolCall.name === "web_search") {
          const { query, max_results } = JSON.parse(toolCall.args);
          onStream(streamingMessageId, `Searching the web for "${query}"...`);
          toolResult = await webSearch(query, max_results, ollamaApiKey);
        } else {
          const { url } = JSON.parse(toolCall.args);
          onStream(streamingMessageId, `Fetching ${url}...`);
          toolResult = await fetchUrl(url);
        }
      } catch (err) {
        toolResult = `Error running ${toolCall.name}: ${err.message}`;
      }
      toolResults.push(toolResult);
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.args },
      })),
    });
    toolCalls.forEach((tc, i) => {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResults[i],
      });
    });
  }
}
