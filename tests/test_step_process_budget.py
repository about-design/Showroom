"""Exercise byte output, process termination and fallback budgets without FreeCAD."""
import ast
import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'blender-exporter/blender-mcp-converter/blender-scripts/step_converter.py'


class StepProcessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'input.step'
        self.source.write_text('ISO-10303-21;\nEND-ISO-10303-21;\n')
        self.output = self.root / 'output.obj'
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        declarations = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef))]
        ns = {'__file__': str(self.root / 'step_converter.py'),
              'FREECAD_AVAILABLE': True, 'FREECAD_BINARY_PATH': sys.executable}
        exec(compile(ast.Module(body=declarations, type_ignores=[]), str(SOURCE), 'exec'), ns)
        self.converter = ns['StepToObjConverter']()
        self.env = patch.dict(os.environ, {'STEP_CONVERSION_TIMEOUT_SECONDS': '5'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def scripts(self, color, generic):
        (self.root / 'freecad_macos.py').write_text(color, encoding='utf-8')
        (self.root / 'freecad_script.py').write_text(generic, encoding='utf-8')

    def convert(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.converter.convert_step_to_obj(str(self.source), str(self.output))

    def test_invalid_native_output_does_not_fail_successful_conversion(self):
        self.scripts(
            "import os,sys\n"
            "sys.stdout.buffer.write(b'Native label: \\xe4\\xb0\\n')\n"
            "sys.stderr.buffer.write(b'Native warning: \\xff\\n')\n"
            "open(os.environ['STEP_OUTPUT_FILE'],'w').write('v 0 0 0\\nf 1 1 1\\n')\n",
            "raise RuntimeError('fallback must not run')\n")
        result = self.convert()
        self.assertEqual(result['step_script_used'], 'color')
        logs = '\n'.join(self.converter.log_messages)
        self.assertIn('Native label:', logs)
        self.assertIn('Native warning:', logs)
        self.assertIn('undecodable output characters replaced', logs)

    def test_timeout_kills_process_and_preserves_partial_progress_and_stderr(self):
        self.scripts(
            "import sys,time\n"
            "sys.stdout.buffer.write(b'Tessellierung 39/114: \\xe4\\n');sys.stdout.flush()\n"
            "sys.stderr.buffer.write(b'Warning: \\xff\\n');sys.stderr.flush()\n"
            "time.sleep(30)\n",
            "import os\nopen(os.environ['STEP_OUTPUT_FILE'],'w').write('fallback ran')\n")
        with patch.dict(os.environ, {'STEP_CONVERSION_TIMEOUT_SECONDS': '0.3'}):
            started = time.perf_counter()
            with self.assertRaisesRegex(RuntimeError, 'last step: Tessellierung 39/114'):
                self.convert()
            self.assertLess(time.perf_counter() - started, 3)
        self.assertFalse(self.output.exists())
        self.assertIn('Warning:', '\n'.join(self.converter.log_messages))

    def test_final_failure_reports_latest_error_and_keeps_attempt_history(self):
        self.scripts("import sys\nprint('first failure');sys.exit(7)\n",
                     "import sys\nprint('second failure');sys.exit(9)\n")
        with self.assertRaises(RuntimeError) as error:
            self.convert()
        self.assertIn('failed: generic_error_9', str(error.exception))
        self.assertIn('color: exit code 7', str(error.exception))
        self.assertIn('generic: exit code 9', str(error.exception))

    def test_fallback_consumes_remaining_budget_instead_of_resetting_it(self):
        self.scripts("import time,sys\ntime.sleep(0.2);sys.exit(7)\n",
                     "import time\nprint('Tessellierung 2/3',flush=True);time.sleep(30)\n")
        with patch.dict(os.environ, {'STEP_CONVERSION_TIMEOUT_SECONDS': '0.6'}):
            started = time.perf_counter()
            with self.assertRaisesRegex(RuntimeError, 'failed: generic_timeout'):
                self.convert()
            self.assertLess(time.perf_counter() - started, 1.5)

    def test_invalid_budgets_are_rejected_before_launching_a_process(self):
        self.scripts("raise RuntimeError('must not run')\n", "raise RuntimeError('must not run')\n")
        for value in ('0', '-1', 'nan', 'inf'):
            with self.subTest(value=value), patch.dict(os.environ, {'STEP_CONVERSION_TIMEOUT_SECONDS': value}):
                with self.assertRaisesRegex(ValueError, 'positive finite number'):
                    self.convert()


if __name__ == '__main__':
    unittest.main()
