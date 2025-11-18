import { NextRequest, NextResponse } from 'next/server';

import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/[projectId]/stop
 * Stop the development server in a BEAM sandbox
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } },
) {
  try {
    const { projectId } = params;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const result = await beamService.stopDevServer(projectId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to stop dev server:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to stop dev server' },
      { status: 500 },
    );
  }
}

