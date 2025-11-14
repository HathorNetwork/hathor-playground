import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/upload
 * Upload files to a BEAM sandbox using TypeScript SDK
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { project_id, files, auto_start } = body;

    if (!project_id) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    if (!files || typeof files !== 'object') {
      return NextResponse.json(
        { error: 'files object is required' },
        { status: 400 }
      );
    }

    const result = await beamService.uploadFiles(project_id, files, auto_start ?? true);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to upload files:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload files' },
      { status: 500 }
    );
  }
}
