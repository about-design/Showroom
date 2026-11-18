#!/bin/bash

# Blender MCP Converter - API Test Script
# This script demonstrates how to use the API endpoints

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

API_BASE_URL="http://localhost:3000/api/v1"
TEST_FILES_DIR="test-files"

echo -e "${BLUE}🧪 Blender MCP Converter API Test${NC}"
echo "================================="

# Function to check if API is running
check_api() {
    echo "🔍 Checking if API is running..."
    if curl -s "$API_BASE_URL/../health" >/dev/null; then
        echo -e "${GREEN}✅ API is running${NC}"
    else
        echo -e "${RED}❌ API is not running. Please start the system first with ./start.sh${NC}"
        exit 1
    fi
}

# Function to create test files if they don't exist
create_test_files() {
    if [ ! -d "$TEST_FILES_DIR" ]; then
        echo "📁 Creating test files directory..."
        mkdir -p "$TEST_FILES_DIR"
        
        # Create a simple test OBJ file
        cat > "$TEST_FILES_DIR/test_cube.obj" << 'EOF'
# Simple test cube
v -1.0 -1.0  1.0
v  1.0 -1.0  1.0
v -1.0  1.0  1.0
v  1.0  1.0  1.0
v -1.0  1.0 -1.0
v  1.0  1.0 -1.0
v -1.0 -1.0 -1.0
v  1.0 -1.0 -1.0

vt 0.0 0.0
vt 1.0 0.0
vt 1.0 1.0
vt 0.0 1.0

vn 0.0 0.0 1.0
vn 0.0 1.0 0.0
vn 0.0 0.0 -1.0
vn 0.0 -1.0 0.0
vn 1.0 0.0 0.0
vn -1.0 0.0 0.0

f 1/1/1 2/2/1 4/3/1 3/4/1
f 3/1/2 4/2/2 6/3/2 5/4/2
f 5/4/3 6/3/3 8/2/3 7/1/3
f 7/1/4 8/2/4 2/3/4 1/4/4
f 2/1/5 8/2/5 6/3/5 4/4/5
f 7/1/6 1/2/6 3/3/6 5/4/6
EOF

        # Create a simple MTL file
        cat > "$TEST_FILES_DIR/test_cube.mtl" << 'EOF'
# Simple test material
newmtl TestMaterial
Ka 0.2 0.2 0.2
Kd 0.8 0.8 0.8
Ks 1.0 1.0 1.0
Ns 100.0
EOF

        echo -e "${GREEN}✅ Created test files in $TEST_FILES_DIR/${NC}"
    fi
}

# Function to test file upload and conversion
test_conversion() {
    echo ""
    echo "🚀 Testing file upload and conversion..."
    
    # Upload files
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/convert" \
        -F "file=@$TEST_FILES_DIR/test_cube.obj" \
        -F "file=@$TEST_FILES_DIR/test_cube.mtl" \
        -F "embedTextures=true" \
        -F "useAI=false" \
        -F "outputFormat=glb")
    
    echo "📤 Upload Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    
    # Extract job ID
    JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId' 2>/dev/null)
    
    if [ "$JOB_ID" != "null" ] && [ -n "$JOB_ID" ]; then
        echo -e "${GREEN}✅ Job started with ID: $JOB_ID${NC}"
        
        # Monitor job status
        monitor_job "$JOB_ID"
    else
        echo -e "${RED}❌ Failed to start conversion job${NC}"
        return 1
    fi
}

# Function to monitor job progress
monitor_job() {
    local job_id=$1
    echo ""
    echo "👀 Monitoring job progress for ID: $job_id"
    
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        STATUS_RESPONSE=$(curl -s "$API_BASE_URL/status/$job_id")
        STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status' 2>/dev/null)
        PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress' 2>/dev/null)
        
        echo "⏱️  Status: $STATUS | Progress: $PROGRESS%"
        
        case $STATUS in
            "completed")
                echo -e "${GREEN}✅ Job completed successfully!${NC}"
                test_download "$job_id"
                return 0
                ;;
            "failed")
                echo -e "${RED}❌ Job failed${NC}"
                echo "Error details:"
                echo "$STATUS_RESPONSE" | jq '.' 2>/dev/null || echo "$STATUS_RESPONSE"
                return 1
                ;;
            "processing"|"queued")
                sleep 5
                ;;
            *)
                echo -e "${YELLOW}⚠️  Unknown status: $STATUS${NC}"
                ;;
        esac
        
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}❌ Timeout waiting for job completion${NC}"
    return 1
}

# Function to test file download
test_download() {
    local job_id=$1
    echo ""
    echo "⬇️  Testing file download..."
    
    DOWNLOAD_FILE="output_$job_id.glb"
    
    if curl -s -o "$DOWNLOAD_FILE" "$API_BASE_URL/download/$job_id"; then
        if [ -f "$DOWNLOAD_FILE" ] && [ -s "$DOWNLOAD_FILE" ]; then
            FILE_SIZE=$(wc -c < "$DOWNLOAD_FILE" | tr -d ' ')
            echo -e "${GREEN}✅ Downloaded file: $DOWNLOAD_FILE ($FILE_SIZE bytes)${NC}"
            
            # Verify it's a GLB file
            if file "$DOWNLOAD_FILE" | grep -q "glTF"; then
                echo -e "${GREEN}✅ File is a valid GLB format${NC}"
            else
                echo -e "${YELLOW}⚠️  File format verification inconclusive${NC}"
            fi
        else
            echo -e "${RED}❌ Downloaded file is empty${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ Failed to download file${NC}"
        return 1
    fi
}

# Function to test health endpoints
test_health_endpoints() {
    echo ""
    echo "🏥 Testing health endpoints..."
    
    # API Gateway health
    echo "Checking API Gateway health:"
    API_HEALTH=$(curl -s "$API_BASE_URL/../health")
    echo "$API_HEALTH" | jq '.' 2>/dev/null || echo "$API_HEALTH"
    
    # MCP Server health
    echo ""
    echo "Checking MCP Server health:"
    MCP_HEALTH=$(curl -s "http://localhost:8001/health")
    echo "$MCP_HEALTH" | jq '.' 2>/dev/null || echo "$MCP_HEALTH"
}

# Function to cleanup test files
cleanup() {
    echo ""
    echo "🧹 Cleaning up test files..."
    rm -f output_*.glb
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

# Main execution
main() {
    check_api
    create_test_files
    test_health_endpoints
    test_conversion
    
    echo ""
    echo -e "${BLUE}🎉 API Test completed!${NC}"
    echo ""
    echo "📖 Next steps:"
    echo "   - Check the downloaded GLB file with a 3D viewer"
    echo "   - Try uploading your own OBJ/MTL files"
    echo "   - Experiment with different conversion options"
    echo ""
    echo "🔗 Useful commands:"
    echo "   curl $API_BASE_URL/../health  # Check API health"
    echo "   curl $API_BASE_URL/status/JOB_ID  # Check specific job"
    echo ""
    
    # Ask if user wants to cleanup
    read -p "Do you want to clean up test files? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cleanup
    fi
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}⚠️  Test interrupted${NC}"; cleanup; exit 1' INT TERM

# Run main function
main