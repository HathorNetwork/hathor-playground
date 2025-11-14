// DISABLED: OpenTelemetry approach has known webpack bundling issues with Next.js 15
// Using native wrapAISDK approach in API route instead
//
// See: https://github.com/vercel/ai/issues/8273
//
// Braintrust integration is now handled directly in app/api/chat-unified/route.ts
// using wrapAISDKModel() which is the recommended approach

export function register() {
  console.log("🔧 [Braintrust] Using native wrapAISDK approach (no instrumentation.ts needed)");
}
