#!/bin/bash

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Blender MCP Converter Services...${NC}\n"

# Mindestfreier Speicher (MB) für Start – via MIN_FREE_DISK_MB überschreibbar
: "${MIN_FREE_DISK_MB:=512}"

# Projektverzeichnis (robust, unabhängig vom aktuellen Arbeitsverzeichnis)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Shared output directory for all services
BLENDER_OUTPUT_DIR="${PROJECT_DIR}/outputs"
export BLENDER_OUTPUT_DIR
mkdir -p "$BLENDER_OUTPUT_DIR"
echo -e "${YELLOW}BLENDER_OUTPUT_DIR set to ${BLENDER_OUTPUT_DIR}${NC}"

# Upload limits (API Gateway / Multer)
: "${MAX_UPLOAD_FILE_SIZE_MB:=51200}"   # 50GB per uploaded file (e.g. big ZIP)
: "${MAX_UPLOAD_PARTS:=200000}"        # allow many multipart parts/files
: "${MAX_UPLOAD_FIELDS:=20000}"        # allow many form fields
export MAX_UPLOAD_FILE_SIZE_MB MAX_UPLOAD_PARTS MAX_UPLOAD_FIELDS
echo -e "${YELLOW}Upload limits: MAX_UPLOAD_FILE_SIZE_MB=${MAX_UPLOAD_FILE_SIZE_MB}, MAX_UPLOAD_PARTS=${MAX_UPLOAD_PARTS}${NC}"

preflight_checks() {
    echo -e "${YELLOW}Preflight: Disk & Dependencies...${NC}"
    local avail_kb=$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')
    local avail_mb=$((avail_kb / 1024))
    if [ "$avail_mb" -lt "$MIN_FREE_DISK_MB" ]; then
        echo -e "${RED}✗ Zu wenig freier Speicher: ${avail_mb}MB < ${MIN_FREE_DISK_MB}MB erforderlich${NC}"
        echo -e "${RED}  Bereinige uploads/ oder outputs/ bevor du erneut startest.${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ Freier Speicher OK (${avail_mb}MB)${NC}"
    fi
    for cmd in node python3 curl lsof; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            echo -e "${RED}✗ Fehlende Abhängigkeit: $cmd${NC}"; exit 1; fi
    done
    if ! command -v blender >/dev/null 2>&1 && [ ! -x "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
        echo -e "${YELLOW}⚠ Blender nicht gefunden – Konvertierungen schlagen ggf. fehl${NC}"
    else
        echo -e "${GREEN}✓ Blender vorhanden${NC}"
    fi
    mkdir -p "$PROJECT_DIR/api-gateway/logs" "$PROJECT_DIR/mcp-server/logs" "$PROJECT_DIR/frontend/logs"
    echo -e "${GREEN}✓ Log-Verzeichnisse bereit${NC}"
}

preflight_checks

# Definierte Ports
API_PORT=3000
MCP_PORT=8001
FRONTEND_PORT=3001

# Port-Check und Cleanup Funktion
check_and_free_ports() {
    echo -e "${YELLOW}Checking and freeing required ports...${NC}"
    
    # Port 3000 (API Gateway)
    if lsof -ti:$API_PORT > /dev/null 2>&1; then
        echo -e "${YELLOW}  Port $API_PORT in use, freeing...${NC}"
        lsof -ti:$API_PORT | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Port 8001 (MCP Server)
    if lsof -ti:$MCP_PORT > /dev/null 2>&1; then
        echo -e "${YELLOW}  Port $MCP_PORT in use, freeing...${NC}"
        lsof -ti:$MCP_PORT | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Port 3001 (Frontend)
    if lsof -ti:$FRONTEND_PORT > /dev/null 2>&1; then
        echo -e "${YELLOW}  Port $FRONTEND_PORT in use, freeing...${NC}"
        lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    echo -e "${GREEN}✓ All required ports are free${NC}"
}

# Cleanup Funktion
cleanup() {
    echo -e "\n${YELLOW}Stopping all services...${NC}"
    pkill -f "node src/server.js"
    pkill -f "uvicorn main:app"
    pkill -f "vite"
    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

# Trap SIGINT (Ctrl+C)
trap cleanup SIGINT SIGTERM

# Ports vor dem Start freigeben
check_and_free_ports

# 1. API Gateway starten
echo -e "${YELLOW}[1/3] Starting API Gateway on port $API_PORT...${NC}"
cd "$PROJECT_DIR/api-gateway"
npm run --silent mkdir-logs 2>/dev/null || true
mkdir -p logs
npm start > logs/api-gateway.log 2>&1 &
API_PID=$!
echo -e "${GREEN}✓ API Gateway started (PID: $API_PID)${NC}"

# 2. MCP Server starten
echo -e "${YELLOW}[2/3] Starting MCP Server on port $MCP_PORT...${NC}"
cd "$PROJECT_DIR/mcp-server"
source venv/bin/activate
mkdir -p logs
python -m uvicorn main:app --host 0.0.0.0 --port $MCP_PORT > logs/mcp-server.log 2>&1 &
MCP_PID=$!
echo -e "${GREEN}✓ MCP Server started (PID: $MCP_PID)${NC}"

# 3. Frontend starten
echo -e "${YELLOW}[3/3] Starting Frontend on port $FRONTEND_PORT...${NC}"
cd "$PROJECT_DIR/frontend"
mkdir -p logs
npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# Warten und Health-Checks mit Retry-Logik
echo -e "\n${YELLOW}Waiting for services to initialize...${NC}"

wait_for_url() {
    local name="$1"
    local url="$2"
    local timeout="$3" # Sekunden
    local elapsed=0
    local delay=1
    while [ $elapsed -lt $timeout ]; do
        if curl -fsS --max-time 2 "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ $name is healthy${NC}"
            return 0
        fi
        sleep $delay
        elapsed=$((elapsed + delay))
    done
    echo -e "${RED}✗ $name did not respond within ${timeout}s${NC}"
    return 1
}

echo -e "\n${YELLOW}Running health checks...${NC}"

API_OK=1
MCP_OK=1
FRONTEND_OK=1

wait_for_url "API Gateway" "http://localhost:$API_PORT/api/health" 60 && API_OK=0 || API_OK=1
wait_for_url "MCP Server" "http://localhost:$MCP_PORT/health" 45 && MCP_OK=0 || MCP_OK=1
wait_for_url "Frontend" "http://localhost:$FRONTEND_PORT" 60 && FRONTEND_OK=0 || FRONTEND_OK=1

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $API_OK -eq 0 ] && [ $MCP_OK -eq 0 ] && [ $FRONTEND_OK -eq 0 ]; then
    echo -e "${GREEN}All services started successfully!${NC}"
else
    echo -e "${YELLOW}Services started, but some health checks failed.${NC}"
fi
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "API Gateway:  http://localhost:$API_PORT"
echo -e "MCP Server:   http://localhost:$MCP_PORT"
echo -e "Frontend:     http://localhost:$FRONTEND_PORT"
echo -e "\n${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Keep script running
wait
