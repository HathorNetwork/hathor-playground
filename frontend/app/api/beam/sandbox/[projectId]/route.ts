import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * GET /api/beam/sandbox/[projectId]
 * Get information about a BEAM sandbox using TypeScript SDK
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    const result = await beamService.getSandboxInfo(projectId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to get sandbox info:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get sandbox info' },
      { status: 500 }
    );
  }
}
