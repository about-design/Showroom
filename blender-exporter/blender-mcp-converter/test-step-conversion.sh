#!/bin/bash

# STEP to OBJ Conversion Test Script
# Tests FreeCAD import in isolation without MCP Server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       STEP to OBJ Conversion Diagnostic Test           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEST_FILE="${SCRIPT_DIR}/test-files/simple_cube.step"
OUTPUT_DIR="${SCRIPT_DIR}/test-output"
OUTPUT_FILE="${OUTPUT_DIR}/simple_cube.obj"
FREECAD_SCRIPT="${SCRIPT_DIR}/blender-scripts/freecad_macos.py"
FREECAD_PYTHON="/Applications/FreeCAD.app/Contents/Resources/bin/python"
LOG_FILE="${SCRIPT_DIR}/logs/freecad_step_debug.log"

# Create output directory
mkdir -p "$OUTPUT_DIR"
mkdir -p "${SCRIPT_DIR}/logs"

# Clear previous log
if [ -f "$LOG_FILE" ]; then
    echo -e "${YELLOW}Clearing previous log file...${NC}"
    > "$LOG_FILE"
fi

# Test 1: Check FreeCAD installation
echo -e "${YELLOW}[Test 1/5]${NC} Checking FreeCAD installation..."
if [ ! -f "$FREECAD_PYTHON" ]; then
    echo -e "${RED}✗ FAILED: FreeCAD Python not found at $FREECAD_PYTHON${NC}"
    echo -e "${YELLOW}Install FreeCAD: https://www.freecad.org/downloads.php${NC}"
    exit 1
fi
echo -e "${GREEN}✓ PASSED: FreeCAD Python found${NC}"

# Test 2: Check FreeCAD version
echo -e "\n${YELLOW}[Test 2/5]${NC} Checking FreeCAD version..."
FREECAD_VERSION=$("$FREECAD_PYTHON" -c "import sys; sys.path.insert(0, '/Applications/FreeCAD.app/Contents/Resources/lib'); import FreeCAD; print('.'.join(FreeCAD.Version()[:3]))" 2>/dev/null || echo "Unknown")
if [ "$FREECAD_VERSION" = "Unknown" ]; then
    echo -e "${RED}✗ FAILED: Could not determine FreeCAD version${NC}"
    exit 1
fi
echo -e "${GREEN}✓ PASSED: FreeCAD version $FREECAD_VERSION${NC}"

# Test 3: Check test STEP file
echo -e "\n${YELLOW}[Test 3/5]${NC} Checking test STEP file..."
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}✗ FAILED: Test file not found: $TEST_FILE${NC}"
    exit 1
fi
FILE_SIZE=$(stat -f%z "$TEST_FILE" 2>/dev/null || stat -c%s "$TEST_FILE" 2>/dev/null)
echo -e "${GREEN}✓ PASSED: Test file exists ($FILE_SIZE bytes)${NC}"

# Test 4: Check STEP file format
echo -e "\n${YELLOW}[Test 4/5]${NC} Validating STEP file format..."
if grep -q "ISO-10303-21" "$TEST_FILE"; then
    echo -e "${GREEN}✓ PASSED: Valid ISO-10303-21 STEP format detected${NC}"
    
    # Detect AP version
    if grep -q "AP203" "$TEST_FILE"; then
        echo -e "  ${BLUE}Format: AP203 (Configuration Controlled 3D Design)${NC}"
    elif grep -q "AP214" "$TEST_FILE"; then
        echo -e "  ${BLUE}Format: AP214 (Automotive Design)${NC}"
    elif grep -q "AUTOMOTIVE_DESIGN" "$TEST_FILE"; then
        echo -e "  ${BLUE}Format: AUTOMOTIVE_DESIGN schema${NC}"
    fi
else
    echo -e "${YELLOW}⚠ WARNING: ISO-10303-21 header not found${NC}"
fi

# Test 5: Run FreeCAD conversion
echo -e "\n${YELLOW}[Test 5/5]${NC} Running FreeCAD STEP to OBJ conversion..."
echo -e "${BLUE}Output will be logged to: $LOG_FILE${NC}"
echo ""

export STEP_INPUT_FILE="$TEST_FILE"
export STEP_OUTPUT_FILE="$OUTPUT_FILE"
export STEP_TESSELLATION="0.1"
export PYTHONPATH="/Applications/FreeCAD.app/Contents/Resources/lib:$PYTHONPATH"
export DYLD_LIBRARY_PATH="/Applications/FreeCAD.app/Contents/Resources/lib:$DYLD_LIBRARY_PATH"

echo -e "${BLUE}Running: $FREECAD_PYTHON $FREECAD_SCRIPT${NC}"
echo ""

if "$FREECAD_PYTHON" "$FREECAD_SCRIPT"; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                  ✓ CONVERSION SUCCESS                   ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ -f "$OUTPUT_FILE" ]; then
        OBJ_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)
        VERTEX_COUNT=$(grep -c "^v " "$OUTPUT_FILE" || echo "0")
        FACE_COUNT=$(grep -c "^f " "$OUTPUT_FILE" || echo "0")
        
        echo -e "${GREEN}Output File:${NC} $OUTPUT_FILE"
        echo -e "${GREEN}File Size:${NC} $OBJ_SIZE bytes"
        echo -e "${GREEN}Vertices:${NC} $VERTEX_COUNT"
        echo -e "${GREEN}Faces:${NC} $FACE_COUNT"
    else
        echo -e "${RED}✗ WARNING: Output file not created${NC}"
    fi
else
    EXIT_CODE=$?
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                  ✗ CONVERSION FAILED                     ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${RED}Exit Code: $EXIT_CODE${NC}"
    
    if [ -f "$LOG_FILE" ]; then
        echo ""
        echo -e "${YELLOW}Last 30 lines of debug log:${NC}"
        echo -e "${BLUE}────────────────────────────────────────────────────────${NC}"
        tail -30 "$LOG_FILE"
        echo -e "${BLUE}────────────────────────────────────────────────────────${NC}"
        echo ""
        echo -e "${YELLOW}Full log available at: $LOG_FILE${NC}"
    fi
    
    exit $EXIT_CODE
fi

# Display log summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Conversion Log Summary:${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

if [ -f "$LOG_FILE" ]; then
    # Show key log entries
    echo ""
    echo -e "${YELLOW}Import Method Used:${NC}"
    grep "SUCCESS" "$LOG_FILE" | grep "Method" || echo "  (Not found in log)"
    
    echo ""
    echo -e "${YELLOW}Geometry Details:${NC}"
    grep "Geometry details:" -A 5 "$LOG_FILE" || echo "  (Not found in log)"
    
    echo ""
    echo -e "${YELLOW}Object Inventory:${NC}"
    grep "Object inventory:" -A 10 "$LOG_FILE" || echo "  (Not found in log)"
    
    echo ""
    echo -e "${BLUE}Full log: $LOG_FILE${NC}"
else
    echo -e "${YELLOW}⚠ Log file not created${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Test completed successfully!                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
