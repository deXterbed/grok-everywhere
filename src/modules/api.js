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
              if (!toolCall)
                toolCall = {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  args: "",
                };
              if (tc.id) toolCall.id = tc.id;
              if (tc.function?.name) toolCall.name = tc.function.name;
              if (tc.function?.arguments)
                toolCall.args += tc.function.arguments;
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
        resolve(
          `Error fetching URL: ${chrome.runtime.lastError?.message || response?.error}`,
        );
      } else {
        resolve(response?.content || "No content found at this URL.");
      }
    });
  });
}

export async function fetchStreamingReply({
  message,
  images,
  content,
  streamingMessageId,
  model,
  apiKey,
  conversationHistory,
  onStream,
}) {
  const supportsVision = modelSupportsVision(model);

  const messages = [
    {
      role: "system",
      content:
        "You are Grok, a helpful AI assistant created by xAI. You will be provided context from the user's current webpage to help answer their questions more effectively. Focus on the main content, articles, text, and meaningful information from the webpage. Provide clear, concise responses that directly address the user's question based on the webpage content. You have a fetch_url tool that reads the live content of any webpage — you are not limited to prior knowledge or a training cutoff for this. Whenever the user's message contains or references a specific URL, always call fetch_url to read it before answering; never claim you can't browse or access the internet.",
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

  const tools = hasImagesThisTurn ? [] : [FETCH_URL_TOOL];
  const response1 = await callApi(apiKey, model, messages, tools);
  const { content: content1, toolCall } = await readStream(
    response1,
    streamingMessageId,
    onStream,
  );

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
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: urlContent,
  });

  const response2 = await callApi(apiKey, model, messages, []);
  const { content: content2 } = await readStream(
    response2,
    streamingMessageId,
    onStream,
  );
  return content2;
}
