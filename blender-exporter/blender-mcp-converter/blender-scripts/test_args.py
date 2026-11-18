import sys
print("=== ALL ARGUMENTS ===")
for i, arg in enumerate(sys.argv):
    print(f"  [{i}] {repr(arg)}")

print("\n=== AFTER -- ===")
if '--' in sys.argv:
    idx = sys.argv.index('--')
    script_args = sys.argv[idx + 1:]
    for i, arg in enumerate(script_args):
        print(f"  [{i}] {repr(arg)}")
else:
    print("  No -- separator found")
