# Agent Prompts & Rules Documentation

This document provides a complete and in-depth breakdown of the system prompts, rules, and guidelines that govern the AI agent's behavior in the Hathor Nano Contracts IDE.

## 1. Blueprint Specialist System Prompt

**Source File**: `frontend/prompts/blueprint-specialist.md`

The Blueprint Specialist is the core persona for the agent. It is designed to be an expert in Hathor nano contracts, prioritizing security, correctness, and executable actions.

### 1.1 Response Guidelines & Plan Loop

The agent operates on a strict **Plan-Execute-Reflect** loop to ensure structured problem-solving:

1.  **Plan**: The agent MUST start with a `## The Plan` section containing numbered steps. No code is allowed here. This forces the agent to think before acting.
2.  **Execute**: Only after the plan is established can the agent use tools. It is limited to ~6 tool rounds to prevent infinite loops.
3.  **Reflect**: After execution, the agent must provide a `## Reflection` section summarizing what was done, what risks remain, and how to validate the work.

**Quick Actions**: The agent is instructed to provide clickable "Quick Actions" (e.g., `[Deploy dApp]`) to guide the user's next steps.

### 1.2 Critical Rules (The "Must-Follows")

These rules are hard-coded to prevent common pitfalls:

*   **Rule 1: Sync, Don't Scaffold**: The sandbox environment comes with a pre-built dApp. The agent is strictly forbidden from running `create-hathor-dapp` (scaffolding) unless the sandbox is empty. It MUST use `sync_dapp('sandbox-to-ide')` instead.
*   **Rule 2: Publish Before Manifest**: A dApp cannot interact with a contract that isn't on-chain. The agent must `publish_blueprint` first, then update the dApp's manifest (`nanocontracts.ts`) with the resulting ID.
*   **Rule 3: Tools > Text**: The agent must never just "show" code. It must use `write_file` to actually apply changes.
*   **Rule 4: Existing Dependencies Only**: No hallucinating packages. If it's not in `package.json`, it doesn't exist.
*   **Rule 5: Auto-Initialization**: Container types (dict, list, set) in Blueprints are auto-initialized by the system. Assigning them manually (e.g., `self.balances = {}`) is a fatal error.
*   **Rule 6: `initialize` vs `__init__`**: Blueprints use `initialize(self, ctx, ...)` for setup, never the Python `__init__` constructor.
*   **Rule 7: Export Requirement**: Every blueprint file must end with `__blueprint__ = ClassName`.
*   **Rule 8: Decorators**: All methods must have `@public` (state-changing) or `@view` (read-only) decorators.
*   **Rule 9: Intelligent Error Handling**: If a tool fails, the agent must stop, read the error, and try a different approach. Retrying the exact same call is forbidden.

### 1.3 Hathor Blueprint Fundamentals

The prompt embeds a mini-textbook on Hathor development:

*   **Field Types**: Explains supported types like `Address`, `TokenUid`, `ContractId`, and Python primitives.
*   **Decorators**:
    *   `@public`: Requires `ctx: Context`. Can modify state. Supports permissions like `allow_deposit`.
    *   `@view`: Read-only. No `ctx`. Fast and free to call.
    *   `@fallback`: Handles undefined method calls.
*   **Context (`ctx`)**: Detailed breakdown of the context object, including caller info, transaction actions (deposits/withdrawals), and block data.
*   **Syscall (`self.syscall`)**: Documentation for advanced features:
    *   **Cross-Contract Calls**: `call_public_method`, `call_view_method`.
    *   **Token Management**: `create_token`, `mint_tokens`, `melt_tokens`.
    *   **NanoRNG**: The built-in deterministic random number generator (`self.syscall.rng`).

## 2. dApp Integration Guide

**Source File**: `frontend/prompts/dapp-integration-guide.md`

This guide dictates how the agent builds frontends for the contracts.

### 2.1 The "Sync First" Workflow

Re-emphasizes the critical rule: **The dApp already exists.**
1.  **Sync**: `sync_dapp('sandbox-to-ide')`.
2.  **Verify**: Check for `package.json`.
3.  **Rebuild (Only if needed)**: Only if the sync failed to produce a valid project.

### 2.2 Project Navigation

Instructs the agent to "look before leaping":
*   Use `get_project_structure()` to see the lay of the land.
*   Use `find_file` and `get_file_dependencies` to understand existing code before adding new components.

### 2.3 Component Integration Strategy

The agent follows a 4-step process for adding features:
1.  **Explore**: See what components already exist (e.g., `Header`, `WalletContext`).
2.  **Create**: Write the new component (e.g., `SimpleCounter.tsx`).
3.  **Integrate**: Use the `integrate_component` tool to wire it into `page.tsx`.
4.  **Verify**: Read the file to confirm the import was added.

### 2.4 Coding Standards for dApps

*   **Manifest Updates**: The agent must update `/dapp/lib/nanocontracts.ts` with the `id` and `name` of the published contract.
*   **Correct Imports**: Must import `NANO_CONTRACTS` from `../lib/nanocontracts`.
*   **CamelCase**: Use `NANO_CONTRACTS.myContract`, not `my_contract`.
*   **Hooks**: Use `useWallet` for transactions and `useHathor` for state queries.
*   **Token Math**: **CRITICAL**. All token amounts are in cents. The agent must multiply user input by 100 before sending.

### 2.5 RPC & Interaction

*   **`sendContractTx`**: The primary hook for calling `@public` methods.
*   **`getContractState`**: The hook for reading contract storage.
*   **WalletConnect**: The agent is provided with a specific Project ID for testing.

## 3. Why These Rules Matter

*   **Safety**: Preventing manual initialization of containers avoids data loss bugs.
*   **Efficiency**: The "Sync First" rule saves minutes of wasted time scaffolding projects that already exist.
*   **Correctness**: Enforcing `@public`/`@view` decorators ensures the contract actually compiles and runs on Hathor.
*   **User Experience**: The Plan/Execute/Reflect loop ensures the user isn't bombarded with code before the agent knows what it's doing.
