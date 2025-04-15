// This file will be copied to the root of the build directory
// It handles Web LLM imports reliably in both development and production

import * as webllm from "https://esm.run/@mlc-ai/web-llm";
window.webllm = webllm; 