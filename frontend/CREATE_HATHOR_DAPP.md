# LLM Guide: Creating and Developing Hathor dApps

This guide teaches you how to scaffold and develop decentralized applications on Hathor Network using the official template.

## Part 1: Creating a New Hathor dApp

### Quick Start Command

To create a new Hathor dApp project, use this command:

```bash
npx create-hathor-dapp@latest my-dapp-name \
  --yes \
  --wallet-connect-id=8264fff563181da658ce64ee80e80458 \
  --network=testnet
```

**Important**: Always use the WalletConnect Project ID `8264fff563181da658ce64ee80e80458` when creating projects.

### Command Breakdown

- `my-dapp-name` - Replace with the desired project name (lowercase, hyphens allowed)
- `--yes` - Skip interactive prompts (recommended for automation)
- `--wallet-connect-id` - WalletConnect Project ID (always use the one provided above)
- `--network=testnet` - Default network (use `testnet` for development, `mainnet` for production)

### After Creation

```bash
cd my-dapp-name
npm run dev
```

The dApp will be available at `http://localhost:3000`

---

## Part 2: Understanding the Template Architecture

### Project Structure

```
my-dapp-name/
├── app/                     # Next.js 14 App Router
│   ├── layout.tsx          # Root layout with context providers
│   ├── page.tsx            # Landing page
│   └── globals.css         # Global styles + Tailwind
├── components/             # React components
│   ├── Header.tsx          # Wallet connection UI
│   ├── NetworkSelector.tsx # Network switcher
│   ├── ContractExample.tsx # Example contract interaction
│   └── WalletConnectionModal.tsx
├── contexts/               # State management
│   ├── HathorContext.tsx   # Network & blockchain state
│   ├── WalletContext.tsx   # Transaction interface
│   ├── UnifiedWalletContext.tsx # Wallet abstraction layer
│   ├── WalletConnectContext.tsx # WalletConnect integration
│   └── MetaMaskContext.tsx # MetaMask Snaps integration
├── lib/                    # Core services
│   ├── hathorRPC.ts        # Wallet RPC communication
│   ├── hathorCoreAPI.ts    # Blockchain queries
│   ├── config.ts           # Configuration
│   └── utils.ts            # Utility functions
├── types/                  # TypeScript definitions
│   ├── index.ts            # App types
│   └── hathor.ts           # Hathor-specific types
├── .env.local              # Environment variables
├── README.md               # Project documentation
├── QUICKSTART.md           # Quick start guide
└── CONTRACT_INTEGRATION.md # Contract integration patterns
```

### Context Provider Hierarchy

The template uses a layered context architecture (outermost to innermost):

```
ToastProvider
  └── WalletConnectProvider
      └── MetaMaskProvider
          └── UnifiedWalletProvider (wallet abstraction)
              └── WalletContext (transaction layer)
                  └── HathorContext (blockchain layer)
```

**Key Contexts:**

1. **HathorContext** - Network state, contract state fetching, connection status
2. **WalletContext** - High-level transaction interface, balance management
3. **UnifiedWalletContext** - Adapter pattern for wallet abstraction

### Two API Services

1. **HathorRPCService** (`lib/hathorRPC.ts`)
   - Wallet-to-dApp communication
   - Methods: `getConnectedNetwork`, `getBalance`, `getAddress`, `sendNanoContractTx`
   - Uses active wallet's RPC protocol

2. **HathorCoreAPI** (`lib/hathorCoreAPI.ts`)
   - Direct blockchain queries (read-only)
   - Methods: `getContractState`, `getContractHistory`, `getTransaction`
   - No wallet required

---

## Part 3: Developing with the Template

### Basic Workflow

1. **Read the project documentation first**
   - `README.md` - Complete API reference
   - `QUICKSTART.md` - 5-minute setup guide
   - `CONTRACT_INTEGRATION.md` - Integration patterns

2. **Configure your contract IDs** in `.env.local`:
   ```env
   NEXT_PUBLIC_CONTRACT_IDS=["your_contract_id_here"]
   ```

3. **Create contract interaction components** in `components/`

4. **Use the provided hooks and contexts** for wallet and blockchain operations

### Essential Hooks

```typescript
import { useHathor } from '@/contexts/HathorContext';
import { useWallet } from '@/contexts/WalletContext';

function MyComponent() {
  // Network and contract state
  const {
    isConnected,           // Is wallet connected?
    network,               // Current network (testnet/mainnet)
    getContractState,      // Fetch contract state
    switchNetwork          // Switch networks
  } = useHathor();

  // Wallet operations
  const {
    address,               // Connected wallet address
    balance,               // HTR balance
    sendContractTx,        // Send contract transactions
    refreshBalance         // Refresh balance
  } = useWallet();

  // Your component logic...
}
```

### Sending Contract Transactions

**Pattern:**

```typescript
const handleTransaction = async () => {
  try {
    const result = await sendContractTx({
      contractId: process.env.NEXT_PUBLIC_CONTRACT_IDS[0],
      method: 'your_method_name',
      args: ['arg1', 'arg2'],
      actions: [
        {
          type: 'deposit',      // or 'withdrawal'
          amount: '1000',       // Amount in CENTS (1000 = 10.00 HTR)
          token: '00',          // HTR token
          address: 'optional'   // Required for withdrawals
        }
      ]
    });

    toast.success('Transaction successful!');

    // Refresh contract state after transaction
    const newState = await getContractState(contractId);
  } catch (error) {
    toast.error('Transaction failed');
    console.error(error);
  }
};
```

### Reading Contract State

```typescript
const fetchState = async () => {
  try {
    const state = await getContractState('contract_id_here');
    console.log('Contract state:', state);
    // state.fields contains the contract's state variables
  } catch (error) {
    console.error('Failed to fetch state:', error);
  }
};
```

### Critical Conventions

#### 1. Token Amounts are in CENTS

Always multiply display amounts by 100:

```typescript
// ❌ WRONG
amount: '10'  // This is 0.10 HTR, not 10 HTR!

// ✅ CORRECT
amount: '1000'  // This is 10.00 HTR

// Convert user input
const userInput = 10.5;  // User enters 10.5 HTR
const amountInCents = String(Math.floor(userInput * 100));  // '1050'
```

#### 2. Use BigInt for Amounts

```typescript
// Display balance
const displayBalance = formatBalance(balance); // From lib/utils.ts

// Convert to cents for transaction
const amountInCents = String(BigInt(1000)); // 10.00 HTR
```

#### 3. Path Aliases

Always use `@/` imports:

```typescript
import { useWallet } from '@/contexts/WalletContext';
import { formatBalance } from '@/lib/utils';
import { toast } from '@/lib/toast';
```

### Component Template

Create new contract interaction components following this pattern:

```typescript
'use client';

import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useHathor } from '@/contexts/HathorContext';
import { toast } from '@/lib/toast';

export default function YourContract() {
  const { sendContractTx } = useWallet();
  const { getContractState, isConnected } = useHathor();
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet');
      return;
    }

    setLoading(true);
    try {
      const result = await sendContractTx({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_IDS[0],
        method: 'your_method',
        args: [],
        actions: [{
          type: 'deposit',
          amount: '1000',
          token: '00',
        }],
      });

      toast.success('Action successful!');

      // Refresh state
      await getContractState(process.env.NEXT_PUBLIC_CONTRACT_IDS[0]);
    } catch (error) {
      toast.error('Action failed');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Your Contract</h2>

      {!isConnected ? (
        <p className="text-gray-600">Please connect your wallet to continue</p>
      ) : (
        <button
          onClick={handleAction}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Processing...' : 'Execute Action'}
        </button>
      )}
    </div>
  );
}
```

### Mock Mode for Development

Enable mock mode to develop without a wallet:

```env
# .env.local
NEXT_PUBLIC_USE_MOCK_WALLET=true
```

Mock mode features:
- Simulated wallet connection
- 100,000 HTR mock balance
- Transaction logging (no real transactions)
- Immediate responses

Perfect for UI development and testing interaction logic.

### Network Switching

```typescript
import { useHathor } from '@/contexts/HathorContext';

function NetworkSwitcher() {
  const { network, switchNetwork } = useHathor();

  return (
    <button onClick={() => switchNetwork(network === 'testnet' ? 'mainnet' : 'testnet')}>
      Switch to {network === 'testnet' ? 'Mainnet' : 'Testnet'}
    </button>
  );
}
```

**Important**: When the network changes:
- HathorCoreAPI is recreated with new node URLs
- Contract state queries use the new network
- Wallet must also be on the correct network

### Toast Notifications

```typescript
import { toast } from '@/lib/toast';

// Success
toast.success('Transaction successful!');

// Error
toast.error('Failed to send transaction');

// Info
toast.info('Processing...');

// Custom duration
toast.success('Done!', { duration: 5000 });
```

---

## Part 4: Common Development Tasks

### Task 1: Add Your Contract ID

1. Edit `.env.local`:
   ```env
   NEXT_PUBLIC_CONTRACT_IDS=["your_real_contract_id"]
   ```

2. Use in components:
   ```typescript
   const contractId = process.env.NEXT_PUBLIC_CONTRACT_IDS[0];
   ```

### Task 2: Create a Custom Contract Interaction

1. Create `components/MyContract.tsx` using the component template above
2. Import it in `app/page.tsx`:
   ```typescript
   import MyContract from '@/components/MyContract';

   export default function Home() {
     return (
       <main>
         <MyContract />
       </main>
     );
   }
   ```

### Task 3: Display Contract State

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useHathor } from '@/contexts/HathorContext';

export default function ContractState() {
  const { getContractState } = useHathor();
  const [state, setState] = useState(null);

  useEffect(() => {
    const fetchState = async () => {
      const contractState = await getContractState(
        process.env.NEXT_PUBLIC_CONTRACT_IDS[0]
      );
      setState(contractState);
    };
    fetchState();
  }, []);

  if (!state) return <div>Loading...</div>;

  return (
    <div>
      <h2>Contract State</h2>
      <pre>{JSON.stringify(state.fields, null, 2)}</pre>
    </div>
  );
}
```

### Task 4: Handle Token Deposits

```typescript
const handleDeposit = async (amountHTR: number) => {
  const amountInCents = String(Math.floor(amountHTR * 100));

  await sendContractTx({
    contractId: process.env.NEXT_PUBLIC_CONTRACT_IDS[0],
    method: 'deposit',
    args: [],
    actions: [{
      type: 'deposit',
      amount: amountInCents,
      token: '00',
    }],
  });
};
```

### Task 5: Handle Token Withdrawals

```typescript
const handleWithdraw = async (amountHTR: number, toAddress: string) => {
  const amountInCents = String(Math.floor(amountHTR * 100));

  await sendContractTx({
    contractId: process.env.NEXT_PUBLIC_CONTRACT_IDS[0],
    method: 'withdraw',
    args: [],
    actions: [{
      type: 'withdrawal',
      amount: amountInCents,
      token: '00',
      address: toAddress,  // Required for withdrawals
    }],
  });
};
```

---

## Part 5: Important Constraints & Best Practices

### ✅ Do's

1. **Always use cents for amounts**: Multiply display values by 100
2. **Use BigInt for token amounts**: Prevents precision loss
3. **Check `isConnected` before transactions**: Provide helpful messages
4. **Refresh state after transactions**: Call `getContractState()` after success
5. **Use mock mode for development**: Test UI without blockchain
6. **Use path aliases**: `@/contexts/...` not `../../contexts/...`
7. **Handle errors gracefully**: Show toast notifications
8. **Validate user input**: Check for valid amounts, addresses, etc.

### ❌ Don'ts

1. **Don't use floating-point for amounts**: Use BigInt or string cents
2. **Don't forget to multiply by 100**: User enters 10 HTR = 1000 cents
3. **Don't skip error handling**: Always wrap in try/catch
4. **Don't commit `.env.local`**: It contains user-specific config
5. **Don't create commits without user asking**: Only commit when explicitly requested
6. **Don't use JSON.stringify with BigInt**: Convert to string first
7. **Don't skip state refresh**: Users won't see updates otherwise

### Security Notes

- Validate all user input before sending to contracts
- Always use testnet for development
- Review transaction details carefully
- Amounts in cents prevent decimal precision issues
- Never commit sensitive data (private keys, secrets)

---

## Part 6: Debugging Tips

### Common Issues

**Issue**: "Could not determine executable to run"
- **Cause**: Using wrong package version
- **Fix**: Use `npx create-hathor-dapp@latest`

**Issue**: "Wallet not connected"
- **Cause**: User hasn't connected wallet
- **Fix**: Check `isConnected` and show connection prompt

**Issue**: "Network mismatch"
- **Cause**: Wallet on different network than dApp
- **Fix**: Show network selector, prompt user to switch

**Issue**: "Transaction failed"
- **Cause**: Invalid contract ID, wrong network, insufficient balance
- **Fix**: Check browser console, verify contract ID, check balance

**Issue**: "Balance not updating"
- **Cause**: Cache not invalidated
- **Fix**: Call `refreshBalance()` after transaction

### Debugging Checklist

1. ✅ Check browser console for errors
2. ✅ Verify contract ID in `.env.local`
3. ✅ Confirm wallet is connected
4. ✅ Verify wallet and dApp are on same network
5. ✅ Check amount is in cents (multiply by 100)
6. ✅ Ensure transaction structure matches contract expectations
7. ✅ Use mock mode to isolate wallet issues
8. ✅ Review Network tab (DevTools) for RPC calls

---

## Part 7: Quick Reference

### Environment Variables

```env
# Required
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=8264fff563181da658ce64ee80e80458

# Optional
NEXT_PUBLIC_HATHOR_NETWORK=testnet
NEXT_PUBLIC_USE_MOCK_WALLET=false
NEXT_PUBLIC_CONTRACT_IDS=["contract_id_1", "contract_id_2"]
```

### Essential Imports

```typescript
// Contexts
import { useHathor } from '@/contexts/HathorContext';
import { useWallet } from '@/contexts/WalletContext';
import { useUnifiedWallet } from '@/contexts/UnifiedWalletContext';

// Utils
import { formatBalance, formatAddress } from '@/lib/utils';
import { toast } from '@/lib/toast';

// Types
import type { ContractTxParams, ContractState } from '@/types';
import type { NanoContractAction } from '@/types/hathor';
```

### Useful Utility Functions

```typescript
// From @/lib/utils
formatBalance(balance: bigint): string     // Format balance for display
formatTokenAmount(amount: bigint): string  // Format token amounts
formatAddress(address: string): string     // Shorten address (0x1234...5678)
```

---

## Part 8: Next Steps

After creating and exploring the template:

1. **Read the full documentation** in the generated project
2. **Deploy your first contract** on Hathor testnet
3. **Add your contract ID** to `.env.local`
4. **Build your contract interaction UI** using the patterns above
5. **Test thoroughly on testnet** before mainnet deployment
6. **Customize branding and styling** to match your dApp

### Resources

- **Hathor Network Docs**: https://docs.hathor.network/
- **WalletConnect Docs**: https://docs.reown.com/
- **Template README**: Read the `README.md` in your generated project
- **Contract Integration Guide**: See `CONTRACT_INTEGRATION.md` in your project

---

## Summary

To create a Hathor dApp:

```bash
# 1. Scaffold the project
npx create-hathor-dapp@latest my-dapp \
  --yes \
  --wallet-connect-id=8264fff563181da658ce64ee80e80458 \
  --network=testnet

# 2. Start development
cd my-dapp
npm run dev

# 3. Add your contract ID to .env.local
# 4. Build your contract interactions using the patterns above
# 5. Test on testnet
# 6. Deploy to production
```

**Remember**: Always use `8264fff563181da658ce64ee80e80458` as the WalletConnect Project ID!

🚀 You're now ready to build decentralized applications on Hathor Network!
