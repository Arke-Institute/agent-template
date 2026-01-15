/**
 * Agent E2E Tests
 *
 * Tests the agent end-to-end against the real Arke API.
 * All tests run on the test network, creating II-prefixed entities
 * in isolated storage separate from production.
 *
 * Tests use isolated test users:
 * 1. Admin API key creates a temporary test user (expires in 1 hour)
 * 2. All test operations run under the test user's API key
 * 3. This keeps test data completely isolated from the admin account
 *
 * Run with:
 *   npm run test        # Run tests
 *   npm run test:watch  # Run in watch mode
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestConfig,
  initTestContext,
  cleanupTestContext,
  createTestCollection,
  createTestEntity,
  invokeAgent,
  pollAgentStatus,
  getJobCollection,
  getJobCollectionFiles,
  type TestConfig,
  type TestUser,
} from './test-utils';

describe('Agent E2E', () => {
  let config: TestConfig;
  let testUser: TestUser;

  beforeAll(async () => {
    config = getTestConfig();
    console.log(`Testing against test network at ${config.baseUrl}`);
    console.log(`Agent: ${config.agentId} @ ${config.agentEndpoint}`);

    // Create isolated test user for this test run
    console.log('Creating test user...');
    testUser = await initTestContext('Agent E2E Test');
    console.log(`Test user: ${testUser.id}`);
  });

  afterAll(() => {
    cleanupTestContext();
  });

  it('should process a single entity and create job log', async () => {
    // 1. Create test collection and entity
    const collection = await createTestCollection('Agent E2E Test');
    const entity = await createTestEntity(collection.id, 'Test Entity');

    // 2. Invoke the agent
    const invokeResult = await invokeAgent({
      target: collection.id,
      input: { entity_id: entity.id },
    });

    if (invokeResult.status === 'error') {
      console.log('Invoke error:', invokeResult.error);
    }
    expect(invokeResult.status).toBe('started');
    expect(invokeResult.job_id).toBeDefined();
    expect(invokeResult.job_collection).toBeDefined();

    // 3. Poll until completion
    const finalStatus = await pollAgentStatus(invokeResult.job_id!, {
      timeout: 30000,
    });

    if (finalStatus.status === 'error') {
      console.log('Job error:', JSON.stringify(finalStatus.error, null, 2));
    }
    expect(finalStatus.status).toBe('done');
    expect(finalStatus.completed_at).toBeDefined();

    // 4. Verify job collection structure
    // Wait a moment for async job collection update
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const jobCollection = await getJobCollection(invokeResult.job_collection!);

    expect(jobCollection.properties._job_version).toBe('v1');
    // Job collection status may be 'running' or 'done' depending on timing
    expect(['running', 'done']).toContain(jobCollection.properties.status);
    expect(jobCollection.properties.agent?.pi).toBe(config.agentId);

    // 5. Verify log file was created
    const files = await getJobCollectionFiles(invokeResult.job_collection!);

    expect(files.length).toBeGreaterThan(0);

    const logFile = files.find((f) => {
      const props = f.properties as { log_data?: unknown };
      return props.log_data !== undefined;
    });

    expect(logFile).toBeDefined();
  }, 60000);
});
