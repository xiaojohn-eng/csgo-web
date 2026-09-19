"""Guarded reuse of audited import programs, isolated to original AWP outputs."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def run(program, replacements, namespace=None):
    path = ROOT / 'scripts' / program
    source = path.read_text()
    for before, after in replacements:
        assert before in source, (program, 'shared source changed', before)
        source = source.replace(before, after)
    scope = {'__file__': str(path), '__name__': '__main__', **(namespace or {})}
    exec(compile(source, str(path), 'exec'), scope)
