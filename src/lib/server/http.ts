import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json(
    {
      error: message,
    },
    { status },
  );
}

export async function withRouteError<T>(handler: () => Promise<T>) {
  try {
    const data = await handler();
    return jsonOk(data);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
      400,
    );
  }
}

export type SseSend = (event: string, data: unknown) => void;

export function sseJson(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseResponse(
  handler: (send: SseSend) => Promise<void>,
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send: SseSend = (event, data) => {
          controller.enqueue(encoder.encode(sseJson(event, data)));
        };

        try {
          await handler(send);
        } catch (error) {
          send("error", {
            message: error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
          });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    },
  );
}
