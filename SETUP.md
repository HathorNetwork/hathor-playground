# Hathor Playground Setup Guide

## Quick Start

The unified architecture is now enabled! Follow these steps to get it running:

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure API Keys

Edit `frontend/.env.local` and add your API keys:

```bash
# Gemini Configuration (Recommended - Free tier available!)
AI_PROVIDER=gemini
GOOGLE_API_KEY=your-actual-google-api-key-here

# BEAM Configuration (Required for dApp deployment)
BEAM_API_KEY=your-actual-beam-key-here
```

**Get your API keys:**
- **Google Gemini** (Recommended): https://aistudio.google.com/app/apikey
- **OpenAI** (Alternative): https://platform.openai.com/api-keys
- **BEAM**: https://beam.cloud

**Why Gemini?**
- ✅ Free tier with generous limits
- ✅ Fast (gemini-2.0-flash-exp)
- ✅ Excellent code generation
- ✅ Tool calling support

**To use OpenAI instead:**
```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-actual-openai-key-here
```

### 3. Start the Development Server

```bash
# Start frontend
cd frontend
npm run dev

# In another terminal, start backend
cd backend
python -m uvicorn main:app --reload
```

### 4. Test the Unified Architecture

Open http://localhost:3000 and try:

#### Test Blueprint Development:
```
"Create a Counter blueprint with increment and decrement methods"
```

The AI should:
- ✅ Write the file
- ✅ Validate syntax
- ✅ Compile in Pyodide
- ✅ Run tests

#### Test dApp Development:
```
"Create a todo list dApp with Tailwind CSS"
```

The AI should:
- ✅ Bootstrap Next.js project
- ✅ Create components
- ✅ Deploy to BEAM sandbox
- ✅ Return a live URL

#### Test Full-Stack:
```
"Build a voting system with smart contract and web UI"
```

The AI should:
- ✅ Create and test the blueprint
- ✅ Create the dApp
- ✅ Deploy everything

## Architecture Overview

### What Runs Where:

```
Browser (Your Machine)          BEAM Cloud
═══════════════════════         ══════════
Zustand Store                      │
  ↓                                │
Pyodide (Blueprints)              │
  - Compile ✓                     │
  - Execute ✓                     │
  - Test ✓                        │
                                  │
BEAM Client ────────────────────► │
  - Deploy dApps                  │
  - Hot reload                    │
  - Dev server                    │
```

### Tools Available:

**Blueprint Tools** (Pyodide):
- `write_file`, `read_file`, `list_files`
- `validate_blueprint`, `compile_blueprint`
- `execute_method`, `run_tests`

**dApp Tools** (BEAM):
- `bootstrap_nextjs`
- `deploy_dapp`
- `upload_files`
- `get_sandbox_url`
- `restart_dev_server`

## Troubleshooting

### Error: "Failed to process chat request"

**Cause:** Missing or invalid API key

**Solution:**

For Gemini (default):
1. Check `.env.local` has `GOOGLE_API_KEY=...`
2. Verify the key is valid at https://aistudio.google.com/app/apikey
3. Restart the dev server: `npm run dev`

For OpenAI:
1. Check `.env.local` has `OPENAI_API_KEY=sk-...`
2. Verify the key is valid at https://platform.openai.com/api-keys
3. Ensure `AI_PROVIDER=openai` is set
4. Restart the dev server

### Error: "BEAM deployment failed"

**Cause:** Missing or invalid BEAM API key

**Solution:**
1. Check `.env.local` has `BEAM_API_KEY=...`
2. Get a key from https://beam.cloud
3. Restart the dev server

### Error: "Pyodide not initialized"

**Cause:** Pyodide is still loading

**Solution:**
- Wait a few seconds for Pyodide to load
- Check browser console for errors
- Refresh the page

### Error: "Tool execution failed"

**Cause:** Various reasons

**Solution:**
1. Check browser console for detailed error
2. Verify file paths are correct
3. Ensure project is selected (top left dropdown)

## Feature Flags

You can toggle between different chat implementations in `frontend/components/RightPanel/RightPanel.tsx`:

```typescript
// Use unified architecture (Blueprint + dApp)
const USE_UNIFIED = true;

// Use old streaming architecture (backend tools)
const USE_UNIFIED = false;
const USE_STREAMING = true;

// Use original non-streaming
const USE_UNIFIED = false;
const USE_STREAMING = false;
```

## Documentation

- **`UNIFIED_ARCHITECTURE.md`** - Technical architecture details
- **`CLIENT_SIDE_ARCHITECTURE.md`** - Original client-side design
- **`SETUP.md`** - This file

## Support

If you encounter issues:

1. Check browser console (F12) for errors
2. Check terminal logs for backend errors
3. Verify all environment variables are set
4. Try clearing browser cache and localStorage
5. Restart both frontend and backend servers

## Next Steps

Once everything is working:

1. **Try the examples** in `UNIFIED_ARCHITECTURE.md`
2. **Build your own** blueprints and dApps
3. **Combine them** into full-stack applications
4. **Share feedback** on what works and what doesn't!

---

Happy building! 🚀
