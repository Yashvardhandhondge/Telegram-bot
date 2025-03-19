#!/bin/bash

# Create necessary directories
mkdir -p tmp/sessions/pnl_bot

# Set environment variables for PNL bot
export SERVICE_TYPE=pnl
export PNL_ENABLED=true

# Log start
echo "Starting PNL bot as standalone service..."
echo "Using PNL_TELEGRAM_SESSION_STRING from .env file"
echo "Session will be stored in tmp/sessions/pnl_bot"

# Run the PNL bot
node src/pnlBot.js