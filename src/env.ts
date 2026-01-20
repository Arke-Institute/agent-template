import type { BaseAgentEnv } from '@arke-institute/agent-core';
import type { AgentJob } from './agent-job';

export interface AgentEnv extends BaseAgentEnv {
  // Durable Object for job processing
  AGENT_JOBS: DurableObjectNamespace<AgentJob>;
}
