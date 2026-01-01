export interface Env {
  // KV for job state
  JOBS: KVNamespace;

  // Agent configuration
  ARKE_API_KEY: string; // Secret: agent's API key
  ARKE_API_BASE: string; // Default: https://arke-v1.arke.institute

  // Agent identity (for logging)
  AGENT_ID: string; // e.g., "description-agent"
  AGENT_VERSION: string; // e.g., "1.0.0"
}
