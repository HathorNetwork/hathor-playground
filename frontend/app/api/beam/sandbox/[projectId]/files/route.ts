import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

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
    const path = searchParams.get('path') || '/app';

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    const files = await beamService.downloadFiles(projectId, path);
    return NextResponse.json({ files });
  } catch (error: any) {
    console.error('Failed to read files:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to read files from sandbox' },
      { status: 500 }
    );
  }
}
