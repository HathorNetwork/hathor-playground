/**
 * AI SDK Chat Route - Uses non-streaming endpoint with simulated streaming
 *
 * This route receives requests from AI SDK's useChat hook and
 * forwards them to our FastAPI backend non-streaming endpoint (which executes tools),
 * then simulates streaming by chunking the response.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Extract messages and metadata from AI SDK format
    const { messages, data } = body;

    // Get project context from data
    const projectId = data?.projectId || 'default';
    const files = data?.files || {};

    // Format messages for backend (exclude first system message if present)
    // Limit to last 2 messages to prevent token overflow
    // Truncate very long messages (like error traces)
    const conversationHistory = messages
      .filter((m: any) => m.role !== 'system')
      .slice(-2)  // Keep only last 2 messages
      .map((m: any) => ({
        role: m.role,
        content: m.content.length > 5000
          ? m.content.substring(0, 5000) + '\n\n[... truncated ...]'
          : m.content,
      }));

    // Get current message (last user message)
    const currentMessage = messages[messages.length - 1]?.content || '';

    // Call FastAPI non-streaming endpoint (which executes tools properly)
    const response = await fetch(`${API_BASE_URL}/api/ai/unified-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: currentMessage,
        project_id: projectId,
        files: files,
        conversation_history: conversationHistory.slice(0, -1), // Exclude current message
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();

    console.log('[API Route] Backend response:', {
      hasMessage: !!result.message,
      hasUpdatedFiles: !!result.updated_files,
      updatedFilesCount: result.updated_files ? Object.keys(result.updated_files).length : 0,
      updatedFilesPaths: result.updated_files ? Object.keys(result.updated_files) : []
    });

    // Create a streaming response by chunking the text
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const text = result.message || '';
          const chunkSize = 10; // Characters per chunk

          // Stream text in chunks
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize);
            const encoded = encoder.encode(`0:${JSON.stringify(chunk)}\n`);
            controller.enqueue(encoded);

            // Small delay for streaming effect
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          // Send file updates as a data message BEFORE finish signal
          if (result.updated_files && Object.keys(result.updated_files).length > 0) {
            console.log('[API Route] Sending file updates:', Object.keys(result.updated_files));
            const filesUpdate = {
              type: 'files_updated',
              files: result.updated_files
            };
            const dataMessage = `2:${JSON.stringify([filesUpdate])}\n`;
            console.log('[API Route] Data message:', dataMessage.substring(0, 200));
            controller.enqueue(encoder.encode(dataMessage));
          } else {
            console.log('[API Route] No file updates to send');
          }

          // Send finish signal
          controller.enqueue(encoder.encode('d:{"finishReason":"stop"}\n'));
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(encoder.encode(`0:${JSON.stringify('Error: ' + error)}\n`));
          controller.enqueue(encoder.encode('d:{"finishReason":"error"}\n'));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process chat request' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
