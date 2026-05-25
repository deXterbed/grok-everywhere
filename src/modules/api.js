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
  try {
    let apiModel;
    if (model === "Grok Vision" || model === "grok-2-vision") {
      apiModel = "grok-2-vision";
    } else {
      apiModel = "grok-3-mini";
    }

    const messages = [
      {
        role: "system",
        content:
          "You are Grok, a helpful AI assistant created by xAI. You will be provided context from the user's current webpage to help answer their questions more effectively. Focus on the main content, articles, text, and meaningful information from the webpage. Provide clear, concise responses that directly address the user's question based on the webpage content.",
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

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      }),
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
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return fullContent;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                onStream(streamingMessageId, fullContent);
              }
            } catch {
              // Ignore partial JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullContent;
  } catch (error) {
    const errorMessage = error.message || "An unknown error occurred";
    onStream(streamingMessageId, `Error: ${errorMessage}`);
    throw error;
  }
}
