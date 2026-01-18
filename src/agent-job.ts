/**
 * Agent Durable Object
 *
 * Handles single-entity task execution with alarm-based processing.
 * Extends BaseAgentDO from agent-core.
 */

import { ArkeClient } from '@arke-institute/sdk';
import {
  BaseAgentDO,
  AlarmState,
  StartRequest,
  JobResponse,
  BaseStatusResponse,
  writeJobLog,
} from '@arke-institute/agent-core';
import type { AgentEnv } from './env';
import type { AgentJobState, AgentInput } from './types';
import { runTask } from './task';

// =============================================================================
// Agent Durable Object
// =============================================================================

export class AgentJob extends BaseAgentDO<AgentJobState, AgentEnv, AgentInput> {
  // ===========================================================================
  // Handle Start
  // ===========================================================================

  protected async handleStart(
    request: StartRequest<AgentInput>
  ): Promise<JobResponse> {
    // Check if job already exists
    const existing = await this.getState();
    if (existing) {
      console.log(
        `[${this.env.AGENT_ID}] Job ${request.job_id} already exists, returning current status`
      );
      return { accepted: true, job_id: request.job_id };
    }

    const logger = this.getLogger();

    // Validate input
    const entityId = request.input?.entity_id;
    if (!entityId) {
      logger.error('Missing entity_id in input');
      return { accepted: false, error: 'Missing entity_id in input' };
    }

    logger.info('Initializing agent job', {
      job_id: request.job_id,
      entity_id: entityId,
    });

    // Create initial state
    const state: AgentJobState = {
      job_id: request.job_id,
      status: 'pending',
      target: request.target,
      job_collection: request.job_collection,
      api_base: request.api_base,
      expires_at: request.expires_at,
      network: request.network,
      entity_id: entityId,
      input: request.input!,
      progress: {
        total: 1,
        pending: 1,
        dispatched: 0,
        done: 0,
        error: 0,
      },
      started_at: new Date().toISOString(),
    };

    await this.saveState(state);

    // Initialize alarm state
    await this.saveAlarmState({ phase: 'process' });

    // Schedule immediate alarm to start processing
    await this.scheduleImmediateAlarm();

    logger.info('Agent job started', { entity_id: entityId });

    return { accepted: true, job_id: request.job_id };
  }

  // ===========================================================================
  // Process Alarm
  // ===========================================================================

  protected async processAlarm(
    state: AgentJobState,
    _alarmState: AlarmState
  ): Promise<boolean> {
    const logger = this.getLogger();

    // Update status to running
    if (state.status === 'pending') {
      state.status = 'running';
      state.progress.pending = 0;
      state.progress.dispatched = 1;
      await this.saveState(state);
    }

    // Check expiry
    if (this.isExpired(state)) {
      logger.error('Job expired');
      await this.failJob(state, 'EXPIRED', 'Job expired before completion');
      await this.writeLog(state);
      return false;
    }

    // Create Arke client
    const client = new ArkeClient({
      baseUrl: state.api_base,
      authToken: this.env.ARKE_API_KEY,
      network: state.network,
    });

    try {
      logger.info('Running task', { entity_id: state.entity_id });

      // Run the actual task
      const result = await runTask(client, state.input, {
        target: state.target,
        expires_at: state.expires_at,
        job_id: state.job_id,
      });

      // Task completed successfully
      state.status = 'done';
      state.result = result as unknown as Record<string, unknown>;
      state.completed_at = new Date().toISOString();
      state.progress.dispatched = 0;
      state.progress.done = 1;

      logger.success('Task completed', { result });
    } catch (err) {
      // Task failed
      state.status = 'error';
      state.error = {
        code: 'TASK_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      state.completed_at = new Date().toISOString();
      state.progress.dispatched = 0;
      state.progress.error = 1;

      logger.error('Task failed', { error: state.error.message });
    }

    await this.saveState(state);
    await this.writeLog(state);

    return false; // No more alarms needed
  }

  // ===========================================================================
  // Write Log
  // ===========================================================================

  private async writeLog(state: AgentJobState): Promise<void> {
    const logger = this.getLogger();

    try {
      const client = new ArkeClient({
        baseUrl: state.api_base,
        authToken: this.env.ARKE_API_KEY,
        network: state.network,
      });

      // Write the job log file
      await writeJobLog(client, state.job_collection, {
        job_id: state.job_id,
        agent_id: this.env.AGENT_ID,
        agent_version: this.env.AGENT_VERSION,
        started_at: state.started_at,
        completed_at: state.completed_at!,
        status: state.status === 'done' ? 'done' : 'error',
        result: state.result,
        error: state.error,
        entries: logger.getEntries(),
      });

      // Update the job collection status
      await this.updateJobCollectionStatus(client, state);
    } catch (err) {
      console.error(`[${this.env.AGENT_ID}] Failed to write log:`, err);
    }
  }

  // ===========================================================================
  // Update Job Collection Status
  // ===========================================================================

  private async updateJobCollectionStatus(
    client: ArkeClient,
    state: AgentJobState
  ): Promise<void> {
    const finalStatus = state.status === 'done' ? 'done' : 'error';
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Get current collection CID for CAS
        const { data: collection } = await client.api.GET('/collections/{id}', {
          params: { path: { id: state.job_collection } },
        });

        if (!collection) {
          console.error(`[${this.env.AGENT_ID}] Job collection not found: ${state.job_collection}`);
          return;
        }

        // Update collection status
        const { error: updateError } = await client.api.PUT('/collections/{id}', {
          params: { path: { id: state.job_collection } },
          body: {
            expect_tip: collection.cid,
            status: finalStatus,
            note: `Job ${state.job_id} completed with status: ${finalStatus}`,
          },
        });

        if (updateError) {
          const errorStr = JSON.stringify(updateError);
          if (errorStr.includes('409') || errorStr.includes('Conflict')) {
            if (attempt < maxRetries - 1) {
              const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
              console.log(`[${this.env.AGENT_ID}] CAS conflict updating job collection, retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          console.error(`[${this.env.AGENT_ID}] Failed to update job collection status:`, updateError);
          return;
        }

        console.log(`[${this.env.AGENT_ID}] Updated job collection ${state.job_collection} status to ${finalStatus}`);
        return;
      } catch (err) {
        console.error(`[${this.env.AGENT_ID}] Error updating job collection (attempt ${attempt + 1}):`, err);
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`[${this.env.AGENT_ID}] Failed to update job collection status after ${maxRetries} retries`);
  }

  // ===========================================================================
  // Status Response
  // ===========================================================================

  protected getStatusResponse(state: AgentJobState): BaseStatusResponse {
    return {
      job_id: state.job_id,
      status: state.status,
      progress: state.progress,
      result: state.result,
      error: state.error,
      started_at: state.started_at,
      completed_at: state.completed_at,
    };
  }
}
