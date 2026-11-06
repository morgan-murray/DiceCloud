# SPDX-License-Identifier: MPL-2.0
# Adapted from Flare LogicSolver, revision 3905811; see ../NOTICE.md.
import ast
from .secure import fail

class LogicSolver:
    @staticmethod
    def solve_expression(expression):
        if len(expression) > 2048: fail('EXPRESSION_LIMIT', 'rules', 'Requirement expression is too long.')
        try: tree = ast.parse(expression.strip(), mode='eval')
        except (SyntaxError, RecursionError): fail('UNSUPPORTED_REQUIREMENT', 'rules', 'Unsupported requirement syntax.')
        if sum(1 for _ in ast.walk(tree)) > 128: fail('EXPRESSION_LIMIT', 'rules', 'Requirement expression is too complex.')
        def solve(node, depth=0):
            if depth > 32: fail('EXPRESSION_LIMIT', 'rules', 'Requirement nesting is too deep.')
            if isinstance(node, ast.Expression): return solve(node.body, depth+1)
            if isinstance(node, ast.Constant) and type(node.value) is bool: return node.value
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not): return not solve(node.operand, depth+1)
            if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
                values = [solve(n, depth+1) for n in node.values]
                return all(values) if isinstance(node.op, ast.And) else any(values)
            fail('UNSUPPORTED_REQUIREMENT', 'rules', 'Only bounded boolean requirements are supported.')
        return solve(tree)
