import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/create
 * Create a new BEAM sandbox for a project using TypeScript SDK
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const result = await beamService.createSandbox(project_id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to create sandbox:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create sandbox' },
      { status: 500 }
    );
  }
}
