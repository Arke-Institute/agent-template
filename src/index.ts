import { Hono } from 'hono';
import { ArkeClient } from '@arke-institute/sdk';
import type { Env } from './env';
import type { JobRequest, JobState, JobResponse, StatusResponse } from './types';
import { verifyArkeSignature } from './verify';
import { getJobState, saveJobState } from './state';
import { JobLogger, writeJobLog } from './logger';
import { runTask } from './task';

const app = new Hono<{ Bindings: Env }>();

// =============================================================================
// GET /health
// =============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    agent: c.env.AGENT_ID,
    version: c.env.AGENT_VERSION,
  });
});

// =============================================================================
// POST /process
// =============================================================================

app.post('/process', async (c) => {
  const env = c.env;

  // 1. Read raw body for signature verification
  const body = await c.req.text();
  const signatureHeader = c.req.header('X-Arke-Signature');
  const requestId = c.req.header('X-Arke-Request-Id');

  console.log(`[${env.AGENT_ID}] Received request ${requestId}`);

  // 2. Verify signature
  if (!signatureHeader) {
    return c.json<JobResponse>(
      { accepted: false, error: 'Missing signature header' },
      401
    );
  }

  let jobRequest: JobRequest;
  try {
    jobRequest = JSON.parse(body) as JobRequest;
  } catch {
    return c.json<JobResponse>(
      { accepted: false, error: 'Invalid JSON body' },
      400
    );
  }

  const verifyResult = await verifyArkeSignature(
    body,
    signatureHeader,
    jobRequest.api_base
  );
  if (!verifyResult.valid) {
    return c.json<JobResponse>(
      { accepted: false, error: verifyResult.error ?? 'Invalid signature' },
      401
    );
  }

  // 3. Validate required fields
  if (!jobRequest.job_id || !jobRequest.target || !jobRequest.job_collection) {
    return c.json<JobResponse>(
      { accepted: false, error: 'Missing required fields' },
      400
    );
  }

  const entityId = jobRequest.input?.entity_id;
  if (!entityId) {
    return c.json<JobResponse>(
      { accepted: false, error: 'Missing entity_id in input' },
      400
    );
  }

  // 4. Check API key configured
  if (!env.ARKE_API_KEY) {
    return c.json<JobResponse>(
      { accepted: false, error: 'Agent not configured', retry_after: 60 },
      503
    );
  }

  // 5. Create initial job state
  const jobState: JobState = {
    job_id: jobRequest.job_id,
    status: 'pending',
    entity_id: entityId,
    target: jobRequest.target,
    job_collection: jobRequest.job_collection,
    api_base: jobRequest.api_base,
    expires_at: jobRequest.expires_at,
    input: jobRequest.input,
    started_at: new Date().toISOString(),
  };

  await saveJobState(env.JOBS, jobState);

  // 6. Start background processing
  c.executionCtx.waitUntil(
    processJob(env, jobState).catch((err) => {
      console.error(`[${env.AGENT_ID}] Background processing error:`, err);
    })
  );

  // 7. Return immediately
  return c.json<JobResponse>({ accepted: true, job_id: jobRequest.job_id });
});

// =============================================================================
// Background Processor
// =============================================================================

async function processJob(env: Env, state: JobState): Promise<void> {
  const logger = new JobLogger(env.AGENT_ID);
  const client = new ArkeClient({
    baseUrl: state.api_base,
    authToken: env.ARKE_API_KEY,
  });

  try {
    // Update state to running
    state.status = 'running';
    await saveJobState(env.JOBS, state);

    logger.info('Starting task', {
      job_id: state.job_id,
      entity_id: state.entity_id,
    });

    // Run the actual task
    const result = await runTask(client, state.input, {
      target: state.target,
      expires_at: state.expires_at,
      job_id: state.job_id,
    });

    // Update state to done
    state.status = 'done';
    state.result = result;
    state.completed_at = new Date().toISOString();

    logger.success('Task completed', { result });
  } catch (err) {
    // Update state to error
    state.status = 'error';
    state.error = {
      code: 'TASK_FAILED',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
    state.completed_at = new Date().toISOString();

    logger.error('Task failed', { error: state.error.message });
  }

  // Write log to job collection
  try {
    await writeJobLog(client, state.job_collection, {
      job_id: state.job_id,
      agent_id: env.AGENT_ID,
      agent_version: env.AGENT_VERSION,
      started_at: state.started_at,
      completed_at: state.completed_at!,
      status: state.status === 'done' ? 'done' : 'error',
      result: state.result,
      error: state.error,
      entries: logger.getEntries(),
    });
  } catch (err) {
    console.error(`[${env.AGENT_ID}] Failed to write log:`, err);
  }

  // Save final state
  await saveJobState(env.JOBS, state);
}

// =============================================================================
// GET /status/:job_id
// =============================================================================

app.get('/status/:job_id', async (c) => {
  const jobId = c.req.param('job_id');
  const state = await getJobState(c.env.JOBS, jobId);

  if (!state) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json<StatusResponse>({
    job_id: state.job_id,
    status: state.status,
    result: state.result,
    error: state.error,
    started_at: state.started_at,
    completed_at: state.completed_at,
  });
});

// =============================================================================
// Fallback
// =============================================================================

app.all('*', (c) => {
  return c.json(
    {
      error: 'Not found',
      endpoints: {
        health: 'GET /health',
        process: 'POST /process',
        status: 'GET /status/:job_id',
      },
    },
    404
  );
});

export default app;
