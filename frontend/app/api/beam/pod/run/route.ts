import { NextRequest, NextResponse } from 'next/server';

import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/pod/run
 * Execute a heavy command using a Beam Pod
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const command = body?.command;
    const cwd = body?.cwd || '/app';

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'command is required' }, { status: 400 });
    }

    const result = await beamService.runHeavyTask(command, cwd);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to run heavy pod task:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to run heavy task' },
      { status: 500 },
    );
  }
}

