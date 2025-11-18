import { useIDEStore } from '@/store/ide-store';
import type { ToolResult } from './types';

const METADATA_FILE_PATH = '/dapp/lib/nanocontracts.ts';

function countMetadataEntries(content: string): number {
  const bodyMatch = content.match(/NANO_CONTRACTS\s*=\s*{([\s\S]*?)}/);
  if (!bodyMatch) {
    return 0;
  }

  const idMatches = bodyMatch[1].match(/id:\s*['"].+?['"]/g);
  return idMatches ? idMatches.length : 0;
}

export function hasContractMetadata(): boolean {
  const { files, compiledContracts } = useIDEStore.getState();

  if (compiledContracts && compiledContracts.length > 0) {
    return true;
  }

  const metadataFile = files.find((file) => file.path === METADATA_FILE_PATH);
  if (!metadataFile) {
    return false;
  }

  return countMetadataEntries(metadataFile.content) > 0;
}

export function guardContractMetadata(operationDescription: string): ToolResult | null {
  if (hasContractMetadata()) {
    return null;
  }

  return {
    success: false,
    message: `⚠️ Cannot ${operationDescription}. No nano-contract metadata was found.`,
    error:
      'Missing metadata. Compile a blueprint first (use compile_blueprint and run_tests) or update /dapp/lib/nanocontracts.ts so wallet actions know which blueprint IDs to target.',
  };
}

