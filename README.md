# MAI - Model-Assisted Intelligence

A powerful desktop chat application that runs AI models locally, built with Electron, SvelteKit, and WebLLM.

## Overview

MAI is a desktop application designed to provide AI assistance while respecting your privacy. All AI processing happens locally on your machine without sending your data to external servers.

**DISCLAIMER:** This application is under active development and is NOT intended for production use. It is provided "as is" without warranties.

## Key Features

- **Local Model Inference** - Run AI models directly on your device using WebLLM
- **Private by Design** - No data leaves your computer unless explicitly requested
- **Rich Chat Interface** - Modern UI with support for multiple conversation threads
- **Note-Taking System** - Create, edit, and organize notes with AI assistance
- **Knowledge Management** - RAG (Retrieval-Augmented Generation) capabilities for your notes
- **MCP Integration** - Model Context Protocol support for advanced tool usage
- **Search Capabilities** - Find information online as context for the LLM
- **Theme Support** - Switch between dark and light modes
- **Fully Offline** - Works without an internet connection

## Installation

### Prerequisites
- Node.js (v18 or later)
- npm or pnpm

### Development Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd mai
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

3. Start the development server:
   ```bash
   # For web development
   npm run dev
   
   # For Electron development
   npm run electron-dev
   ```

## Building for Distribution

```bash
# Build the application
npm run build

# Package as an Electron app
npm run pack:electron
```

## Architecture

MAI combines several technologies to create a seamless local AI experience:

- **SvelteKit** - Frontend framework with file-based routing
- **Electron** - Desktop application wrapper with native capabilities
- **WebLLM** - WebAssembly-based LLM inference for running models locally
- **IndexedDB** - Client-side storage for chats, notes, and vector embeddings
- **TypeScript** - Type safety throughout the codebase
- **TailwindCSS** - Utility-first CSS framework for styling

### Technical Details

- WebAssembly and WebGL acceleration for optimal model performance
- Context isolation in Electron for enhanced security
- Custom CSP headers configured for model loading
- Offline-first architecture with local storage

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT