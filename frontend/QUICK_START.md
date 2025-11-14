# Quick Start - Gemini Configuration

## 1. Get Your Gemini API Key

Visit: **https://aistudio.google.com/app/apikey**

- Click "Create API key"
- Copy the key

## 2. Add to .env.local

Open `frontend/.env.local` and update:

```bash
AI_PROVIDER=gemini
GOOGLE_API_KEY=paste-your-key-here
```

## 3. Restart the Server

```bash
# Stop the server (Ctrl+C)
npm run dev
```

## 4. Test It!

Open the **AI Agent** tab and try:

```
"Create a Counter blueprint with increment and decrement"
```

---

## Why Gemini?

- ✅ **Free tier** with generous limits (1500 requests/day)
- ✅ **Fast** (gemini-2.0-flash-exp)
- ✅ **No credit card** required for API key
- ✅ **Great at code** generation and tool calling

## Alternative: OpenAI

If you prefer OpenAI:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key
```

Get key: https://platform.openai.com/api-keys

---

**That's it! You're ready to build full-stack blockchain apps!** 🚀
