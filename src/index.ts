/**
 * Agent Template Entry Point
 *
 * Uses createAgentRouter from agent-core for standard endpoints.
 * All job processing is handled by the AgentJob Durable Object.
 */

import { createAgentRouter } from '@arke-institute/agent-core';
import type { AgentEnv } from './env';

// Create router with standard endpoints: /health, /process, /status/:job_id
const app = createAgentRouter<AgentEnv>({
  doBindingName: 'AGENT_JOBS',
  healthData: () => ({
    type: 'agent',
    description: 'Single-entity task processor',
  }),
});

export default app;

// Export Durable Object class for wrangler
export { AgentJob } from './agent-job';
