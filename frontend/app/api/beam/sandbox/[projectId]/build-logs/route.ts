import { NextRequest } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * GET /api/beam/sandbox/[projectId]/build-logs
 * Stream build logs in real-time using Server-Sent Events (SSE)
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
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const logLine of beamService.streamBuildLogs(projectId)) {
            const data = `data: ${logLine}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        } catch (error) {
          console.error('Error streaming build logs:', error);
          const errorData = `data: ERROR: ${error}\n\n`;
          controller.enqueue(encoder.encode(errorData));
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
  } catch (error: any) {
    console.error('Failed to stream build logs:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to stream build logs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
