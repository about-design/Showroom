#!/bin/bash

# Start services in background with proper file handling
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🚀 Starting Services in Background...${NC}"

# Share a single output directory across services
OUTPUT_DIR="$PROJECT_DIR/outputs"
export BLENDER_OUTPUT_DIR="$OUTPUT_DIR"
mkdir -p "$BLENDER_OUTPUT_DIR"

# Upload limits (API Gateway / Multer)
# For very large batches (e.g. thousands of files) prefer uploading as ZIP.
: "${MAX_UPLOAD_FILE_SIZE_MB:=51200}"   # 50GB per uploaded file (e.g. big ZIP)
: "${MAX_UPLOAD_PARTS:=200000}"        # allow many multipart parts/files
: "${MAX_UPLOAD_FIELDS:=20000}"        # allow many form fields (safe default)
export MAX_UPLOAD_FILE_SIZE_MB MAX_UPLOAD_PARTS MAX_UPLOAD_FIELDS

# GLB optimization (gltf-transform + gltfpack)
: "${DEFAULT_OPTIMIZE_GLB:=true}"
export DEFAULT_OPTIMIZE_GLB

# Surface the configuration for transparency
echo -e "${YELLOW}Using BLENDER_OUTPUT_DIR=${BLENDER_OUTPUT_DIR}${NC}"
echo -e "${YELLOW}Upload limits: MAX_UPLOAD_FILE_SIZE_MB=${MAX_UPLOAD_FILE_SIZE_MB}, MAX_UPLOAD_PARTS=${MAX_UPLOAD_PARTS}${NC}"
echo -e "${YELLOW}GLB optimization: DEFAULT_OPTIMIZE_GLB=${DEFAULT_OPTIMIZE_GLB}${NC}"

# Clean up existing processes
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8001 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 2

# 1. Start MCP Server (use python3 instead of venv)
echo -e "${YELLOW}Starting MCP Server...${NC}"
cd "$PROJECT_DIR/mcp-server"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 > /tmp/mcp-server.log 2>&1 &
MCP_PID=$!
echo -e "${GREEN}✓ MCP Server started (PID: $MCP_PID)${NC}"

# 2. Start API Gateway
echo -e "${YELLOW}Starting API Gateway...${NC}"
cd "$PROJECT_DIR/api-gateway"
# Use nodemon in dev so route/code changes apply without manual restarts.
PORT=3000 npm run dev > /tmp/api-gateway.log 2>&1 &
API_PID=$!
echo -e "${GREEN}✓ API Gateway started (PID: $API_PID)${NC}"

# 3. Start Frontend
echo -e "${YELLOW}Starting Frontend...${NC}"
cd "$PROJECT_DIR/frontend"
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

echo -e "\n${YELLOW}Waiting for services to initialize...${NC}"
sleep 10

# Check if services are running
echo -e "\n${YELLOW}Checking service status...${NC}"
if lsof -i:8001 > /dev/null 2>&1; then
    echo -e "${GREEN}✓ MCP Server:   http://localhost:8001 (running)${NC}"
else
    echo -e "${RED}✗ MCP Server:   FAILED (check /tmp/mcp-server.log)${NC}"
fi

if lsof -i:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API Gateway:  http://localhost:3000 (running)${NC}"
else
    echo -e "${RED}✗ API Gateway:  FAILED (check /tmp/api-gateway.log)${NC}"
fi

if lsof -i:3001 > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend:     http://localhost:3001 (running)${NC}"
else
    echo -e "${RED}✗ Frontend:     FAILED (check /tmp/frontend.log)${NC}"
fi

echo -e "\n${YELLOW}Log files:${NC}"
echo "  MCP Server:   /tmp/mcp-server.log"
echo "  API Gateway:  /tmp/api-gateway.log"
echo "  Frontend:     /tmp/frontend.log"
echo -e "\n${YELLOW}To stop all services:${NC}"
echo "  lsof -ti:3000,8001,3001 | xargs kill -9"
