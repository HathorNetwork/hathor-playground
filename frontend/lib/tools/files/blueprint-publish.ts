import { useIDEStore } from '@/store/ide-store';
import { ToolResult } from '../types';
import { validateBlueprintPath } from '../validation';
import { executeTool } from '../middleware';

/**
 * Publishes a blueprint to the Hathor network on-chain
 */
export async function publishBlueprint(
  blueprintPath: string,
  address: string,
  walletId?: string,
): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateBlueprintPath(blueprintPath);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Blueprint path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  if (!address || address.trim() === '') {
    return {
      success: false,
      message: 'Missing required parameter: address',
      error: 'Hathor address is required to sign the on-chain blueprint transaction',
    };
  }

  return executeTool(
    'publish_blueprint',
    async () => {
      // Read blueprint code from file
      const files = useIDEStore.getState().files;
      const blueprintFile = files.find((f) => f.path === blueprintPath);

      if (!blueprintFile) {
        return {
          success: false,
          message: `Blueprint file not found: ${blueprintPath}`,
          error: 'Please check the file path and ensure the blueprint exists',
        };
      }

      const blueprintCode = blueprintFile.content;

      // Call the API route
      const response = await fetch('/api/blueprint/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: blueprintCode,
          address: address,
          walletId: walletId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          message: `Failed to publish blueprint: ${data.error || response.statusText}`,
          error: data.details || data.error || 'Unknown error',
        };
      }

      const { blueprint_id, nc_id, transaction } = data;

      return {
        success: true,
        message: `✅ Blueprint published successfully!\n\n📋 Blueprint ID: ${blueprint_id}\n📋 NC ID: ${nc_id}\n\n💡 Use these IDs to create the manifest and configure your dApp.`,
        data: {
          blueprint_id,
          nc_id,
          transaction,
          blueprintPath,
        },
      };
    },
    {
      retries: 2, // Network operations can be retried
      timeout: 30000, // 30 second timeout for network requests
    }
  );
}

