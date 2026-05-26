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

async function callApi(apiKey, model, messages, tools) {
  const body = { model, messages, temperature: 0.7, max_tokens: 4096, stream: true };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
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
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorData);
      errorMessage = errorJson.error?.message || errorJson.message || "API request failed";
    } catch {
      errorMessage = errorData || `API request failed with status ${response.status}`;
    }
    throw new Error(errorMessage);
  }
  return response;
}

async function readStream(response, streamingMessageId, onStream) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let toolCall = null;

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
        if (data === "[DONE]") return { content: fullContent, toolCall };
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onStream(streamingMessageId, fullContent);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCall) toolCall = { id: tc.id || "", name: tc.function?.name || "", args: "" };
              if (tc.id) toolCall.id = tc.id;
              if (tc.function?.name) toolCall.name = tc.function.name;
              if (tc.function?.arguments) toolCall.args += tc.function.arguments;
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

  return { content: fullContent, toolCall };
}

async function fetchUrl(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "fetchUrl", url }, (response) => {
      if (chrome.runtime.lastError || response?.error) {
        resolve(`Error fetching URL: ${chrome.runtime.lastError?.message || response?.error}`);
      } else {
        resolve(response?.content || "No content found at this URL.");
      }
    });
  });
}

export async function fetchStreamingReply({
  message,
  screenshot,
  content,
  streamingMessageId,
  model,
  apiKey,
  conversationHistory,
  onStream,
}) {
  const apiModel =
    model === "Grok Vision" || model === "grok-2-vision" ? "grok-2-vision" : "grok-3-mini";

  const messages = [
    {
      role: "system",
      content:
        "You are Grok, a helpful AI assistant created by xAI. You will be provided context from the user's current webpage to help answer their questions more effectively. Focus on the main content, articles, text, and meaningful information from the webpage. Provide clear, concise responses that directly address the user's question based on the webpage content. When the user mentions a specific URL and wants you to read or check it, use the fetch_url tool.",
    },
  ];

  conversationHistory.forEach((msg) => {
    if (msg.isUser) {
      if (msg.screenshot && apiModel === "grok-2-vision") {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: msg.content },
            { type: "image_url", image_url: { url: msg.screenshot } },
          ],
        });
      } else {
        messages.push({ role: "user", content: msg.content });
      }
    } else {
      messages.push({ role: "assistant", content: msg.content });
    }
  });

  if (screenshot && apiModel === "grok-2-vision") {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "This is a screenshot of my current browser view:" },
        { type: "image_url", image_url: { url: screenshot } },
      ],
    });
  } else if (content) {
    messages.push({
      role: "user",
      content: `Here is the content from my current webpage:\n\n${content}\n\nPlease use this context to help answer my question. If I ask for a summary, summarize the main content from this webpage.`,
    });
  } else if (screenshot && apiModel === "grok-3-mini") {
    messages.push({
      role: "user",
      content:
        "I have a screenshot of my current browser view, but I'll describe it instead since this model doesn't support images.",
    });
  }

  messages.push({ role: "user", content: message });

  const tools = apiModel === "grok-3-mini" ? [FETCH_URL_TOOL] : [];
  const response1 = await callApi(apiKey, apiModel, messages, tools);
  const { content: content1, toolCall } = await readStream(response1, streamingMessageId, onStream);

  if (!toolCall) return content1;

  // Tool call: fetch the URL and stream the final answer
  const { url } = JSON.parse(toolCall.args);
  onStream(streamingMessageId, `Fetching ${url}...`);

  const urlContent = await fetchUrl(url);

  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: toolCall.id,
        type: "function",
        function: { name: toolCall.name, arguments: toolCall.args },
      },
    ],
  });
  messages.push({ role: "tool", tool_call_id: toolCall.id, content: urlContent });

  const response2 = await callApi(apiKey, apiModel, messages, []);
  const { content: content2 } = await readStream(response2, streamingMessageId, onStream);
  return content2;
}
