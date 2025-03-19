#!/bin/bash
# stop-pnl.sh

echo "Stopping PNL bot..."
docker compose -f docker-compose.pnl.yml down

echo "PNL bot stopped successfully"