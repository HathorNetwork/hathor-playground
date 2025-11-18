# LLM Prompt Improvements - Summary

## Problem Analysis

After analyzing the problematic session logs in `frontend/problematic.md`, I identified several critical failure patterns that caused the LLM to get stuck in infinite loops and fail to complete the simple task of creating a file for Next.js imports.

### Critical Failure Patterns Identified

1. **Path Misunderstanding (Most Critical)**
   - User claimed `@/` points to `src/` but `tsconfig.json` shows `"@/*": ["./*"]`
   - LLM created files in `/dapp/src/lib/` instead of `/dapp/lib/`
   - Created 3-4 incorrect files before understanding the actual structure

2. **Tool Execution Errors (Second Critical)**
   - Multiple `write_file({})` calls with empty objects
   - Got stuck in infinite loop calling broken tools
   - Hit blocking mechanism after 2 failed attempts

3. **Over-reliance on Path Aliases**
   - User eventually said "just use relative imports"
   - This was the correct, simple solution all along
   - LLM should have suggested this earlier

4. **Poor Recovery Strategy**
   - Kept retrying failed tools without changing approach
   - Created multiple file variations (nanocontracts vs nanocontacts)
   - Restarted dev server 5+ times unnecessarily
   - Never completed the actual task

### Root Causes

1. **User misinformation accepted without verification** - Should have checked `tsconfig.json` FIRST
2. **No fallback to simpler solutions** - Should default to relative imports
3. **Missing validation before action** - Didn't verify file locations exist
4. **Poor error handling** - No alternative approaches when initial strategy failed

---

## Solutions Implemented

### 1. Added "Next.js Import Strategy" Section to System Prompt

**Location**: `frontend/prompts/blueprint-specialist.md` (after line 1483)

**Key Rules Added**:

#### Rule 1: PREFER RELATIVE IMPORTS
- **Always use relative imports** by default, NOT `@/` path aliases
- Path aliases are fragile and cause frequent build errors
- Relative imports are more reliable and always work

#### Rule 2: VERIFY Before Assuming Paths
- **Never assume directory structure** - always check first
- Read `tsconfig.json` to verify path aliases
- Use `list_files("/dapp")` to see actual layout
- Most Next.js projects do NOT have a `src/` directory

#### Rule 3: Fixing "Module not found" Errors
- Step 1: Switch to relative imports (FIRST CHOICE)
- Step 2: Only if that fails, verify file exists
- Step 3: Create file in correct location after verification

#### Rule 4: NEVER Create `src/` Directory
- Files go in `/dapp/`, NOT `/dapp/src/`
- Explicit warning with examples

#### Rule 5: Tool Call Error Handling
- **NEVER retry failed tools without changing parameters**
- If you see "BLOCKED", STOP IMMEDIATELY
- Diagnose the issue, try different approach, or ask user

#### Rule 6: One Dev Server Restart is Enough
- Don't restart multiple times in a row
- Restart once after ALL changes are complete

---

## Expected Impact

### Before Changes:
- LLM got stuck in infinite loops retrying failed tools
- Created files in wrong directories (`/dapp/src/lib/`)
- Struggled with `@/` path alias issues
- Never completed the simple task

### After Changes:
- ✅ Will use relative imports by default
- ✅ Will verify directory structure before creating files
- ✅ Will stop retrying failed tools
- ✅ Will ask user for help when stuck
- ✅ Will complete tasks more reliably

---

## Testing Recommendations

To verify the improvements work, test with these scenarios:

### Test 1: Module Import Error
**User**: "Create a file at `/dapp/lib/nanocontracts.ts` that exports `NANO_CONTRACTS`"

**Expected Behavior**:
1. Check `list_files("/dapp")` first
2. Create file at `/dapp/lib/nanocontracts.ts` (NOT `/dapp/src/lib/`)
3. Use relative imports in components, NOT `@/` imports
4. Complete task successfully on first try

### Test 2: Tool Failure Recovery
**User**: "Fix this import error: `Module not found: Can't resolve '@/lib/nanocontracts'`"

**Expected Behavior**:
1. Suggest changing to relative import: `import { X } from '../lib/nanocontracts'`
2. If that fails, check if file exists with `list_files("/dapp/lib")`
3. Create file if missing
4. DO NOT retry failed tools multiple times
5. DO NOT restart dev server 5+ times

### Test 3: User Misinformation
**User**: "The `@/` alias points to the `src/` directory"

**Expected Behavior**:
1. Verify by reading `tsconfig.json` first
2. Discover actual configuration: `"@/*": ["./*"]`
3. Use correct paths based on actual config, not user claim
4. Suggest using relative imports instead

---

## Additional Improvements Made

1. **Created `/frontend/CLAUDE.md`** (for reference only - not used by the system)
   - Documents the Next.js best practices
   - Can be referenced in future conversations
   - **Note**: System prompt is in `prompts/blueprint-specialist.md`, NOT CLAUDE.md

2. **Removed `/frontend/CLAUDE.md`** (not needed - system uses `prompts/blueprint-specialist.md`)

---

## Files Modified

1. **`/Users/andrecardoso/Dev/hathor/hathor-playground/frontend/prompts/blueprint-specialist.md`**
   - Added comprehensive "Next.js Import Strategy" section
   - 6 critical rules with examples
   - Clear anti-patterns and correct patterns

---

## Key Takeaways

The improvements focus on **3 main principles**:

1. **Verify First, Act Second** - Always check structure before creating files
2. **Simple Solutions First** - Use relative imports, avoid complex path aliases
3. **Fail Gracefully** - Stop retrying failed tools, try different approaches

These changes should dramatically reduce the type of infinite loop failures seen in the problematic session while maintaining the LLM's ability to handle complex dApp development tasks.
