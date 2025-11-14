import { NextRequest, NextResponse } from 'next/server';

import { beamService } from '@/lib/services/beam-service';

const DEFAULT_CODE_PATH = '/app';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } },
) {
  try {
    const { projectId } = params;
    const { searchParams } = new URL(req.url);
    const command = searchParams.get('command');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    if (!command) {
      return NextResponse.json({ error: 'command query param is required' }, { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send('start', { command });

          let instance = await beamService.getSandbox(projectId);
          if (!instance) {
            await beamService.createSandbox(projectId);
            instance = await beamService.getSandbox(projectId);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (!instance) {
            throw new Error('Failed to acquire sandbox instance');
          }

          try {
            await instance.fs.statFile(DEFAULT_CODE_PATH);
          } catch {
            await instance.exec('mkdir', '-p', DEFAULT_CODE_PATH);
          }

          const fullCommand = `cd ${DEFAULT_CODE_PATH} && ${command}`;
          const process = await instance.exec('sh', '-c', fullCommand);

          const readStream = async (reader: any, type: 'stdout' | 'stderr') => {
            try {
              while (true) {
                const chunk = await reader.read();
                if (!chunk) break;
                send('log', { type, chunk });
              }
            } catch (streamError) {
              send('log', { type, chunk: `[${type}] stream error: ${streamError}` });
            }
          };

          await Promise.all([
            readStream(process.stdout, 'stdout'),
            readStream(process.stderr, 'stderr'),
            (async () => {
              const result = await process.wait();
              send('done', { exitCode: Number(result.exitCode) || 0 });
            })(),
          ]);

          controller.close();
        } catch (error: any) {
          send('error', { message: error.message || 'Command execution failed' });
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to start command stream' }, { status: 500 });
  }
}

