#!/bin/sh
set -eu
cd /app
export API_PORT="${PORT:-10000}"
export WORKER_URL="http://127.0.0.1:8008"
python -m uvicorn main:app --app-dir worker --host 127.0.0.1 --port 8008 &
worker_pid=$!
node backend/server.mjs &
node_pid=$!
cleanup() {
  kill "$node_pid" "$worker_pid" 2>/dev/null || true
  wait "$node_pid" "$worker_pid" 2>/dev/null || true
}
trap 'cleanup; exit 0' INT TERM
wait "$node_pid"
code=$?
cleanup
exit "$code"
