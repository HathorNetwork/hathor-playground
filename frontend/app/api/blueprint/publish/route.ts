import { NextRequest, NextResponse } from 'next/server';

const HATHOR_WALLET_API_BASE = process.env.HATHOR_WALLET_API_BASE || 'https://wallet.staging.hathor.dev';

/**
 * POST /api/blueprint/publish
 * Publish a blueprint to the Hathor network on-chain
 * 
 * Request body:
 * - code: string (blueprint code content)
 * - address: string (Hathor address that will sign the transaction)
 * - walletId?: string (optional, falls back to HATHOR_WALLET_ID env var)
 * 
 * Response:
 * - blueprint_id: string (transaction hash)
 * - nc_id: string (same as blueprint_id for now)
 * - transaction: object (full transaction details)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, address, walletId } = body;

    // Validate required parameters
    if (!code) {
      return NextResponse.json(
        { error: 'code is required (blueprint code content)' },
        { status: 400 }
      );
    }

    if (!address) {
      return NextResponse.json(
        { error: 'address is required' },
        { status: 400 }
      );
    }

    // Get wallet ID from parameter, environment, or default to "playground"
    const resolvedWalletId = walletId || process.env.HATHOR_WALLET_ID || 'playground';

    // Call Hathor Wallet API
    // Note: The API spec shows wallet-id as a parameter. If 'X-Wallet-Id' header doesn't work,
    // try adding it as a query parameter: `?wallet-id=${resolvedWalletId}`
    const walletApiUrl = `${HATHOR_WALLET_API_BASE}/wallet/nano-contracts/create-on-chain-blueprint`;
    const response = await fetch(walletApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Id': resolvedWalletId, // May need to be query param instead: ?wallet-id=...
      },
      body: JSON.stringify({
        code: code,
        address: address,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { 
          error: responseData.message || `Wallet API error: ${response.statusText}`,
          details: responseData 
        },
        { status: response.status }
      );
    }

    if (!responseData.success) {
      return NextResponse.json(
        { 
          error: responseData.message || 'Failed to create on-chain blueprint',
          details: responseData 
        },
        { status: 400 }
      );
    }

    // Extract blueprint_id from transaction hash
    const blueprintId = responseData.hash;
    if (!blueprintId) {
      return NextResponse.json(
        { error: 'Transaction hash not found in response' },
        { status: 500 }
      );
    }

    // Return blueprint_id and nc_id (same for now)
    return NextResponse.json({
      success: true,
      blueprint_id: blueprintId,
      nc_id: blueprintId, // Same as blueprint_id for now
      transaction: responseData,
    });
  } catch (error: any) {
    console.error('Failed to publish blueprint:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to publish blueprint',
        details: error.stack 
      },
      { status: 500 }
    );
  }
}

