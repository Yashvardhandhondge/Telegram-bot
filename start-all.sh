#!/bin/bash

# Start the main application
echo "Starting main application..."
docker compose up 

# Wait for the main app to fully start
echo "Waiting for main app to initialize..."
sleep 15

# Start the PNL bot in a separate environment
echo "Starting PNL bot..."
docker compose -f docker-compose.pnl.yml up 

echo "All services started"