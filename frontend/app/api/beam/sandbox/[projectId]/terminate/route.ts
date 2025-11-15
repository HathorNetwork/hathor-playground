import { NextRequest, NextResponse } from 'next/server';

import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/[projectId]/terminate
 * Terminate a BEAM sandbox entirely
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

    const result = await beamService.terminateSandbox(projectId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to terminate sandbox:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to terminate sandbox' },
      { status: 500 },
    );
  }
}

