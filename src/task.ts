import type { ArkeClient } from '@arke-institute/sdk';

// ============================================================================
// CUSTOMIZE THESE FOR YOUR AGENT
// ============================================================================

/** What your agent expects in input.options */
export interface TaskOptions {
  // Add your agent-specific options here
  // Example for description agent:
  // max_length?: number;
  // style?: 'formal' | 'casual';
}

/** Full task input */
export interface TaskInput {
  entity_id: string;
  options?: TaskOptions;
}

/** What your agent returns on success */
export interface TaskResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  // Add your agent-specific result data here
  // Example for description agent:
  // data?: {
  //   description: string;
  //   tokens_used: number;
  // };
}

/** Additional context passed to runTask */
export interface TaskContext {
  target: string; // Collection ID
  expires_at: string; // Permission expiry
  job_id: string;
}

/**
 * The main task function - THIS IS WHAT YOU IMPLEMENT
 *
 * @param client - Authenticated ArkeClient for API calls
 * @param input - The task input (entity_id + options)
 * @param context - Additional context (target collection, expires_at, job_id)
 * @returns TaskResult
 * @throws Error on failure (will be caught and converted to error state)
 */
export async function runTask(
  client: ArkeClient,
  input: TaskInput,
  context: TaskContext
): Promise<TaskResult> {
  // Example implementation structure:
  //
  // 1. Fetch entity
  // const { data: entity } = await client.api.GET('/entities/{id}', {
  //   params: { path: { id: input.entity_id } },
  // });
  //
  // 2. Do your processing (call LLM, transform data, etc.)
  // const result = await processEntity(entity, input.options);
  //
  // 3. Update entity with results
  // await client.api.PUT('/entities/{id}', {
  //   params: { path: { id: input.entity_id } },
  //   body: {
  //     expect_tip: entity.cid,
  //     properties_merge: { description: result.description },
  //     note: `Processed by agent (job: ${context.job_id})`,
  //   },
  // });
  //
  // 4. Return result
  // return {
  //   success: true,
  //   message: 'Entity processed successfully',
  //   data: { description: result.description },
  // };

  // Template implementation: just log the entity exists and return success
  const { data: entity, error } = await client.api.GET('/entities/{id}', {
    params: { path: { id: input.entity_id } },
  });

  if (error || !entity) {
    throw new Error(`Entity not found: ${input.entity_id}`);
  }

  // For a real agent, you would do processing here and update the entity
  // This template just returns success to demonstrate the flow
  void context; // Silence unused warning

  return {
    success: true,
    message: 'Entity processed successfully (template - no changes made)',
    data: {
      entity_id: input.entity_id,
      entity_type: entity.type,
    },
  };
}
