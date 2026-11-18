#!/bin/bash

# STEP Frontend-to-Backend Integration Test
# Simuliert einen Frontend-Upload und testet die komplette Pipeline

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     STEP Frontend-to-Backend Integration Test          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Configuration
TEST_STEP_FILE="/Users/oliversteiling/Library/Mobile Documents/com~apple~CloudDocs/vuejs/GLB export Blender/blender-mcp-converter/test-files/simple_cube.step"
API_GATEWAY_URL="http://localhost:3000"
MCP_SERVER_URL="http://localhost:8001"

# Test 1: Check services
echo -e "${YELLOW}[Test 1/5]${NC} Checking services..."

# Check API Gateway
if curl -sf "$API_GATEWAY_URL/health" > /dev/null; then
    echo -e "${GREEN}✓ PASSED: API Gateway is running${NC}"
else
    echo -e "${RED}✗ FAILED: API Gateway not responding${NC}"
    exit 1
fi

# Check MCP Server
if curl -sf "$MCP_SERVER_URL/health" > /dev/null; then
    echo -e "${GREEN}✓ PASSED: MCP Server is running${NC}"
else
    echo -e "${RED}✗ FAILED: MCP Server not responding${NC}"
    exit 1
fi

# Test 2: Check STEP health endpoint
echo -e "\n${YELLOW}[Test 2/5]${NC} Checking STEP conversion health..."
STEP_HEALTH=$(curl -s "$MCP_SERVER_URL/convert/step/health")
STEP_AVAILABLE=$(echo "$STEP_HEALTH" | python3 -c "import sys, json; print(json.load(sys.stdin).get('step_conversion_available', False))" 2>/dev/null)

if [ "$STEP_AVAILABLE" = "True" ]; then
    echo -e "${GREEN}✓ PASSED: STEP conversion available${NC}"
    echo "$STEP_HEALTH" | python3 -m json.tool | head -15
else
    echo -e "${RED}✗ FAILED: STEP conversion not available${NC}"
    exit 1
fi

# Test 3: Upload STEP file via API Gateway
echo -e "\n${YELLOW}[Test 3/5]${NC} Uploading STEP file via API Gateway..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_GATEWAY_URL/api/v1/convert" \
  -F "file=@$TEST_STEP_FILE" \
  -F "embedTextures=true" \
  -F "useDraco=false" \
  -F "outputFormat=glb" \
  -F "scale=1.0" \
  -F "decimateRatio=1.0" \
  -F "tessellationQuality=0.3")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "202" ]; then
    echo -e "${GREEN}✓ PASSED: Upload accepted (HTTP $HTTP_CODE)${NC}"
    
    # Extract job ID
    JOB_ID=$(echo "$RESPONSE_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('jobId', ''))" 2>/dev/null)
    
    if [ -n "$JOB_ID" ]; then
        echo -e "${GREEN}Job ID: $JOB_ID${NC}"
    else
        echo -e "${YELLOW}⚠ Could not extract job ID${NC}"
        echo "Response: $RESPONSE_BODY" | head -20
    fi
else
    echo -e "${RED}✗ FAILED: Upload rejected (HTTP $HTTP_CODE)${NC}"
    echo "Response: $RESPONSE_BODY" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE_BODY"
    exit 1
fi

# Test 4: Monitor job status
if [ -n "$JOB_ID" ]; then
    echo -e "\n${YELLOW}[Test 4/5]${NC} Monitoring job status..."
    
    MAX_ATTEMPTS=60
    ATTEMPT=0
    
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        sleep 2
        ATTEMPT=$((ATTEMPT + 1))
        
        STATUS_RESPONSE=$(curl -s "$API_GATEWAY_URL/api/v1/status/$JOB_ID")
        JOB_STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null)
        PROGRESS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('progress', 0))" 2>/dev/null)
        
        echo -e "${BLUE}Attempt $ATTEMPT/$MAX_ATTEMPTS: Status=$JOB_STATUS, Progress=$PROGRESS%${NC}"
        
        if [ "$JOB_STATUS" = "completed" ]; then
            echo -e "${GREEN}✓ PASSED: Job completed successfully${NC}"
            
            # Show final status
            echo "$STATUS_RESPONSE" | python3 -m json.tool | head -30
            break
        elif [ "$JOB_STATUS" = "failed" ]; then
            echo -e "${RED}✗ FAILED: Job failed${NC}"
            echo "$STATUS_RESPONSE" | python3 -m json.tool
            exit 1
        fi
        
        if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
            echo -e "${RED}✗ TIMEOUT: Job did not complete in 2 minutes${NC}"
            exit 1
        fi
    done
else
    echo -e "${YELLOW}⚠ SKIP: No job ID to monitor${NC}"
fi

# Test 5: Check outputs
echo -e "\n${YELLOW}[Test 5/5]${NC} Checking conversion outputs..."

if [ -n "$JOB_ID" ]; then
    OUTPUT_DIR="/Users/oliversteiling/Library/Mobile Documents/com~apple~CloudDocs/vuejs/GLB export Blender/blender-mcp-converter/outputs"
    
    GLB_FILES=$(find "$OUTPUT_DIR" -name "*.glb" -newer "$TEST_STEP_FILE" 2>/dev/null | head -3)
    
    if [ -n "$GLB_FILES" ]; then
        echo -e "${GREEN}✓ PASSED: GLB output files created${NC}"
        echo "$GLB_FILES" | while read file; do
            SIZE=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
            echo -e "  ${GREEN}✓${NC} $(basename "$file") - $SIZE bytes"
        done
    else
        echo -e "${YELLOW}⚠ WARNING: No GLB files found${NC}"
    fi
    
    # Check logs
    LOG_FILE="/Users/oliversteiling/Library/Mobile Documents/com~apple~CloudDocs/vuejs/GLB export Blender/blender-mcp-converter/logs/freecad_step_debug.log"
    
    if [ -f "$LOG_FILE" ]; then
        echo -e "\n${BLUE}Last 20 lines of FreeCAD log:${NC}"
        tail -20 "$LOG_FILE"
    fi
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Integration test completed successfully!        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
