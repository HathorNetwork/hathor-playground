import { NextRequest } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * GET /api/beam/sandbox/[projectId]/logs
 * Stream logs from BEAM sandbox via SSE
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
        const send = (event: string, data: any) => {
          controller.enqueue(
            new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        const iterator = beamService.streamLogs(projectId);
        let aborted = false;

        const abortHandler = () => {
          aborted = true;
          try {
            controller.close();
          } catch {
            // no-op
          }
        };

        req.signal.addEventListener('abort', abortHandler);

        try {
          for await (const logChunk of iterator) {
            if (aborted) break;
            send('log', { message: logChunk });
          }
        } catch (error: any) {
          send('log_error', { message: error.message || 'Failed to stream logs' });
        } finally {
          req.signal.removeEventListener('abort', abortHandler);
          if (!aborted) {
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Failed to stream logs:', error);
    return new Response('Failed to stream logs', { status: 500 });
  }
}
