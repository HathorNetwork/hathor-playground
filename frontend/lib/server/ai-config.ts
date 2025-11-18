import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { wrapAISDKModel, initLogger } from 'braintrust';
import { readFileSync } from 'fs';
import { join } from 'path';

let cachedPrompt: string | null = null;
let braintrustInitialized = false;

const promptPath = join(process.cwd(), 'prompts', 'blueprint-specialist.md');

const ensureBraintrust = () => {
  if (braintrustInitialized) {
    return;
  }

  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    console.warn('[Braintrust] Skipping initialization: BRAINTRUST_API_KEY missing.');
    braintrustInitialized = true;
    return;
  }

  initLogger({
    projectName: process.env.PROJECT_NAME || 'Hathor Playground',
    apiKey,
  });
  braintrustInitialized = true;
};

export const getHathorSystemPrompt = (): string => {
  if (cachedPrompt) {
    return cachedPrompt;
  }
  cachedPrompt = readFileSync(promptPath, 'utf-8');
  return cachedPrompt;
};

export const getHathorAIModel = () => {
  ensureBraintrust();

  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    console.log('[Braintrust] Using OpenAI provider (gpt-4o)');
    return wrapAISDKModel(openai('gpt-4o'));
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    console.log('[Braintrust] Using Google Gemini provider (gemini-2.5-pro)');
    return wrapAISDKModel(google('gemini-2.5-pro'));
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
};

