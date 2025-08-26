import { MethodDefinition } from './contractParser';

/**
 * Generate a frontend prompt for the given contract methods
 */
export function generateFrontendPrompt(contractName: string, methods: MethodDefinition[]): string {
  let prompt = `You are an expert dApp frontend developer. Build a complete user interface for the Hathor nano-contract blueprint "${contractName}".\n`;
  prompt += 'The blueprint exposes the following methods:\n';

  methods.forEach(method => {
    const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    const returnType = method.returnType ? ` -> ${method.returnType}` : '';
    prompt += `\n${method.decorator.toUpperCase()} ${method.name}(${params})${returnType}\n${method.description}`;
  });

  prompt += '\n\nCreate a frontend that allows users to call all public methods and read data through view methods.';
  prompt += ' Use appropriate forms for parameters and display returned data.\n';
  return prompt;
}
