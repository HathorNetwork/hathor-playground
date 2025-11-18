import { useCallback, useState } from 'react';

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = useCallback(() => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  }, []);

  const enhancePrompt = useCallback(
    async (input: string, setter: (value: string) => void) => {
      if (!input.trim()) {
        return;
      }

      setEnhancingPrompt(true);
      setPromptEnhanced(false);

      try {
        const response = await fetch('/api/prompt-enhancer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: input }),
        });

        if (!response.ok || !response.body) {
          throw new Error('Prompt enhancer failed');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let enhanced = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          enhanced += decoder.decode(value, { stream: true });
          setter(enhanced);
        }

        setter(enhanced.trim());
        setPromptEnhanced(true);
      } catch (error) {
        console.error('Prompt enhancer error:', error);
        setter(input);
        setPromptEnhanced(false);
      } finally {
        setEnhancingPrompt(false);
      }
    },
    [],
  );

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}

