"""Regenerate child noise numeric oracles from the read-only build 12426148 ELF.
No external process, assets, server or browser is mutated. Only this task's own
output and two test fixtures are written.

PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/verify-source-muzzle-child-native.py
"""
from pathlib import Path
import importlib.util,struct,json,runpy,sys
from unicorn.x86_const import UC_X86_REG_XMM0
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('native',ROOT/'scripts/source-pistol-particles-native.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);client=m.NativeClient()
out=ROOT/'tests/fixtures/source-muzzle-children';out.mkdir(parents=True,exist_ok=True)
points=[[0,0,0],[1.1,2.2,3.3],[-2.5,-1,-100],[100000.5,300000.25,9000001],[110000.25,310000.75,9100000]]+[[i/7,-i/13,i*17/19]for i in range(50)]
cases=[]
for p in points:
 for i,v in enumerate(p):client.u.mem_write(client.arena+i*16,struct.pack('<4f',*([v]*4)))
 client.call(0xf7b1a0,[client.arena]);v=struct.unpack('<f',client.u.reg_read(UC_X86_REG_XMM0).to_bytes(16,'little')[:4])[0];cases.append({'input':p,'output':v})
(out/'noise-native.json').write_text(json.dumps({'clientSHA256':client.sha,'entry':'0xf7b1a0','cases':cases},indent=1)+'\n')
sys.argv=['probe-source-child-initializers.py','weapon_muzzle_flash_sparks4','10','0.001','instant']
runpy.run_path(str(ROOT/'scripts/probe-source-child-initializers.py'))
x=json.loads((ROOT/'output/fidelity-character/native-child-initializers/weapon_muzzle_flash_sparks4.json').read_text());cases=[]
assert x['status']=='original-initializers-executed',x['status']
for case in x['cases']:
 before,after=case['operators'][-2:]
 assert after['name']=='Velocity Noise'
 for i in range(case['count']):cases.append({'position':before['fields']['0'][i],'previous':before['fields']['2'][i],'born':before['fields']['8'][i],'after':after['fields']['2'][i]})
(out/'velocity-noise-native.json').write_text(json.dumps({'clientSHA256':x['clientSHA256'],'entry':'0xced250','cases':cases},indent=1)+'\n')
print('Original NoiseSIMD 55 cases, original Velocity Noise 30 cases verified and regenerated')
