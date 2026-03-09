export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    throw new Error(
      (payload && typeof payload === "object" && "error" in payload && payload.error) ||
        "요청에 실패했습니다.",
    );
  }

  return payload as T;
}

export async function postJson<T>(url: string, body: unknown) {
  return fetchJson<T>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function deleteJson<T>(url: string) {
  return fetchJson<T>(url, {
    method: "DELETE",
  });
}

export async function postEventStream(
  url: string,
  body: unknown,
  options: {
    signal?: AbortSignal;
    onEvent: (event: string, data: unknown) => void;
  },
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "스트리밍 요청에 실패했습니다.");
  }

  if (!response.body) {
    throw new Error("스트리밍 응답 본문이 없습니다.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  const emitChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const rawData = dataLines.join("\n");
    let parsedData: unknown = rawData;

    try {
      parsedData = JSON.parse(rawData);
    } catch {
      parsedData = rawData;
    }

    options.onEvent(event, parsedData);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.indexOf("\n\n");

    while (boundaryIndex !== -1) {
      emitChunk(buffer.slice(0, boundaryIndex));
      buffer = buffer.slice(boundaryIndex + 2);
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    emitChunk(buffer);
  }
}
