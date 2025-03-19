#!/bin/bash

# Create necessary directories
mkdir -p tmp/sessions/user tmp/sessions/pnl_bot src/config

# Ensure the PNL mapping file exists
if [ ! -f "./src/config/pnl-mapping.json" ]; then
    echo "Creating default PNL mapping file..."
    echo '{"signalSources":{"-1002404846297/5":"-1002404846297/178"}}' > ./src/config/pnl-mapping.json
fi

# Check if .env file exists
if [ ! -f "./.env" ]; then
    echo "Error: .env file not found. Please create an .env file with your configuration."
    exit 1
fi

# Start services with Docker Compose
echo "Starting all services..."
docker-compose up -d

# Print status
echo "Services started. Use these commands to manage:"
echo "  - View logs: docker-compose logs -f"
echo "  - Stop services: docker-compose down"
echo "  - Restart a service: docker-compose restart <service>"
echo "  - Available services: app, consumer, pnl-bot, redis"