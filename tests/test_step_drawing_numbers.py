"""Regression tests for STEP component drawing-number assignment."""
import ast
from collections import Counter
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import Mock


SOURCE = Path(__file__).resolve().parents[1] / 'blender-exporter/blender-mcp-converter/blender-scripts/freecad_macos.py'


class StepDrawingNumberTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        function_names = {
            '_extract_drawing_number',
            '_read_step_component_drawing_numbers',
            '_assign_step_drawing_numbers',
        }
        declarations = [
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name in function_names
        ]
        self.namespace = {'re': re, 'logger': Mock()}
        exec(
            compile(ast.Module(body=declarations, type_ignores=[]), str(SOURCE), 'exec'),
            self.namespace,
        )

    def test_container_is_excluded_and_duplicate_drawing_numbers_keep_their_number(self):
        components = [
            '31-01434', '31-01434', '31-01436', '31-01436',
            '31-01436', '31-01436',
        ]
        entities = []
        occurrence_id = 100
        definition_id = 200
        formation_id = 300
        product_id = 400
        shape_id = 500
        representation_id = 600
        for index, drawing_number in enumerate(components):
            entities.extend([
                f"#{product_id + index} = PRODUCT('{drawing_number}', '', '', ());",
                f"#{formation_id + index} = PRODUCT_DEFINITION_FORMATION('', '', #{product_id + index});",
                f"#{definition_id + index} = PRODUCT_DEFINITION('', '', #{formation_id + index}, #1);",
                f"#{occurrence_id + index} = NEXT_ASSEMBLY_USAGE_OCCURRENCE('', '', '', #2, #{definition_id + index});",
                f"#{shape_id + index} = PRODUCT_DEFINITION_SHAPE('', '', #{definition_id + index});",
                f"#{representation_id + index} = SHAPE_DEFINITION_REPRESENTATION(#{shape_id + index}, #3);",
            ])

        # A NEXT_ASSEMBLY_USAGE_OCCURRENCE may be an assembly container only.
        entities.extend([
            "#499 = PRODUCT('41-00343_124385', '', '', ());",
            "#399 = PRODUCT_DEFINITION_FORMATION('', '', #499);",
            "#299 = PRODUCT_DEFINITION('', '', #399, #1);",
            "#199 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('', '', '', #2, #299);",
            "#599 = PRODUCT_DEFINITION_SHAPE('', '', #299);",
            "#699 = SHAPE_REPRESENTATION('41-00343_124385', (#701, #702), #703);",
            "#799 = SHAPE_REPRESENTATION('31-01434', (#801), #802);",
            "#899 = SHAPE_REPRESENTATION_RELATIONSHIP('', '', #699, #799);",
            "#999 = SHAPE_DEFINITION_REPRESENTATION(#599, #699);",
        ])
        with tempfile.TemporaryDirectory() as directory:
            step_file = Path(directory) / 'input.step'
            step_file.write_text('\n'.join(entities), encoding='utf-8')
            drawing_numbers = self.namespace['_read_step_component_drawing_numbers'](step_file)

        self.assertEqual(drawing_numbers, components)
        self.assertEqual(len(drawing_numbers), 6)

        shapes = [{} for _ in components]
        self.namespace['_assign_step_drawing_numbers'](shapes, drawing_numbers)
        instance_counts = Counter()
        mesh_names = []
        for shape in shapes:
            drawing_number = shape['step_drawing_number']
            instance_counts[drawing_number] += 1
            mesh_names.append(f"{drawing_number}_{instance_counts[drawing_number]}")

        self.assertEqual(mesh_names[:2], ['31-01434_1', '31-01434_2'])
        self.assertNotIn('31-01435_1', mesh_names)
        self.assertEqual(
            mesh_names[2:],
            ['31-01436_1', '31-01436_2', '31-01436_3', '31-01436_4'],
        )

    def test_unknown_component_uses_only_its_own_label_fallback(self):
        shapes = [{}, {}, {}]
        self.namespace['_assign_step_drawing_numbers'](
            shapes, ['06-00434', None, '06-00434']
        )

        self.assertEqual(shapes[0]['step_drawing_number'], '06-00434')
        self.assertNotIn('step_drawing_number', shapes[1])
        self.assertEqual(shapes[2]['step_drawing_number'], '06-00434')

    def test_reference_product_drawing_numbers_remain_in_step_order(self):
        drawing_numbers = [
            '06-00434', '06-00434', '06-00763', '06-00763',
            '06-00770', '06-00770', '06-00894', '06-00894',
        ]
        shapes = [{} for _ in drawing_numbers]
        self.namespace['_assign_step_drawing_numbers'](shapes, drawing_numbers)

        instance_counts = Counter()
        mesh_names = []
        for shape in shapes:
            drawing_number = shape['step_drawing_number']
            instance_counts[drawing_number] += 1
            mesh_names.append(f"{drawing_number}_{instance_counts[drawing_number]}")

        self.assertEqual(mesh_names, [
            '06-00434_1', '06-00434_2',
            '06-00763_1', '06-00763_2',
            '06-00770_1', '06-00770_2',
            '06-00894_1', '06-00894_2',
        ])


if __name__ == '__main__':
    unittest.main()