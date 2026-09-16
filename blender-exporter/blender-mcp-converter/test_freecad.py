import sys
import os

print("FreeCAD Test Script")
print("Arguments:", sys.argv)

try:
    import FreeCAD
    print("FreeCAD module loaded successfully")
    print("FreeCAD Version:", FreeCAD.Version())
    
    doc = FreeCAD.newDocument("Test")
    print("Document created successfully")
    FreeCAD.closeDocument("Test")
    print("Test completed successfully")
    
except Exception as e:
    print("ERROR:", e)
    import traceback
    traceback.print_exc()
    sys.exit(1)