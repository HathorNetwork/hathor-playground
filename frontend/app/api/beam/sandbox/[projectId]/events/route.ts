import { NextRequest } from 'next/server';

/**
 * GET /api/beam/sandbox/[projectId]/events
 * Stream sandbox state change events using Server-Sent Events (SSE)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const { projectId } = params;

  if (!projectId) {
    return new Response('projectId is required', { status: 400 });
  }

  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  try {
    // Fetch from backend SSE endpoint
    const response = await fetch(`${backendUrl}/api/beam/sandbox/${projectId}/events`, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    if (!response.ok) {
      return new Response(`Failed to connect to event stream: ${response.statusText}`, {
        status: response.status,
      });
    }

    // Create a ReadableStream to forward the SSE events
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (error) {
          console.error('Error streaming events:', error);
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Failed to stream events:', error);
    return new Response('Failed to stream events', { status: 500 });
  }
}
