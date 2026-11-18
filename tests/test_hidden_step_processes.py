"""Windows headless selection and subprocess diagnostics regressions."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'blender-exporter/blender-mcp-converter/blender-scripts/step_converter.py'


class HiddenStepProcessTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        declarations = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))]
        self.ns = {'__file__': str(SOURCE)}
        exec(compile(ast.Module(body=declarations, type_ignores=[]), str(SOURCE), 'exec'), self.ns)

    def test_gui_override_resolves_adjacent_console_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name in ('freecad.exe', 'FreeCADCmd.exe', 'python.exe', 'pythonw.exe'):
                (base / name).touch()
            with patch.object(sys, 'platform', 'win32'), patch.dict('os.environ', {'FREECAD_PATH': str(base / 'freecad.exe'), 'FREECAD_PYTHON': '', 'FREECAD_EXECUTABLE': ''}):
                candidates = self.ns['_collect_freecad_candidate_binaries']()
            self.assertEqual(candidates[0], str(base / 'python.exe'))
            self.assertIn(str(base / 'FreeCADCmd.exe'), candidates)
            self.assertFalse(any(Path(p).name.lower() in ('freecad.exe', 'freecad', 'pythonw.exe') for p in candidates))

    def test_gui_only_installation_is_not_launched_on_windows(self):
        with tempfile.TemporaryDirectory() as directory:
            gui = Path(directory) / 'freecad.exe'
            gui.touch()
            with patch.object(sys, 'platform', 'win32'), patch.dict('os.environ', {'FREECAD_PATH': str(gui), 'FREECAD_PYTHON': '', 'FREECAD_EXECUTABLE': ''}):
                self.assertNotIn(str(gui), self.ns['_collect_freecad_candidate_binaries']())

    def test_non_windows_selection_keeps_existing_gui_named_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'freecad'
            binary.touch()
            with patch.object(sys, 'platform', 'linux'), patch.dict('os.environ', {'FREECAD_PATH': str(binary), 'FREECAD_PYTHON': '', 'FREECAD_EXECUTABLE': ''}):
                self.assertIn(str(binary), self.ns['_collect_freecad_candidate_binaries']())

    @unittest.skipUnless(sys.platform == 'win32', 'Windows subprocess behavior')
    def test_python_probe_is_consoleless_and_keeps_captured_output(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'FreeCAD.py').write_text('')
            actual_run = subprocess.run
            calls = []
            def run(*args, **kwargs):
                result = actual_run(*args, **kwargs)
                calls.append((kwargs, result))
                return result
            with patch.dict('os.environ', {'PYTHONPATH': directory}), patch.object(subprocess, 'run', side_effect=run):
                self.assertTrue(self.ns['_probe_freecad_binary'](sys.executable))
            self.assertEqual(calls[0][0]['creationflags'], subprocess.CREATE_NO_WINDOW)
            self.assertTrue(calls[0][0]['capture_output'])
            self.assertEqual(calls[0][1].returncode, 0)
            self.assertIn('OK', calls[0][1].stdout)


if __name__ == '__main__':
    unittest.main()
