# Agent Template

Template for single-entity Arke agents. Fork this to create new agents like `description-agent`, `ocr-agent`, `metadata-agent`, etc.

## Quick Start

1. **Copy this template**
   ```bash
   cp -r agent-template my-agent
   cd my-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Update configuration**
   - `wrangler.jsonc`: Change `name`, domain, `AGENT_ID`
   - `agent.json`: Set `label`, `description`, `endpoint`, `actions_required`
   - `package.json`: Update `name`

4. **Create KV namespace**
   ```bash
   wrangler kv:namespace create JOBS
   # Copy the ID to wrangler.jsonc
   ```

5. **Implement your task**
   Edit `src/task.ts`:
   - Define `TaskOptions` for your agent's options
   - Define `TaskResult` for your agent's output
   - Implement `runTask()` with your processing logic

6. **Authenticate with Arke**
   ```bash
   arke auth set-api-key uk_your_api_key
   ```

7. **Deploy and register**
   ```bash
   npm run deploy:full
   ```

8. **Set the agent API key**
   ```bash
   wrangler secret put ARKE_API_KEY
   # Paste the ak_* key from registration output
   ```

## Project Structure

```
my-agent/
├── package.json
├── wrangler.jsonc        # Cloudflare Worker config
├── tsconfig.json
├── agent.json            # Agent manifest for Arke registration
├── scripts/
│   └── register.sh       # Registration script
├── .agent-id             # Created after first registration
└── src/
    ├── index.ts          # Hono app entry point
    ├── env.ts            # Environment bindings
    ├── types.ts          # Job types
    ├── verify.ts         # Ed25519 signature verification
    ├── state.ts          # KV state management
    ├── logger.ts         # Job logger
    └── task.ts           # YOUR TASK IMPLEMENTATION
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /process` | Receive job from Arke |
| `GET /status/:job_id` | Poll job status |

## How It Works

1. Arke invokes your agent via `POST /process` with a signed request
2. Agent verifies signature, creates job state, returns immediately
3. Background processor runs your `runTask()` function
4. Job status is updated in KV (pending → running → done/error)
5. Log is written to the log file entity in Arke
6. Orchestrator polls `/status/:job_id` for completion

## Development

```bash
npm run dev       # Run locally
npm run deploy    # Deploy to Cloudflare
npm run register  # Register/update in Arke
npm run type-check
```

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
