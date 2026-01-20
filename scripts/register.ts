#!/usr/bin/env npx tsx
/**
 * Agent Registration Script
 *
 * Registers the agent with Arke API. By default registers on test network.
 * Use --production flag to register on production network.
 *
 * Usage:
 *   npm run register           # Register on test network (default)
 *   npm run register:prod      # Register on production network
 *
 * Environment (.env.test):
 *   ARKE_USER_KEY  - Required: Your user API key for registration
 *   ARKE_API_URL   - Optional: API URL override
 *   AGENT_HOME     - Optional: Collection ID for agent home
 *
 * State Files (gitignored, managed automatically):
 *   .agent-state.json  - Agent IDs and metadata per network
 *   .agent-keys.json   - Agent API keys (secure permissions)
 *   agents.registry.json (repo root) - Shared agent home collection IDs
 */

import { runCli } from '@arke-institute/agent-core/register';

runCli();
