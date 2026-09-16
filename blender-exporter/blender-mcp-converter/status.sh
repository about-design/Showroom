#!/bin/bash

# Blender MCP System Status Check
# Prüft alle Services und zeigt den aktuellen Status an

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Blender MCP System Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Port Checks
echo "📡 Port Status:"
echo -n "  Port 3000 (API Gateway): "
lsof -i :3000 > /dev/null 2>&1 && echo "✅ In Use" || echo "❌ Free"

echo -n "  Port 8001 (MCP Server): "
lsof -i :8001 > /dev/null 2>&1 && echo "✅ In Use" || echo "❌ Free"

echo -n "  Port 3001-3003 (Frontend): "
lsof -i :3001,3002,3003 > /dev/null 2>&1 && echo "✅ In Use" || echo "❌ Free"

echo ""
echo "🏥 Health Checks:"

# API Gateway
echo -n "  API Gateway: "
if curl -s --max-time 2 http://localhost:3000/api/health > /dev/null 2>&1; then
    STATUS=$(curl -s http://localhost:3000/api/health | jq -r '.status' 2>/dev/null || echo "unknown")
    echo "✅ $STATUS"
else
    echo "❌ Not responding"
fi

# MCP Server via Proxy
echo -n "  MCP Server (via proxy): "
if curl -s --max-time 2 http://localhost:3000/api/health/mcp > /dev/null 2>&1; then
    STATUS=$(curl -s http://localhost:3000/api/health/mcp | jq -r '.status' 2>/dev/null || echo "unknown")
    echo "✅ $STATUS"
else
    echo "❌ Not responding"
fi

# MCP Server Direct
echo -n "  MCP Server (direct): "
if curl -s --max-time 2 http://localhost:8001/health > /dev/null 2>&1; then
    BLENDER=$(curl -s http://localhost:8001/health | jq -r '.blender.version' 2>/dev/null || echo "unknown")
    AVAILABLE=$(curl -s http://localhost:8001/health | jq -r '.blender.available' 2>/dev/null || echo "false")
    if [ "$AVAILABLE" = "true" ]; then
        echo "✅ Healthy (Blender $BLENDER)"
    else
        echo "⚠️  Healthy (Blender not detected)"
    fi
else
    echo "❌ Not responding"
fi

echo ""
echo "🔧 Running Service Processes:"
ps aux | grep -E "(node src/server|uvicorn main|vite)" | grep -v grep | awk '{printf "  PID %s: %s\n", $2, substr($0, index($0,$11))}' | head -5

echo ""
echo "📊 Service URLs:"
echo "  API Gateway:  http://localhost:3000"
echo "  API Docs:     http://localhost:3000/api-docs"
echo "  MCP Server:   http://localhost:8001"
echo "  MCP Docs:     http://localhost:8001/docs"

# Detect Frontend Port
if lsof -i :3001 > /dev/null 2>&1; then
    echo "  Frontend:     http://localhost:3001"
elif lsof -i :3002 > /dev/null 2>&1; then
    echo "  Frontend:     http://localhost:3002"
elif lsof -i :3003 > /dev/null 2>&1; then
    echo "  Frontend:     http://localhost:3003"
else
    echo "  Frontend:     ❌ Not running"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
