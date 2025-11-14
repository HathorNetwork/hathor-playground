import { NextRequest, NextResponse } from 'next/server';
import { beamService } from '@/lib/services/beam-service';

/**
 * POST /api/beam/sandbox/[projectId]/git
 * Execute git operations in the BEAM sandbox
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const body = await req.json();
    const { operation, ...args } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!operation) {
      return NextResponse.json(
        { error: 'operation is required' },
        { status: 400 }
      );
    }

    let result: any;

    switch (operation) {
      case 'ensureGitRepo':
        await beamService.ensureGitRepo(projectId);
        result = { success: true };
        break;

      case 'commitSandboxState':
        const commitHash = await beamService.commitSandboxState(
          projectId,
          args.message || 'Sync checkpoint'
        );
        result = { success: true, commitHash };
        break;

      case 'getSandboxHeadCommit':
        const headHash = await beamService.getSandboxHeadCommit(projectId);
        result = { success: true, commitHash: headHash };
        break;

      case 'getSandboxChangedFiles':
        const changedFiles = await beamService.getSandboxChangedFiles(
          projectId,
          args.sinceHash || null
        );
        result = { success: true, changedFiles };
        break;

      case 'getSandboxCommitLog':
        const commitLog = await beamService.getSandboxCommitLog(
          projectId,
          args.sinceHash || null
        );
        result = { success: true, commitLog };
        break;

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Failed to execute git operation:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute git operation' },
      { status: 500 }
    );
  }
}

