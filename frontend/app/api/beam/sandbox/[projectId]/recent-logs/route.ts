import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * GET /api/beam/sandbox/[projectId]/recent-logs
 * Get recent logs from BEAM sandbox using TypeScript SDK
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const { searchParams } = new URL(req.url);
    const lines = parseInt(searchParams.get('lines') || '50');

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    const logs = await beamService.getRecentLogs(projectId, lines);
    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error('Failed to get logs:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get sandbox logs' },
      { status: 500 }
    );
  }
}
