# Agent Template

Template for single-entity Arke agents. Fork this to create new agents like `description-agent`, `ocr-agent`, `metadata-agent`, etc.

## Authentication Model

Agents in Arke have their own identity and credentials, separate from your user account:

| Key Type | Format | Used For |
|----------|--------|----------|
| **User API Key** | `uk_*` | You use this to register/manage agents (admin actions) |
| **Agent API Key** | `ak_*` | The deployed worker uses this to call Arke API at runtime |

When you register an agent, Arke creates an agent entity and generates an agent-specific API key. This key is what your worker uses when processing jobs.

## Setup

### 1. Clone and configure

```bash
cp -r agent-template my-agent
cd my-agent
npm install
```

Update these files with your agent's details:
- `wrangler.jsonc`: Change `name`, domain, `AGENT_ID`
- `agent.json`: Set `label`, `description`, `endpoint`, `actions_required`
- `package.json`: Update `name`

### 2. Create KV namespace

```bash
wrangler kv:namespace create JOBS
# Copy the ID to wrangler.jsonc
```

### 3. Implement your task

Edit `src/task.ts`:
- Define `TaskOptions` for your agent's options
- Define `TaskResult` for your agent's output
- Implement `runTask()` with your processing logic

### 4. Deploy the worker

```bash
npm run deploy
```

### 5. Register the agent with Arke

This step uses your **user API key** to create the agent and generate its credentials.

```bash
# Set your user API key for registration
export ARKE_API_KEY=uk_your_user_key

# Register (creates agent, generates agent key)
npm run register
```

On first run, this will:
1. Create the agent entity in Arke
2. Activate it
3. Generate an agent API key (`ak_*`)
4. Print the key (save it!)

### 6. Configure the worker with the agent key

Set the **agent API key** (from step 5) as a Cloudflare secret:

```bash
wrangler secret put ARKE_API_KEY
# Paste the ak_* key from registration output
```

Your agent is now deployed and registered.

## Development

```bash
npm run dev          # Run locally
npm run deploy       # Deploy to Cloudflare
npm run register     # Register/update in Arke (test network)
npm run register:prod # Register on production network
npm run type-check
```

## Project Structure

```
my-agent/
├── agent.json            # Agent manifest for Arke registration
├── wrangler.jsonc        # Cloudflare Worker config
├── .agent-id             # Created after first registration (test)
├── .agent-id.prod        # Created after first registration (prod)
├── scripts/
│   └── register.ts       # Registration script
└── src/
    ├── index.ts          # HTTP endpoints (don't modify)
    ├── verify.ts         # Signature verification (don't modify)
    ├── state.ts          # KV state management (don't modify)
    ├── logger.ts         # Job logger (don't modify)
    ├── env.ts            # Environment bindings
    ├── types.ts          # Job types
    └── task.ts           # YOUR TASK IMPLEMENTATION
```

## How It Works

1. Arke invokes your agent via `POST /process` with a signed request
2. Agent verifies signature, creates job state, returns immediately
3. Background processor runs your `runTask()` function
4. Job status is updated in KV (pending → running → done/error)
5. Log is written to the job collection in Arke
6. Arke polls `/status/:job_id` for completion

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /process` | Receive job from Arke (signature verified) |
| `GET /status/:job_id` | Poll job status |

## Example Task Implementation

```typescript
// src/task.ts
export async function runTask(
  client: ArkeClient,
  input: TaskInput,
  context: TaskContext
): Promise<TaskResult> {
  // 1. Fetch entity
  const { data: entity } = await client.api.GET('/entities/{id}', {
    params: { path: { id: input.entity_id } },
  });

  // 2. Do your processing
  const description = await generateDescription(entity);

  // 3. Update entity
  await client.api.PUT('/entities/{id}', {
    params: { path: { id: input.entity_id } },
    body: {
      expect_tip: entity.cid,
      properties_merge: { description },
      note: `Processed by agent (job: ${context.job_id})`,
    },
  });

  // 4. Return result
  return {
    success: true,
    message: 'Description generated',
    data: { description },
  };
}
```
