import type { BaseJobState } from '@arke-institute/agent-core';
import type { TaskInput, TaskResult } from './task';

// =============================================================================
// Agent-Specific Types
// =============================================================================

/** Agent job state - extends base job state */
export interface AgentJobState extends BaseJobState {
  entity_id: string;
  input: TaskInput;
}

/** Agent input schema (what the orchestrator sends) */
export interface AgentInput extends TaskInput {
  // TaskInput already has entity_id and options
}

/** Re-export task types for convenience */
export type { TaskInput, TaskResult, TaskOptions, TaskContext } from './task';
