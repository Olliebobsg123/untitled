#!/bin/zsh
set -e

PROJECT_DIR="/Users/olivergrainger/untitled"

cd "$PROJECT_DIR"

echo ""
echo "=========================================="
echo " Lighting Console — SHOW MODE"
echo "=========================================="
echo ""
echo "Starting from Terminal so macOS uses the same network environment that has been tested successfully."
echo ""

exec npm start
