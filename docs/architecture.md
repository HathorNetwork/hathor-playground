# Architecture Overview

The Hathor Nano Contracts IDE is designed as a modern web application that simulates the Hathor network environment for development purposes.

## System Components

The system consists of three main logical components:

```mermaid
graph TD
    Client[Frontend (Next.js)]
    Server[Backend (FastAPI)]
    Runner[Python Runner]

    Client -->|API Calls| Server
    Server -->|Execute| Runner
    Runner -->|Result| Server
    Server -->|Response| Client
```

### 1. Frontend (Next.js)
The user interface is built with **Next.js** and **React**. It provides the code editor, transaction simulation controls, and feedback visualization.

- **Location**: `frontend/`
- **Key Tech**: Next.js, React, Monaco Editor, Tailwind CSS, Lucide React.
- **Responsibility**: User interaction, state management, and communicating with the backend.

### 2. Backend (FastAPI)
> [!WARNING]
> **Status: Missing / Planned**
>
> The backend implementation is currently pending. It is intended to be a Python-based FastAPI service.

The backend serves as the bridge between the frontend and the nano contract execution engine. It handles requests to compile, validate, and execute contracts.

- **Location**: `backend/` (Planned)
- **Key Tech**: Python, FastAPI.
- **Responsibility**: API endpoints, contract validation logic, orchestration of the execution environment.

### 3. Python Runner (Isolated Environment)
To ensure safe and accurate execution of nano contracts (which are written in Python), the system uses an isolated execution environment.

- **Responsibility**: Running the actual nano contract code in a sandboxed environment that mimics the Hathor full node's contract execution.

## Shared Resources
The `shared/` directory contains utilities and type definitions that may be shared between different parts of the system or used for reference.

## Data Flow

1. **Code Editing**: User writes Python code in the Frontend editor.
2. **Validation**: Frontend performs basic syntax checks.
3. **Execution Request**: User triggers a "Run" or "Test" action.
4. **Processing**: Frontend sends the code to the Backend (simulated or actual).
5. **Execution**: Backend runs the code against the Hathor nano contract engine.
6. **Feedback**: Results (success, error, state changes) are returned to the Frontend for display.
