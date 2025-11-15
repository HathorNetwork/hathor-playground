import { streamText } from 'ai';
import { getHathorAIModel } from '@/lib/server/ai-config';

const enhancerSystemPrompt = `
You are a Hathor-specific prompt engineer. Polish user requests so they include:
- Explicit goals and constraints
- Mention of Hathor nano-contract or dApp context when relevant
- Expected deliverables (files, tests, deployments)
- Tool expectations (compile_blueprint, run_tests, deploy_dapp) when helpful

Rules:
1. Respond with the enhanced prompt text only — no commentary or metadata.
2. If the original message is unclear, rewrite it as actionable next steps.
3. Preserve the user's intent while improving clarity and context.
`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return new Response(JSON.stringify({ error: 'Prompt text is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const model = getHathorAIModel();
    const result = streamText({
      model,
      system: enhancerSystemPrompt,
      messages: [
        {
          role: 'user',
          content: `Improve this prompt for a Hathor AI assistant. Respond with the rewritten text only.\n\n<original_prompt>\n${message}\n</original_prompt>`,
        },
      ],
      temperature: 0.15,
    });

    return result.toTextStreamResponse();
  } catch (error: any) {
    console.error('Prompt enhancer failed', error);
    return new Response(JSON.stringify({ error: 'Failed to enhance prompt.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

