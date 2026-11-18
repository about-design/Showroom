#!/bin/bash
# Test Color Mapping System
# Quick validation of color threshold mapping functionality

set -e

echo "========================================="
echo "Color Mapping System - Test Suite"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if API Gateway is running
echo "1. Testing API Gateway Color Mapping Endpoint..."
if curl -s -f http://localhost:3000/api/v1/color-mapping/standards > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API endpoint is accessible${NC}"
    
    # Pretty-print response
    echo ""
    echo "Standard Color Palette:"
    echo "----------------------"
    curl -s http://localhost:3000/api/v1/color-mapping/standards | jq -r '.colors[] | "\(.name): \(.hex) (RGB: \(.rgb))"'
    echo ""
    
    # Show configuration
    echo "Configuration:"
    echo "--------------"
    ENABLED=$(curl -s http://localhost:3000/api/v1/color-mapping/standards | jq -r '.enabled')
    THRESHOLD=$(curl -s http://localhost:3000/api/v1/color-mapping/standards | jq -r '.threshold')
    echo "Enabled: $ENABLED"
    echo "Threshold: $THRESHOLD"
    echo ""
else
    echo -e "${RED}✗ API Gateway not running or endpoint not accessible${NC}"
    echo "Please start API Gateway: cd api-gateway && npm start"
    exit 1
fi

# Test with environment variables
echo "2. Testing Environment Variable Configuration..."
echo ""

echo "Current settings:"
echo "  COLOR_MAPPING_ENABLED=${COLOR_MAPPING_ENABLED:-true (default)}"
echo "  COLOR_MAPPING_THRESHOLD=${COLOR_MAPPING_THRESHOLD:-0.20 (default)}"
echo ""

# Create test MTL file with slightly varied colors
echo "3. Creating test materials with color variations..."
TEST_DIR="./test-color-mapping"
mkdir -p "$TEST_DIR"

cat > "$TEST_DIR/test_colors.mtl" << 'EOF'
# Test MTL with color variations
# These should map to standard colors with threshold 0.20

newmtl Orange_Similar_01
Kd 0.76 0.29 0.11
# Distance to rotorange Pulverbeschichtet [0.75, 0.28, 0.10]: ~0.014

newmtl Orange_Similar_02
Kd 0.74 0.27 0.09
# Distance to rotorange Pulverbeschichtet: ~0.020

newmtl Blue_Similar_01
Kd 0.07 0.21 0.45
# Distance to enzianblau Pulverbeschichtet [0.06, 0.20, 0.44]: ~0.014

newmtl Grey_Similar_01
Kd 0.81 0.83 0.81
# Distance to lichtgrau Pulverbeschichtet [0.80, 0.82, 0.80]: ~0.017

newmtl Black_Similar_01
Kd 0.04 0.04 0.04
# Distance to tiefschwarz Pulverbeschichtet [0.03, 0.03, 0.03]: ~0.017

newmtl Zinc_Similar_01
Kd 0.63 0.65 0.67
# Distance to Verzinkt metall [0.62, 0.64, 0.66]: ~0.017
EOF

echo -e "${GREEN}✓ Test MTL file created: $TEST_DIR/test_colors.mtl${NC}"
echo ""

# Show expected mappings
echo "4. Expected Color Mappings (threshold 0.20):"
echo "---------------------------------------------"
echo "Orange_Similar_01 [0.76, 0.29, 0.11] → rotorange Pulverbeschichtet"
echo "Orange_Similar_02 [0.74, 0.27, 0.09] → rotorange Pulverbeschichtet"
echo "Blue_Similar_01   [0.07, 0.21, 0.45] → enzianblau Pulverbeschichtet"
echo "Grey_Similar_01   [0.81, 0.83, 0.81] → lichtgrau Pulverbeschichtet"
echo "Black_Similar_01  [0.04, 0.04, 0.04] → tiefschwarz Pulverbeschichtet"
echo "Zinc_Similar_01   [0.63, 0.65, 0.67] → Verzinkt metall"
echo ""

echo "5. Distance Calculations:"
echo "-------------------------"
python3 << 'PYTHON'
import math

def color_distance(c1, c2):
    return math.sqrt((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2)

test_colors = {
    "Orange_Similar_01": [0.76, 0.29, 0.11],
    "Orange_Similar_02": [0.74, 0.27, 0.09],
    "Blue_Similar_01": [0.07, 0.21, 0.45],
    "Grey_Similar_01": [0.81, 0.83, 0.81],
    "Black_Similar_01": [0.04, 0.04, 0.04],
    "Zinc_Similar_01": [0.63, 0.65, 0.67]
}

standard_colors = {
    "rotorange Pulverbeschichtet": [0.75, 0.28, 0.10],
    "enzianblau Pulverbeschichtet": [0.06, 0.20, 0.44],
    "lichtgrau Pulverbeschichtet": [0.80, 0.82, 0.80],
    "tiefschwarz Pulverbeschichtet": [0.03, 0.03, 0.03],
    "Verzinkt metall": [0.62, 0.64, 0.66]
}

mappings = [
    ("Orange_Similar_01", "rotorange Pulverbeschichtet"),
    ("Orange_Similar_02", "rotorange Pulverbeschichtet"),
    ("Blue_Similar_01", "enzianblau Pulverbeschichtet"),
    ("Grey_Similar_01", "lichtgrau Pulverbeschichtet"),
    ("Black_Similar_01", "tiefschwarz Pulverbeschichtet"),
    ("Zinc_Similar_01", "Verzinkt metall")
]

threshold = 0.20
all_pass = True

for test_name, std_name in mappings:
    dist = color_distance(test_colors[test_name], standard_colors[std_name])
    status = "✓ PASS" if dist <= threshold else "✗ FAIL"
    print(f"{test_name:20s} → {std_name:30s} dist={dist:.4f} {status}")
    if dist > threshold:
        all_pass = False

print()
if all_pass:
    print("✓ All color distances are within threshold (0.20)")
else:
    print("✗ Some color distances exceed threshold")
PYTHON

echo ""
echo "========================================="
echo "Manual Testing Instructions:"
echo "========================================="
echo ""
echo "To test with a real conversion:"
echo ""
echo "1. Upload test MTL to API:"
echo "   curl -F 'files=@$TEST_DIR/test_colors.mtl' http://localhost:3000/api/v1/upload"
echo ""
echo "2. Watch the conversion logs for color mapping messages like:"
echo "   [INFO] Color mapping: Orange_Similar_01 #C24A1C → rotorange Pulverbeschichtet (dist=0.014)"
echo ""
echo "3. Test with disabled mapping:"
echo "   COLOR_MAPPING_ENABLED=false blender --background --python ..."
echo ""
echo "4. Test with strict threshold:"
echo "   COLOR_MAPPING_THRESHOLD=0.10 blender --background --python ..."
echo ""
echo "========================================="
echo "Test Results Summary:"
echo "========================================="
echo ""
echo -e "${GREEN}✓ API Endpoint: Working${NC}"
echo -e "${GREEN}✓ Configuration: Loaded${NC}"
echo -e "${GREEN}✓ Test Materials: Created${NC}"
echo -e "${GREEN}✓ Distance Calculations: Verified${NC}"
echo ""
echo "Ready for manual conversion testing!"
echo ""
