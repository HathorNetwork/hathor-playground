# Frontend Documentation

The frontend is a Next.js application that serves as the primary interface for the IDE.

## Directory Structure

```
frontend/
├── app/                 # Next.js App Router pages and layouts
├── components/          # React components
│   ├── RightPanel/      # Chat and Tool interface components
│   └── ...
├── lib/                 # Utility libraries
│   ├── tools/           # Tool definitions and logic
│   └── ...
├── public/              # Static assets
└── ...
```

## Key Components

### AgenticChatUnified
Located in `components/RightPanel/AgenticChatUnified.tsx`, this component handles the interactive chat interface where users can interact with the AI agent to generate or analyze code.

### Tool System
The application features a robust tool execution system located in `lib/tools/`.

- **Validation** (`validation.ts`): Ensures inputs (file paths, content) are safe and valid before execution.
- **Middleware** (`middleware.ts`): Wraps tool execution with error handling, retries, and logging.
- **Caching** (`cache.ts`): Caches expensive tool results to improve performance.
- **Error Recovery** (`error-recovery.ts`): Provides suggestions and context when tools fail.

## State Management
The application uses **Zustand** for global state management. Stores are located in the `store/` directory.

## Styling
Styling is handled using **Tailwind CSS**. The configuration can be found in `tailwind.config.js`.
