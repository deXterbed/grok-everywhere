// xAI's file-attachment support (input_file / attachment_search) only exists on the
// /v1/responses endpoint, not /v1/chat/completions — see CLAUDE.md "Attachments" section.
// Its request/response shape mirrors OpenAI's Responses API.

// Recommended by xAI's docs as the agentic-capable model for file attachments.
export const FILE_MODEL = "grok-4.5";

const SYSTEM_INSTRUCTIONS =
  "You are Grok, a helpful AI assistant created by xAI. The user has attached one or more files to this conversation — use them to answer their questions.";

import { parseApiError } from "./api.js";

async function callResponsesApi(apiKey, input) {
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: FILE_MODEL,
      instructions: SYSTEM_INSTRUCTIONS,
      input,
      stream: true,
    }),
  });
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(
      parseApiError(errorData, `API request failed with status ${response.status}`),
    );
  }
  return response;
}

async function readResponsesStream(response, streamingMessageId, onStream) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

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
        if (data === "[DONE]") return fullContent;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // ignore partial JSON chunks
        }
        if (parsed.type === "response.output_text.delta" && parsed.delta) {
          fullContent += parsed.delta;
          onStream(streamingMessageId, fullContent);
        } else if (parsed.type === "response.failed") {
          throw new Error(parsed.response?.error?.message || "Response failed");
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullContent;
}

// Builds the full "input" array from conversation history (which already
// includes the current turn — see sendMessage in sidepanel.js) and streams
// a reply. Images are included as input_image parts alongside input_file.
export async function fetchFileResponse({
  streamingMessageId,
  apiKey,
  conversationHistory,
  onStream,
}) {
  const input = [];

  conversationHistory.forEach((msg) => {
    if (msg.isUser) {
      const parts = [];
      if (msg.content) parts.push({ type: "input_text", text: msg.content });
      if (msg.images && msg.images.length) {
        msg.images.forEach((img) =>
          parts.push({ type: "input_image", image_url: img }),
        );
      }
      if (msg.files && msg.files.length) {
        msg.files.forEach((f) =>
          parts.push({ type: "input_file", file_id: f.fileId }),
        );
      }
      input.push({ role: "user", content: parts });
    } else {
      input.push({
        role: "assistant",
        content: [{ type: "output_text", text: msg.content }],
      });
    }
  });

  const response = await callResponsesApi(apiKey, input);
  return readResponsesStream(response, streamingMessageId, onStream);
}
