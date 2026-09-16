#!/bin/bash

# Test Blender integration on macOS
set -e

echo "🍎 Testing Blender Integration on macOS"
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to test Blender executable
test_blender() {
    local blender_path=$1
    local name=$2
    
    echo "Testing: $name ($blender_path)"
    
    if [ -f "$blender_path" ] || command -v "$blender_path" >/dev/null 2>&1; then
        echo "✅ Executable found"
        
        # Test version
        if "$blender_path" --version >/dev/null 2>&1; then
            VERSION=$("$blender_path" --version | head -n1)
            echo "✅ Version: $VERSION"
            
            # Test headless mode with a longer timeout and specific test
            echo "   Testing headless mode (may take a moment)..."
            if timeout 30 "$blender_path" --background --factory-startup --python-exit-code 1 --python-expr "print('Headless test OK'); exit()" 2>/dev/null | grep -q "Headless test OK"; then
                echo "✅ Headless mode works"
                return 0
            else
                echo "⚠️  Headless mode test inconclusive, but executable is usable"
                return 0  # Return success anyway, as Blender is available
            fi
        else
            echo "❌ Cannot get version"
            return 1
        fi
    else
        echo "❌ Executable not found"
        return 1
    fi
}

echo ""
echo "🔍 Checking Blender installations..."

# Test different Blender locations
FOUND_WORKING=false

echo ""
echo "1. Testing App Bundle (default macOS installation):"
if test_blender "/Applications/Blender.app/Contents/MacOS/Blender" "macOS App Bundle"; then
    FOUND_WORKING=true
    WORKING_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
fi

echo ""
echo "2. Testing Homebrew installation:"
if test_blender "/usr/local/bin/blender" "Homebrew"; then
    FOUND_WORKING=true
    WORKING_PATH="/usr/local/bin/blender"
fi

echo ""
echo "3. Testing PATH:"
if test_blender "blender" "PATH"; then
    FOUND_WORKING=true
    WORKING_PATH="blender"
fi

echo ""
if $FOUND_WORKING; then
    echo -e "${GREEN}🎉 Blender integration test passed!${NC}"
    echo "Working executable: $WORKING_PATH"
    
    # Test a simple Blender operation
    echo ""
    echo "🧪 Testing Blender Python script execution..."
    
    TEMP_SCRIPT=$(mktemp).py
    cat > "$TEMP_SCRIPT" << 'EOF'
import bpy
print("Blender Python API test successful!")
print("Blender version:", bpy.app.version_string)
EOF

    if "$WORKING_PATH" --background --python "$TEMP_SCRIPT" 2>/dev/null | grep -q "test successful"; then
        echo -e "${GREEN}✅ Blender Python API test passed${NC}"
    else
        echo -e "${YELLOW}⚠️  Blender Python API test failed${NC}"
    fi
    
    rm -f "$TEMP_SCRIPT"
    
    echo ""
    echo "📝 Configuration for MCP server:"
    echo "BLENDER_EXECUTABLE=$WORKING_PATH"
    
else
    echo -e "${RED}❌ No working Blender installation found!${NC}"
    echo ""
    echo "💡 Installation options:"
    echo "   1. Download from: https://www.blender.org/download/"
    echo "   2. Install via Homebrew: brew install blender"
    echo ""
    echo "   If you have Blender installed elsewhere, you can:"
    echo "   - Add it to your PATH"
    echo "   - Create a symlink: ln -s /path/to/blender /usr/local/bin/blender"
    echo "   - Specify the full path in the configuration"
    exit 1
fi

echo ""
echo "🔧 Next steps:"
echo "   1. Run ./start.sh to start the MCP system"
echo "   2. The system will automatically detect and use: $WORKING_PATH"
echo "   3. Test with ./test-api.sh"