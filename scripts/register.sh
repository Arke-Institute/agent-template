#!/bin/bash
set -e

# Registration script for Arke agents
# Requires: arke-cli authenticated (arke auth set-api-key or ARKE_API_KEY env var)
# Requires: jq for JSON parsing

# Check dependencies
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed"
  exit 1
fi

if ! command -v arke &> /dev/null; then
  echo "Error: arke-cli is required but not installed"
  echo "Install with: npm install -g @arke-institute/cli"
  exit 1
fi

# Check auth
if ! arke auth status &> /dev/null; then
  echo "Error: Not authenticated with Arke"
  echo "Run: arke auth set-api-key <your-key>"
  exit 1
fi

# Read agent.json
if [ ! -f agent.json ]; then
  echo "Error: agent.json not found"
  exit 1
fi

LABEL=$(jq -r '.label' agent.json)
DESCRIPTION=$(jq -r '.description' agent.json)
ENDPOINT=$(jq -r '.endpoint' agent.json)
ACTIONS=$(jq -c '.actions_required' agent.json)
INPUT_SCHEMA=$(jq -c '.input_schema // empty' agent.json)
COLLECTION=${AGENT_HOME_COLLECTION:-"01AGENT_HOME_COLLECTION"}

echo "Agent: $LABEL"
echo "Endpoint: $ENDPOINT"
echo "Actions: $ACTIONS"
echo ""

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
