import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { beamService } from '@/lib/services/beam-service';

const gzipAsync = promisify(gzip);

/**
 * GET /api/beam/sandbox/[projectId]/files
 * Download files from BEAM sandbox using TypeScript SDK
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const { searchParams } = new URL(req.url);
    const relativePath = searchParams.get('path') || '';
    const cursor = searchParams.get('cursor');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Convert relative path to absolute path
    const absolutePath = relativePath.startsWith('/')
      ? relativePath  // Already absolute
      : relativePath
        ? `/app/${relativePath}`  // Make relative path absolute
        : '/app';  // Default to /app

    console.log(`[API] Reading files from: ${absolutePath}`);
    const files = await beamService.downloadFiles(projectId, absolutePath);
    const sorted = files.sort((a, b) => a.path.localeCompare(b.path));

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = sorted.findIndex((entry) => entry.path === cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const pageEntries = sorted.slice(startIndex, startIndex + limit);
    const responseEntries = pageEntries.map(({ path, content }) => ({
      path,
      encoding: 'base64' as const,
      size: content.length,
      content: content.toString('base64'),
    }));

    const nextCursor =
      startIndex + limit < sorted.length ? sorted[startIndex + limit - 1].path : null;

    const payload = {
      entries: responseEntries,
      cursor: nextCursor,
      hasMore: startIndex + limit < sorted.length,
      total: sorted.length,
      returned: responseEntries.length,
    };

    const acceptEncoding = req.headers.get('accept-encoding') || '';
    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf-8');
    const shouldGzip = acceptEncoding.includes('gzip') && payloadBuffer.length > 64 * 1024;

    if (shouldGzip) {
      const gzipped = await gzipAsync(payloadBuffer);
      return new NextResponse(gzipped as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
      });
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('Failed to read files:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to read files from sandbox' },
      { status: 500 }
    );
  }
}
