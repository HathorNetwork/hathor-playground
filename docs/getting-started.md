# Getting Started

This guide will help you set up the Hathor Nano Contracts IDE on your local machine.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (version 18 or higher)
- **npm** or **yarn**
- **Python** (version 3.11 or higher) - *Required for backend*

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/hathor/nano-contracts-ide.git
cd nano-contracts-ide
```

### 2. Frontend Setup

Navigate to the frontend directory and install dependencies:

```bash
cd frontend
npm install
# or
yarn install
```

### 3. Backend Setup (Planned)

> [!NOTE]
> The backend setup instructions are provisional as the backend implementation is currently pending.

```bash
cd backend
pip install -r requirements.txt
```

## Running the Application

### Start the Frontend

To run the development server:

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Start the Backend (Planned)

```bash
cd backend
uvicorn main:app --reload
```

## Docker Setup

You can also run the entire stack using Docker Compose:

```bash
docker-compose up -d
```

This will start:
- Frontend at `http://localhost:3000` (or via Traefik at configured domain)
- Backend at `http://localhost:8000`
- Traefik reverse proxy
