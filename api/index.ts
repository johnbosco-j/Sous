// Vercel entry point: the same Express app (MCP at /mcp, simulator API at /api/*); web/ is served by the CDN.
import { createApp } from '../src/index.js';

export default createApp();
