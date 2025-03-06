#!/bin/sh
# Wait for Redis to be ready
until redis-cli -h redis -p 6379 ping | grep -q PONG; do
  echo "Waiting for Redis..."
  sleep 1
done

# Set initial keys from environment variables
redis-cli -h redis -p 6379 SET TELEGRAM_API_ID "${TELEGRAM_API_ID}"
redis-cli -h redis -p 6379 SET TELEGRAM_API_HASH "${TELEGRAM_API_HASH}"
redis-cli -h redis -p 6379 SET TELEGRAM_SESSION_STRING "${TELEGRAM_SESSION_STRING}"
redis-cli -h redis -p 6379 SET AI_PROVIDER "${AI_PROVIDER}"
redis-cli -h redis -p 6379 SET AI_API_KEY "${AI_API_KEY}"
redis-cli -h redis -p 6379 SET NODE_ENV "${NODE_ENV}"
redis-cli -h redis -p 6379 SET PORT "${PORT}"
redis-cli -h redis -p 6379 SET LOG_LEVEL "${LOG_LEVEL}"
redis-cli -h redis -p 6379 SET MESSAGE_QUEUE_NAME "${MESSAGE_QUEUE_NAME}"
redis-cli -h redis -p 6379 SET MAX_QUEUE_RETRIES "${MAX_QUEUE_RETRIES}"
redis-cli -h redis -p 6379 SET MESSAGE_PROCESS_TIMEOUT "${MESSAGE_PROCESS_TIMEOUT}"

echo "Redis initialization complete."
