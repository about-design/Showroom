#!/bin/bash

#!/bin/bash

# Blender MCP Converter - Startup Script
# Startet alle Services: API Gateway, MCP Server, Frontend

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BLENDER_OUTPUT_DIR="${PROJECT_ROOT}/outputs"
mkdir -p "$BLENDER_OUTPUT_DIR"
echo "BLENDER_OUTPUT_DIR set to $BLENDER_OUTPUT_DIR"

echo "🚀 Starting Blender MCP Converter System..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if we're on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    print_status "Detected macOS system"
    IS_MACOS=true
else
    print_status "Detected non-macOS system"
    IS_MACOS=false
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
print_step "Checking system dependencies..."

if ! command_exists node; then
    print_error "Node.js not found. Please install Node.js >= 20.0"
    exit 1
fi

if ! command_exists python3; then
    print_error "Python 3 not found. Please install Python >= 3.10"
    exit 1
fi

if ! command_exists redis-cli; then
    print_warning "Redis CLI not found. Installing Redis..."
    if $IS_MACOS; then
        if command_exists brew; then
            brew install redis
        else
            print_error "Homebrew not found. Please install Redis manually"
            exit 1
        fi
    else
        print_error "Please install Redis manually"
        exit 1
    fi
fi

print_status "All dependencies found"

# Detect Blender installation
print_step "Detecting Blender installation..."
BLENDER_PATH=""

if $IS_MACOS; then
    # macOS: Check common installation paths
    MACOS_PATHS=(
        "/Applications/Blender.app/Contents/MacOS/Blender"
        "/Applications/Blender 4.2.app/Contents/MacOS/Blender"
        "/Applications/Blender 4.1.app/Contents/MacOS/Blender"
        "/Applications/Blender 4.0.app/Contents/MacOS/Blender"
        "/Applications/Blender 3.6.app/Contents/MacOS/Blender"
    )
    
    for path in "${MACOS_PATHS[@]}"; do
        if [[ -f "$path" ]]; then
            BLENDER_PATH="$path"
            print_status "Found Blender at: $BLENDER_PATH"
            break
        fi
    done
else
    # Linux: Check common paths
    LINUX_PATHS=(
        "/usr/bin/blender"
        "/snap/bin/blender"
        "/usr/local/bin/blender"
        "/opt/blender/blender"
    )
    
    for path in "${LINUX_PATHS[@]}"; do
        if [[ -f "$path" ]]; then
            BLENDER_PATH="$path"
            print_status "Found Blender at: $BLENDER_PATH"
            break
        fi
    done
fi

if [[ -z "$BLENDER_PATH" ]]; then
    if command_exists blender; then
        BLENDER_PATH="blender"
        print_status "Found Blender in PATH"
    else
        print_error "Blender not found! Please install Blender from https://www.blender.org"
        print_error "Expected locations:"
        if $IS_MACOS; then
            echo "  - /Applications/Blender.app/Contents/MacOS/Blender"
        else
            echo "  - /usr/bin/blender"
            echo "  - /snap/bin/blender"
        fi
        exit 1
    fi
fi

# Test Blender
print_step "Testing Blender installation..."
if "$BLENDER_PATH" --version >/dev/null 2>&1; then
    BLENDER_VERSION=$("$BLENDER_PATH" --version 2>/dev/null | head -n 1)
    print_status "Blender test successful: $BLENDER_VERSION"
else
    print_error "Blender test failed. Please check installation"
    exit 1
fi

# Start Redis if not running
print_step "Starting Redis server..."
if ! pgrep -x "redis-server" > /dev/null; then
    if $IS_MACOS; then
        brew services start redis
        sleep 2
    else
        sudo systemctl start redis
        sleep 2
    fi
    print_status "Redis server started"
else
    print_status "Redis server already running"
fi

# Test Redis connection
if redis-cli ping >/dev/null 2>&1; then
    print_status "Redis connection successful"
else
    print_error "Redis connection failed"
    exit 1
fi

# Install dependencies if needed
print_step "Installing dependencies..."

# API Gateway dependencies
if [[ ! -d "api-gateway/node_modules" ]]; then
    print_status "Installing API Gateway dependencies..."
    cd api-gateway
    npm install
    cd ..
fi

# MCP Server dependencies
if [[ ! -d "mcp-server/venv" ]]; then
    print_status "Setting up MCP Server virtual environment..."
    cd mcp-server
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    deactivate
    cd ..
fi

# Frontend dependencies
if [[ ! -d "frontend/node_modules" ]]; then
    print_status "Installing Frontend dependencies..."
    cd frontend
    npm install
    cd ..
fi

# Set environment variables
export BLENDER_PATH="$BLENDER_PATH"
export NODE_ENV="development"

print_step "Starting services..."

# Create log directory
mkdir -p logs

# Start API Gateway in background
print_status "Starting API Gateway (Port 3000)..."
cd api-gateway
npm run dev > ../logs/api-gateway.log 2>&1 &
API_PID=$!
cd ..
sleep 3

# Start MCP Server in background
print_status "Starting MCP Server (Port 8001)..."
cd mcp-server
source venv/bin/activate
python -m uvicorn main:app --reload --port 8001 > ../logs/mcp-server.log 2>&1 &
MCP_PID=$!
deactivate
cd ..
sleep 3

# Start Frontend in background
print_status "Starting Frontend (Port 3001)..."
cd frontend
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
sleep 3

# Function to cleanup on exit
cleanup() {
    print_step "Shutting down services..."
    
    if [[ -n "$API_PID" ]]; then
        print_status "Stopping API Gateway (PID: $API_PID)"
        kill $API_PID 2>/dev/null || true
    fi
    
    if [[ -n "$MCP_PID" ]]; then
        print_status "Stopping MCP Server (PID: $MCP_PID)"
        kill $MCP_PID 2>/dev/null || true
    fi
    
    if [[ -n "$FRONTEND_PID" ]]; then
        print_status "Stopping Frontend (PID: $FRONTEND_PID)"
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Kill any remaining node processes for this project
    pkill -f "uvicorn.*8001" 2>/dev/null || true
    pkill -f "vite.*3001" 2>/dev/null || true
    
    print_status "All services stopped"
    exit 0
}

# Set trap to cleanup on exit
trap cleanup SIGINT SIGTERM EXIT

# Wait for services to start
print_step "Waiting for services to initialize..."
sleep 5

# Health checks
print_step "Performing health checks..."

# Check API Gateway
if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    print_status "✅ API Gateway is healthy (Port 3000)"
else
    print_error "❌ API Gateway health check failed"
fi

# Check MCP Server
if curl -s http://localhost:8001/health >/dev/null 2>&1; then
    print_status "✅ MCP Server is healthy (Port 8001)"
else
    print_error "❌ MCP Server health check failed"
fi

# Check Frontend
if curl -s http://localhost:3001 >/dev/null 2>&1; then
    print_status "✅ Frontend is running (Port 3001)"
else
    print_error "❌ Frontend health check failed"
fi

# Display startup summary
echo ""
echo "🎉 Blender MCP Converter System Started Successfully!"
echo ""
echo "📱 Frontend:           http://localhost:3001"
echo "🚀 API Gateway:        http://localhost:3000"
echo "🔧 MCP Server:         http://localhost:8001"
echo "📊 API Health:         http://localhost:3000/api/health"
echo "🔍 MCP Health:         http://localhost:8001/health"
echo ""
echo "📝 Logs:"
echo "   - API Gateway:      logs/api-gateway.log"
echo "   - MCP Server:       logs/mcp-server.log"
echo "   - Frontend:         logs/frontend.log"
echo ""
print_status "System ready for 3D model conversion!"
print_status "Press Ctrl+C to stop all services"

# Keep script running and show real-time status
while true; do
    sleep 30
    
    # Quick health check every 30 seconds
    if ! curl -s http://localhost:3000/health >/dev/null 2>&1; then
        print_error "API Gateway became unresponsive"
    fi
    
    if ! curl -s http://localhost:8001/health >/dev/null 2>&1; then
        print_error "MCP Server became unresponsive"
    fi
done

set -e

echo "🚀 Starting Blender MCP Conversion System"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a port is in use
port_in_use() {
    lsof -i :$1 >/dev/null 2>&1
}

echo "🔍 Checking system requirements..."

# Check Node.js
if ! command_exists node; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 20 or higher.${NC}"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'.' -f1 | cut -d'v' -f2)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}❌ Node.js version must be 20 or higher. Current: $(node --version)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# Check Python
if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.10 or higher.${NC}"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1-2)
echo -e "${GREEN}✅ Python $PYTHON_VERSION${NC}"

# Check Blender
BLENDER_EXECUTABLE=""
if command_exists blender; then
    BLENDER_EXECUTABLE="blender"
    BLENDER_VERSION=$(blender --version | head -n1)
    echo -e "${GREEN}✅ $BLENDER_VERSION${NC}"
elif [ -f "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER_EXECUTABLE="/Applications/Blender.app/Contents/MacOS/Blender"
    BLENDER_VERSION=$("$BLENDER_EXECUTABLE" --version | head -n1)
    echo -e "${GREEN}✅ $BLENDER_VERSION (macOS App Bundle)${NC}"
elif [ -f "/usr/local/bin/blender" ]; then
    BLENDER_EXECUTABLE="/usr/local/bin/blender"
    BLENDER_VERSION=$("$BLENDER_EXECUTABLE" --version | head -n1)
    echo -e "${GREEN}✅ $BLENDER_VERSION (Homebrew)${NC}"
else
    echo -e "${YELLOW}⚠️  Blender not found. Please install Blender.${NC}"
    echo "   You can download Blender from: https://www.blender.org/download/"
    echo "   Or install via package manager:"
    echo "   - macOS: brew install blender"
    echo "   - Ubuntu: sudo apt install blender"
    echo ""
    echo "   If Blender is already installed, make sure it's in one of these locations:"
    echo "   - /Applications/Blender.app/Contents/MacOS/Blender"
    echo "   - /usr/local/bin/blender"
    echo "   - Add blender to your PATH"
    exit 1
fi

# Check Redis (optional)
if ! command_exists redis-server; then
    echo -e "${YELLOW}⚠️  Redis not found. Job queue will use in-memory storage.${NC}"
    echo "   To install Redis:"
    echo "   - macOS: brew install redis"
    echo "   - Ubuntu: sudo apt install redis-server"
else
    echo -e "${GREEN}✅ Redis available${NC}"
fi

echo ""
echo "📦 Setting up dependencies..."

# Setup API Gateway
echo "Setting up Node.js API Gateway..."
cd api-gateway
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}📄 Created .env file from .env.example. Please review the configuration.${NC}"
fi

if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
fi
cd ..

# Setup MCP Server
echo "Setting up Python MCP Server..."
cd mcp-server
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}📄 Created .env file from .env.example. Please review the configuration.${NC}"
fi

# Update .env with detected Blender path if using auto-detection
if [ "$BLENDER_EXECUTABLE" != "blender" ] && [ -f ".env" ]; then
    if grep -q "BLENDER_EXECUTABLE=auto" .env; then
        sed -i.bak "s|BLENDER_EXECUTABLE=auto|BLENDER_EXECUTABLE=$BLENDER_EXECUTABLE|g" .env
        echo -e "${GREEN}✅ Updated .env with Blender path: $BLENDER_EXECUTABLE${NC}"
    fi
fi

if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "Activating virtual environment and installing dependencies..."
source venv/bin/activate
pip install -r requirements.txt
cd ..

echo ""
echo "🎯 Starting services..."

# Start Redis if available
if command_exists redis-server && ! port_in_use 6379; then
    echo "Starting Redis server..."
    redis-server --daemonize yes --port 6379 --loglevel warning
    sleep 2
fi

# Start MCP Server
echo "Starting MCP Server on port 8000..."
cd mcp-server
source venv/bin/activate
python main.py &
MCP_PID=$!
cd ..

# Wait for MCP server to start
sleep 5

# Check if MCP server is running
if ! port_in_use 8000; then
    echo -e "${RED}❌ MCP Server failed to start${NC}"
    kill $MCP_PID 2>/dev/null || true
    exit 1
fi

# Start API Gateway
echo "Starting API Gateway on port 3000..."
cd api-gateway
npm start &
API_PID=$!
cd ..

# Wait for API Gateway to start
sleep 5

# Check if API Gateway is running
if ! port_in_use 3000; then
    echo -e "${RED}❌ API Gateway failed to start${NC}"
    kill $MCP_PID 2>/dev/null || true
    kill $API_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Blender MCP Conversion System is running!${NC}"
echo ""
echo "📍 Services:"
echo "   API Gateway: http://localhost:3000"
echo "   MCP Server:  http://localhost:8000"
echo ""
echo "🔗 API Endpoints:"
echo "   POST /api/v1/convert - Upload and convert files"
echo "   GET  /api/v1/status/:jobId - Check job status"
echo "   GET  /api/v1/download/:jobId - Download converted file"
echo ""
echo "📖 For detailed usage instructions, see README.md"
echo ""
echo "🛑 To stop all services, press Ctrl+C or run: pkill -f 'node.*server.js'; pkill -f 'python.*main.py'"

# Keep the script running
wait