import { NextRequest } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * GET /api/beam/sandbox/[projectId]/events
 * Local SSE endpoint that polls sandbox status and emits updates
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const { projectId } = params;

  if (!projectId) {
    return new Response('projectId is required', { status: 400 });
  }

  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let previousUrl: string | null = null;

        const send = (event: string, data: any) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: event,
                ...data,
              })}\n\n`,
            ),
          );
        };

        const pushStatus = async () => {
          try {
            const info = await beamService.getSandboxInfo(projectId);
            const currentUrl = info?.url || null;

            if (currentUrl && currentUrl !== previousUrl) {
              send('sandbox_ready', { url: currentUrl });
              previousUrl = currentUrl;
            } else if (!currentUrl && previousUrl) {
              send('sandbox_removed', {});
              previousUrl = null;
            } else {
              send('sandbox_ping', { url: currentUrl });
            }
          } catch (error: any) {
            send('sandbox_error', { message: error.message || 'Failed to inspect sandbox' });
          }
        };

        // Push initial status immediately
        await pushStatus();

        const interval = setInterval(pushStatus, 5000);

        const abortHandler = () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        req.signal.addEventListener('abort', abortHandler);
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
