/**
 * Agent Testing Utilities
 *
 * Self-contained utilities for testing agents end-to-end against the real Arke API.
 * All tests run on the test network (X-Arke-Network: test) which creates II-prefixed
 * entities in isolated storage, keeping test data separate from production.
 *
 * Usage:
 *   npm run test        # Run tests
 *   npm run test:watch  # Run in watch mode
 */

import { ArkeClient } from '@arke-institute/sdk';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

export interface TestConfig {
  /** Base URL for Arke API */
  baseUrl: string;
  /** API key for testing */
  apiKey: string;
  /** Agent endpoint URL */
  agentEndpoint: string;
  /** Agent ID (from agent.json or env) */
  agentId: string;
}

/**
 * Load test configuration from environment and agent.json
 *
 * All tests run against the test network (X-Arke-Network: test) which:
 * - Creates II-prefixed entity IDs
 * - Uses isolated storage paths (/arke/test/index/...)
 * - Keeps test data separate from production
 */
export function loadTestConfig(): TestConfig {
  // Load from .env.test if it exists
  const envPath = path.resolve(process.cwd(), '.env.test');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0 && !line.trim().startsWith('#')) {
        const key = line.slice(0, eqIndex).trim();
        const value = line.slice(eqIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }

  // Required: API key
  const apiKey = process.env.ARKE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ARKE_API_KEY environment variable is required.\n' +
        'Create a .env.test file with:\n' +
        '  ARKE_API_KEY=uk_your_api_key_here'
    );
  }

  // Load agent.json for defaults
  const agentJsonPath = path.resolve(process.cwd(), 'agent.json');
  let agentConfig: { id?: string; endpoint?: string } = {};
  if (fs.existsSync(agentJsonPath)) {
    agentConfig = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'));
  }

  // Load agent ID from .agent-id file (created by register script)
  const agentIdPath = path.resolve(process.cwd(), '.agent-id');
  let agentIdFromFile = '';
  if (fs.existsSync(agentIdPath)) {
    agentIdFromFile = fs.readFileSync(agentIdPath, 'utf-8').trim();
  }

  return {
    baseUrl: process.env.ARKE_API_URL || 'https://arke-v1.arke.institute',
    apiKey,
    agentEndpoint: process.env.AGENT_ENDPOINT || agentConfig.endpoint || '',
    agentId: process.env.AGENT_ID || agentIdFromFile || agentConfig.id || '',
  };
}

// =============================================================================
// Test Client
// =============================================================================

let cachedClient: ArkeClient | null = null;
let cachedConfig: TestConfig | null = null;

/**
 * Get configured ArkeClient for tests
 *
 * Uses test network (X-Arke-Network: test) which creates II-prefixed
 * entity IDs in isolated storage, keeping test data separate from production.
 */
export function getTestClient(): ArkeClient {
  if (cachedClient) return cachedClient;

  const config = getTestConfig();

  cachedClient = new ArkeClient({
    baseUrl: config.baseUrl,
    authToken: config.apiKey,
    network: 'test',
  });

  return cachedClient;
}

/**
 * Get test configuration
 */
export function getTestConfig(): TestConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = loadTestConfig();
  return cachedConfig;
}

/**
 * Get auth headers for direct fetch calls
 *
 * Uses test network (X-Arke-Network: test) which creates II-prefixed
 * entity IDs in isolated storage, keeping test data separate from production.
 */
export function getAuthHeaders(): Record<string, string> {
  const config = getTestConfig();
  return {
    Authorization: `ApiKey ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-Arke-Network': 'test',
  };
}

/**
 * Reset cached client (useful between tests if needed)
 */
export function resetTestClient(): void {
  cachedClient = null;
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a test collection for agent testing
 */
export async function createTestCollection(label?: string): Promise<{
  id: string;
  cid: string;
}> {
  const config = getTestConfig();
  const headers = getAuthHeaders();

  const response = await fetch(`${config.baseUrl}/collections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: label || `Test Collection ${Date.now()}`,
      description: 'Temporary collection for agent E2E testing',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create test collection: ${error}`);
  }

  return response.json();
}

/**
 * Create a test entity (file placeholder) in a collection
 */
export async function createTestEntity(
  collectionId: string,
  label?: string,
  properties?: Record<string, unknown>
): Promise<{ id: string; cid: string }> {
  const config = getTestConfig();
  const headers = getAuthHeaders();

  const key = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const response = await fetch(`${config.baseUrl}/files`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      key,
      filename: label || `test-${Date.now()}.txt`,
      content_type: 'text/plain',
      size: 100,
      collection: collectionId,
      ...properties,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create test entity: ${error}`);
  }

  return response.json();
}

// =============================================================================
// Agent Invocation
// =============================================================================

export interface InvokeOptions {
  /** Target entity or collection ID */
  target: string;
  /** Input data for the agent */
  input?: Record<string, unknown>;
  /** Expiration time in seconds (default: 3600) */
  expires_in?: number;
  /** Skip user confirmation (default: true for tests) */
  confirm?: boolean;
}

export interface InvokeResult {
  status: 'started' | 'error';
  job_id?: string;
  job_collection?: string;
  error?: string;
}

/**
 * Invoke an agent via the Arke API
 */
export async function invokeAgent(options: InvokeOptions): Promise<InvokeResult> {
  const config = getTestConfig();
  const headers = getAuthHeaders();

  if (!config.agentId) {
    throw new Error(
      'Agent ID not configured. Set AGENT_ID env var or add "id" to agent.json'
    );
  }

  const response = await fetch(`${config.baseUrl}/agents/${config.agentId}/invoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      target: options.target,
      input: options.input || {},
      expires_in: options.expires_in || 3600,
      confirm: options.confirm ?? true,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      status: 'error',
      error: data.error || 'Unknown error',
    };
  }

  return data;
}

// =============================================================================
// Status Polling
// =============================================================================

export interface JobStatus {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  started_at?: string;
  completed_at?: string;
}

/**
 * Poll agent status until completion or timeout
 */
export async function pollAgentStatus(
  jobId: string,
  options: {
    /** Polling interval in ms (default: 1000) */
    interval?: number;
    /** Timeout in ms (default: 60000) */
    timeout?: number;
  } = {}
): Promise<JobStatus> {
  const config = getTestConfig();
  const interval = options.interval || 1000;
  const timeout = options.timeout || 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const response = await fetch(`${config.agentEndpoint}/status/${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to get status: ${await response.text()}`);
    }

    const status: JobStatus = await response.json();

    if (status.status === 'done' || status.status === 'error') {
      return status;
    }

    await sleep(interval);
  }

  throw new Error(`Polling timeout after ${timeout}ms`);
}

// =============================================================================
// Job Collection Verification
// =============================================================================

export interface JobCollectionInfo {
  id: string;
  cid: string;
  properties: {
    _job_version?: string;
    status?: string;
    agent?: { pi: string };
    main_agent?: { pi: string };
    target?: { pi: string };
    started_at?: string;
    completed_at?: string;
  };
}

/**
 * Get job collection details
 */
export async function getJobCollection(jobCollectionId: string): Promise<JobCollectionInfo> {
  const config = getTestConfig();
  const headers = getAuthHeaders();

  const response = await fetch(`${config.baseUrl}/collections/${jobCollectionId}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to get job collection: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Get children (files) in a job collection by checking contains relationships
 */
export async function getJobCollectionFiles(
  jobCollectionId: string
): Promise<Array<{ id: string; cid: string; properties: Record<string, unknown> }>> {
  const config = getTestConfig();
  const headers = getAuthHeaders();

  // Get the job collection to find contains relationships
  const collectionRes = await fetch(
    `${config.baseUrl}/collections/${jobCollectionId}`,
    { headers }
  );

  if (!collectionRes.ok) {
    throw new Error(`Failed to get job collection: ${await collectionRes.text()}`);
  }

  const collection = await collectionRes.json();

  // Find all 'contains' relationships
  const containsRels = collection.relationships?.filter(
    (r: { predicate: string }) => r.predicate === 'contains'
  ) || [];

  // Fetch each contained entity
  const files: Array<{ id: string; cid: string; properties: Record<string, unknown> }> = [];
  for (const rel of containsRels) {
    const entityRes = await fetch(
      `${config.baseUrl}/entities/${rel.peer}`,
      { headers }
    );
    if (entityRes.ok) {
      const entity = await entityRes.json();
      files.push({
        id: entity.id,
        cid: entity.cid,
        properties: entity.properties,
      });
    }
  }

  return files;
}

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to run a full agent test cycle
 */
export async function runAgentTestCycle(options: {
  /** Label for test collection */
  collectionLabel?: string;
  /** Number of test entities to create */
  entityCount?: number;
  /** Input data for agent */
  input?: Record<string, unknown>;
  /** Timeout for polling */
  timeout?: number;
}): Promise<{
  collection: { id: string; cid: string };
  entities: Array<{ id: string; cid: string }>;
  invokeResult: InvokeResult;
  finalStatus: JobStatus;
  jobCollection?: JobCollectionInfo;
}> {
  const entityCount = options.entityCount || 1;

  // 1. Create test collection
  const collection = await createTestCollection(options.collectionLabel);

  // 2. Create test entities
  const entities: Array<{ id: string; cid: string }> = [];
  for (let i = 0; i < entityCount; i++) {
    const entity = await createTestEntity(collection.id, `Test Entity ${i + 1}`);
    entities.push(entity);
  }

  // 3. Invoke agent
  const invokeResult = await invokeAgent({
    target: collection.id,
    input: {
      entity_id: entities[0].id,
      ...options.input,
    },
  });

  if (invokeResult.status !== 'started' || !invokeResult.job_id) {
    throw new Error(`Agent invocation failed: ${invokeResult.error}`);
  }

  // 4. Poll for completion
  const finalStatus = await pollAgentStatus(invokeResult.job_id, {
    timeout: options.timeout || 60000,
  });

  // 5. Get job collection info (if available)
  let jobCollection: JobCollectionInfo | undefined;
  if (invokeResult.job_collection) {
    jobCollection = await getJobCollection(invokeResult.job_collection);
  }

  return {
    collection,
    entities,
    invokeResult,
    finalStatus,
    jobCollection,
  };
}
