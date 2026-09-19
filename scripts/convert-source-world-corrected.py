"""Re-export world with strictly matched original displacement start corners."""
from pathlib import Path
import importlib.util,inspect,json,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2-corrected'
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
items=module('source_items',ROOT/'scripts/inventory-source-items.py');items.initialize()
fix=module('source_displacement_start',ROOT/'scripts/source-displacement-start.py')
import SourceIO.blender_bindings.source1.bsp.import_bsp as bsp_import
original=bsp_import.import_disp
namespace={**original.__globals__,'_source_displacement_start':fix.source_start}
exec(compile(fix.instrument(inspect.getsource(original)),'<Strict original displacement start>','exec'),namespace)
bsp_import.import_disp=namespace['import_disp']
converter=ROOT/'scripts/convert-source-map.py'
sys.argv=['blender','--factory-startup','--','--download-complete','--layer','world','--output',str(OUT)]
exec(compile(converter.read_text(),str(converter),'exec'),{'__file__':str(converter),'__name__':'__main__'})
(OUT/'displacement-start-corrections.json').write_text(json.dumps(fix.corrections,indent=2)+'\n')
