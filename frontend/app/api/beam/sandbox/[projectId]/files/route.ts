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
    const relativePath = searchParams.get('path') || '';

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Convert relative path to absolute path
    const absolutePath = relativePath.startsWith('/')
      ? relativePath  // Already absolute
      : relativePath
        ? `/app/${relativePath}`  // Make relative path absolute
        : '/app';  // Default to /app

    console.log(`[API] Reading files from: ${absolutePath}`);
    const files = await beamService.downloadFiles(projectId, absolutePath);
    console.log(`[API] Found ${Object.keys(files).length} files`);
    if (Object.keys(files).length > 0) {
      console.log(`[API] Sample file paths:`, Object.keys(files).slice(0, 10));
    } else {
      console.warn(`[API] WARNING: No files found! This might indicate an issue with the find command or file filtering.`);
    }
    return NextResponse.json({ files, debug: { path: absolutePath, fileCount: Object.keys(files).length } });
  } catch (error: any) {
    console.error('Failed to read files:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to read files from sandbox' },
      { status: 500 }
    );
  }
}
