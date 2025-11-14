import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/[projectId]/command
 * Execute a command in the BEAM sandbox using TypeScript SDK
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const body = await req.json();
    const { command } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!command) {
      return NextResponse.json(
        { error: 'command is required' },
        { status: 400 }
      );
    }

    const result = await beamService.runCommand(projectId, command);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to execute command:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute command' },
      { status: 500 }
    );
  }
}
