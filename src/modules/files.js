// Max file size accepted by xAI's Files API
export const MAX_FILE_SIZE = 48 * 1024 * 1024;

export async function uploadFile(apiKey, file) {
  const formData = new FormData();
  formData.append("purpose", "assistants");
  formData.append("expires_after", "86400"); // 24h — long enough to survive a multi-turn conversation
  formData.append("file", file, file.name);

  const response = await fetch("https://api.x.ai/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.text();
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorData);
      errorMessage =
        errorJson.error?.message || errorJson.message || "File upload failed";
    } catch {
      errorMessage =
        errorData || `File upload failed with status ${response.status}`;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
