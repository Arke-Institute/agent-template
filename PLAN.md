# Agent Template - Implementation Plan

This template provides the base structure for single-entity agents. Fork this to create agents like `description-agent`, `ocr-agent`, `metadata-agent`, etc.

## Overview

An agent:
- Receives a job from Arke with a single `entity_id`
- Processes that entity (fetch, transform, update)
- Reports status via polling endpoint
- Writes log to the log file entity

## Directory Structure

```
agent-template/
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── README.md                    # Instructions for forking
└── src/
    ├── index.ts                 # Hono app entry point
    ├── env.ts                   # Environment type definition
    ├── types.ts                 # Job types (request, state, response)
    ├── verify.ts                # Ed25519 signature verification
    ├── state.ts                 # KV state management
    ├── logger.ts                # Job logger (writes to log entity)
    └── task.ts                  # THE TASK - customize when forking
```

---

## File Specifications

### `env.ts` - Environment Bindings

```typescript
export interface Env {
  // KV for job state
  JOBS: KVNamespace;

  // Agent configuration
  ARKE_API_KEY: string;      // Secret: agent's API key
  ARKE_API_BASE: string;     // Default: https://arke-v1.arke.institute

  // Agent identity (for logging)
  AGENT_ID: string;          // e.g., "description-agent"
  AGENT_VERSION: string;     // e.g., "1.0.0"
}
```

---

### `types.ts` - Job Types

```typescript
import type { TaskInput, TaskResult } from './task';

// What Arke sends us
export interface JobRequest {
  job_id: string;
  target: string;              // Collection ID
  log: { pi: string; type: 'file' };
  input: TaskInput;
  api_base: string;
  expires_at: string;
}

// What we store in KV
export interface JobState {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  entity_id: string;
  target: string;
  log_pi: string;
  api_base: string;
  expires_at: string;
  input: TaskInput;

  started_at: string;
  completed_at?: string;

  result?: TaskResult;
  error?: { code: string; message: string };
}

// What we return on POST /process
export interface JobAcceptResponse {
  accepted: true;
  job_id: string;
}

export interface JobRejectResponse {
  accepted: false;
  error: string;
  retry_after?: number;
}

export type JobResponse = JobAcceptResponse | JobRejectResponse;

// What we return on GET /status/:job_id
export interface StatusResponse {
  job_id: string;
  status: JobState['status'];
  result?: TaskResult;
  error?: JobState['error'];
  started_at: string;
  completed_at?: string;
}

// Signature verification types
export interface SigningKeyInfo {
  public_key: string;
  algorithm: string;
  key_id: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}
```

---

### `verify.ts` - Signature Verification

Implements Ed25519 signature verification for requests from Arke:

1. **Fetch public key** from `{api_base}/.well-known/signing-key`
2. **Cache for 1 hour** to avoid repeated fetches
3. **Parse header** `X-Arke-Signature: t=<timestamp>,v1=<signature>`
4. **Verify signature** over `{timestamp}.{body}`
5. **Check freshness** (5 min max age, 1 min future tolerance)

Functions:
- `getArkePublicKey(apiBase: string): Promise<Uint8Array>`
- `parseSignatureHeader(header: string): { timestamp: number; signature: string } | null`
- `verifyArkeSignature(body: string, signatureHeader: string, apiBase: string): Promise<VerifyResult>`

---

### `state.ts` - KV State Management

```typescript
const KV_TTL = 86400; // 24 hours

export async function getJobState(kv: KVNamespace, jobId: string): Promise<JobState | null> {
  const data = await kv.get(`job:${jobId}`, 'json');
  return data as JobState | null;
}

export async function saveJobState(kv: KVNamespace, state: JobState): Promise<void> {
  await kv.put(`job:${state.job_id}`, JSON.stringify(state), {
    expirationTtl: KV_TTL,
  });
}
```

---

### `logger.ts` - Job Logger

```typescript
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'success';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export class JobLogger {
  private entries: LogEntry[] = [];

  constructor(private agentId: string) {}

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      metadata,
    };
    this.entries.push(entry);
    console.log(`[${this.agentId}] [${level}] ${message}`, metadata ?? '');
  }

  debug(message: string, metadata?: Record<string, unknown>): void { this.log('debug', message, metadata); }
  info(message: string, metadata?: Record<string, unknown>): void { this.log('info', message, metadata); }
  warning(message: string, metadata?: Record<string, unknown>): void { this.log('warning', message, metadata); }
  error(message: string, metadata?: Record<string, unknown>): void { this.log('error', message, metadata); }
  success(message: string, metadata?: Record<string, unknown>): void { this.log('success', message, metadata); }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }
}

// Write log to the log file entity via Arke API
export async function writeJobLog(
  client: ArkeClient,
  logPi: string,
  log: {
    job_id: string;
    agent_id: string;
    agent_version: string;
    started_at: string;
    completed_at: string;
    status: 'done' | 'error';
    result?: TaskResult;
    error?: { code: string; message: string };
    entries: LogEntry[];
  }
): Promise<void> {
  // Get current file to get CID for CAS
  const { data: file } = await client.api.GET('/files/{id}', {
    params: { path: { id: logPi } },
  });

  if (!file) {
    console.error(`[logger] Log file not found: ${logPi}`);
    return;
  }

  // Update file with log data in extra_properties
  await client.api.PUT('/files/{id}', {
    params: { path: { id: logPi } },
    body: {
      expect_tip: file.cid,
      extra_properties: {
        log_data: log,
        log_written_at: new Date().toISOString(),
      },
      note: `Log written by ${log.agent_id}`,
    },
  });
}
```

---

### `task.ts` - THE CUSTOMIZATION POINT

This is the file you modify when forking the template.

```typescript
import { ArkeClient } from '@arke-institute/sdk';

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
  target: string;       // Collection ID
  expires_at: string;   // Permission expiry
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

  throw new Error('Not implemented - customize this for your agent');
}
```

---

### `index.ts` - Main Entry Point

```typescript
import { Hono } from 'hono';
import { ArkeClient } from '@arke-institute/sdk';
import type { Env } from './env';
import type { JobRequest, JobState, JobResponse, StatusResponse } from './types';
import { verifyArkeSignature } from './verify';
import { getJobState, saveJobState } from './state';
import { JobLogger, writeJobLog } from './logger';
import { runTask, type TaskInput } from './task';

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
    return c.json<JobResponse>({ accepted: false, error: 'Missing signature header' }, 401);
  }

  let jobRequest: JobRequest;
  try {
    jobRequest = JSON.parse(body) as JobRequest;
  } catch {
    return c.json<JobResponse>({ accepted: false, error: 'Invalid JSON body' }, 400);
  }

  const verifyResult = await verifyArkeSignature(body, signatureHeader, jobRequest.api_base);
  if (!verifyResult.valid) {
    return c.json<JobResponse>({ accepted: false, error: verifyResult.error ?? 'Invalid signature' }, 401);
  }

  // 3. Validate required fields
  if (!jobRequest.job_id || !jobRequest.target || !jobRequest.log) {
    return c.json<JobResponse>({ accepted: false, error: 'Missing required fields' }, 400);
  }

  const entityId = jobRequest.input?.entity_id;
  if (!entityId) {
    return c.json<JobResponse>({ accepted: false, error: 'Missing entity_id in input' }, 400);
  }

  // 4. Check API key configured
  if (!env.ARKE_API_KEY) {
    return c.json<JobResponse>({ accepted: false, error: 'Agent not configured', retry_after: 60 }, 503);
  }

  // 5. Create initial job state
  const jobState: JobState = {
    job_id: jobRequest.job_id,
    status: 'pending',
    entity_id: entityId,
    target: jobRequest.target,
    log_pi: jobRequest.log.pi,
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

  // Write log to log file entity
  try {
    await writeJobLog(client, state.log_pi, {
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
  return c.json({
    error: 'Not found',
    endpoints: {
      health: 'GET /health',
      process: 'POST /process',
      status: 'GET /status/:job_id',
    },
  }, 404);
});

export default app;
```

---

## Configuration Files

### `package.json`

```json
{
  "name": "arke-agent-template",
  "version": "1.0.0",
  "description": "Template for Arke agents - fork this to create new agents",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@arke-institute/sdk": "^2.1.0",
    "@noble/ed25519": "^2.2.3",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241205.0",
    "typescript": "^5.3.0",
    "wrangler": "^4.0.0"
  }
}
```

### `wrangler.jsonc`

```jsonc
{
  // ============================================================================
  // TEMPLATE: Fork this for your agent
  // 1. Change "name" to your agent name (e.g., "arke-description-agent")
  // 2. Update the custom domain pattern
  // 3. Create a new KV namespace: wrangler kv:namespace create JOBS
  // 4. Update the KV namespace ID below
  // 5. Set secrets: wrangler secret put ARKE_API_KEY
  // ============================================================================

  "name": "arke-agent-template",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],

  "routes": [
    { "pattern": "agent-template.arke.institute", "custom_domain": true }
  ],

  "workers_dev": true,

  "kv_namespaces": [
    {
      "binding": "JOBS",
      "id": "YOUR_KV_NAMESPACE_ID"
    }
  ],

  "vars": {
    "ARKE_API_BASE": "https://arke-v1.arke.institute",
    "AGENT_ID": "agent-template",
    "AGENT_VERSION": "1.0.0"
  }

  // Secrets (set via wrangler secret put):
  // - ARKE_API_KEY: Agent's API key for calling Arke API
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

## Agent Registration in Arke

Deploying the worker is only half the story. You also need to register the agent entity in Arke so it can be invoked.

### Directory Structure (Updated)

```
agent-template/
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── agent.json                   # Agent manifest for registration
├── scripts/
│   └── register.ts              # Registration script
├── .agent-id                    # Stored agent PI (created after first registration)
└── src/
    └── ...
```

### `agent.json` - Agent Manifest

This file defines how the agent should be registered in Arke:

```json
{
  "label": "Agent Template",
  "description": "Template agent - customize this description",
  "endpoint": "https://agent-template.arke.institute",
  "actions_required": ["entity:view", "entity:update"],
  "input_schema": {
    "type": "object",
    "properties": {
      "entity_id": { "type": "string", "description": "Entity to process" },
      "options": { "type": "object", "description": "Agent-specific options" }
    },
    "required": ["entity_id"]
  }
}
```

For orchestrators, also include:
```json
{
  "uses_agents": [
    {
      "pi": "01SUB_AGENT_PI",
      "actions_required": ["entity:view", "entity:update"]
    }
  ]
}
```

### Registration via arke-cli

The simplest way to register agents is using `@arke-institute/cli`. First, authenticate:

```bash
# Option 1: Store API key (persists across sessions)
arke auth set-api-key uk_your_api_key

# Option 2: Use environment variable (one-time)
export ARKE_API_KEY=uk_your_api_key

# Check auth status
arke auth status
```

### `scripts/register.sh` - Registration Script

A simple shell script that reads `agent.json` and calls the CLI:

```bash
#!/bin/bash
set -e

# Read agent.json
LABEL=$(jq -r '.label' agent.json)
DESCRIPTION=$(jq -r '.description' agent.json)
ENDPOINT=$(jq -r '.endpoint' agent.json)
ACTIONS=$(jq -c '.actions_required' agent.json)
INPUT_SCHEMA=$(jq -c '.input_schema // empty' agent.json)
COLLECTION=${AGENT_HOME_COLLECTION:-"01AGENT_HOME_COLLECTION"}

# Check if agent already registered
if [ -f .agent-id ]; then
  AGENT_ID=$(cat .agent-id)
  echo "Updating existing agent: $AGENT_ID"

  # Get current CID for CAS
  CID=$(arke agents get "$AGENT_ID" --json | jq -r '.cid')

  arke agents update "$AGENT_ID" \
    --expect_tip "$CID" \
    --label "$LABEL" \
    --description "$DESCRIPTION" \
    --endpoint "$ENDPOINT" \
    --json

  echo "Agent updated: $AGENT_ID"
else
  echo "Creating new agent..."

  RESULT=$(arke agents create \
    --label "$LABEL" \
    --description "$DESCRIPTION" \
    --endpoint "$ENDPOINT" \
    --actions_required "$ACTIONS" \
    --collection "$COLLECTION" \
    --json)

  AGENT_ID=$(echo "$RESULT" | jq -r '.id')
  echo "$AGENT_ID" > .agent-id
  echo "Agent created: $AGENT_ID"

  # Activate agent
  CID=$(echo "$RESULT" | jq -r '.cid')
  arke agents update "$AGENT_ID" \
    --expect_tip "$CID" \
    --status active \
    --json
  echo "Agent activated"

  # Create API key
  echo ""
  echo "Creating API key..."
  arke agents create-keys "$AGENT_ID" --label "Production" --json
  echo ""
  echo "=========================================="
  echo "SAVE THE API KEY ABOVE!"
  echo "Set it with: wrangler secret put ARKE_API_KEY"
  echo "=========================================="
fi
```

### Updated `package.json` Scripts

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:worker": "wrangler deploy",
    "register": "./scripts/register.sh",
    "deploy:full": "npm run deploy:worker && npm run register",
    "type-check": "tsc --noEmit"
  }
}
```

### Manual Registration (Alternative)

If you prefer manual control:

```bash
# 1. Authenticate
arke auth set-api-key uk_your_api_key

# 2. Create agent
arke agents create \
  --label "Description Agent" \
  --endpoint "https://description-agent.arke.institute" \
  --actions_required '["entity:view","entity:update"]' \
  --collection "01AGENT_HOME_COLLECTION" \
  --json

# 3. Save the returned ID to .agent-id
echo "01RETURNED_AGENT_ID" > .agent-id

# 4. Activate agent
arke agents update 01AGENT_PI \
  --status active \
  --expect_tip bafyrei... \
  --json

# 5. Create API key
arke agents create-keys 01AGENT_PI --label "Production"

# 6. Set secret
wrangler secret put ARKE_API_KEY
# Paste the ak_* key from step 5
```

### Shared Agent Home Collection

All agents are registered in a shared "Agent Home" collection:
- **Owner**: ARCHON (system admin)
- **Public permissions**: `agent:view`, `agent:invoke` (anyone can invoke)
- **Create permission**: ARCHON only (controlled agent registration)

This collection should be bootstrapped once:
```typescript
// scripts/bootstrap-agent-home.ts
const { data } = await client.api.POST('/collections', {
  body: {
    label: 'Arke Agent Home',
    description: 'Shared collection for all Arke agents',
    roles: {
      owner: ['*:*'],
      public: ['agent:view', 'agent:invoke'],
    },
  },
});
console.log('Agent Home Collection:', data.id);
```

---

## How to Fork This Template

1. Copy the `agent-template` folder to a new folder (e.g., `description-agent`)
2. Update `wrangler.jsonc`:
   - Change `name` to your agent name
   - Update the domain pattern
   - Create KV namespace: `wrangler kv:namespace create JOBS`
   - Update the KV namespace ID
   - Update `AGENT_ID` var
3. Update `package.json` name
4. Update `agent.json`:
   - Set `label` and `description`
   - Set `endpoint` to your domain
   - Set `actions_required` for what your agent needs
   - Add `input_schema` describing your input format
5. Implement `task.ts`:
   - Define `TaskOptions` for your agent's options
   - Define `TaskResult` for your agent's output
   - Implement `runTask()` with your processing logic
6. Deploy and register:
   ```bash
   npm run deploy:full
   ```
   This will:
   - Deploy worker to Cloudflare
   - Register agent in Arke (or update if exists)
   - Create API key if needed (you'll need to set it as secret)
7. Set the API key secret:
   ```bash
   wrangler secret put ARKE_API_KEY
   # Paste the key from registration output
   ```
