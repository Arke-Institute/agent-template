import type { JobState } from './types';

const KV_TTL = 86400; // 24 hours

export async function getJobState(
  kv: KVNamespace,
  jobId: string
): Promise<JobState | null> {
  const data = await kv.get(`job:${jobId}`, 'json');
  return data as JobState | null;
}

export async function saveJobState(
  kv: KVNamespace,
  state: JobState
): Promise<void> {
  await kv.put(`job:${state.job_id}`, JSON.stringify(state), {
    expirationTtl: KV_TTL,
  });
}
