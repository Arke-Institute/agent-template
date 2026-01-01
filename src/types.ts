import type { TaskInput, TaskResult } from './task';

// What Arke sends us
export interface JobRequest {
  job_id: string;
  target: string; // Collection ID
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
