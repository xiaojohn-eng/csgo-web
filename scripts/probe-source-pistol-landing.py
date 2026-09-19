"""Same original OnLand consumer, validated original pistol mode profiles."""
from pathlib import Path
import importlib.util,json,struct
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=load('pistol','probe-source-pistol-handling.py');l=load('landing','probe-source-landing.py')
class PistolLanding(l.NativeLanding):
 mode=0
 def setup(self,*args,**kwargs):
  super().setup(*args,**kwargs);self.ints(l.d.W+0xa6c,[self.mode]);self.u.mem_write(l.d.T+0xec,b'\0')
def main():
 ps,sha=p.profiles();engine=PistolLanding();rows=[];chains=[]
 before=dict(penalty=.037,recoilIndex=2.75,lastShotTime=.7,lastUpdateTime=.9,angle=[-3.2,1.1,.2],velocity=[-15,3,-1],viewPunch=[-.2,.05,0])
 for weapon,mode in [('glock18',0),('glock18',1),('usp-s',0),('usp-s',1)]:
  engine.mode=mode
  for seed in [0,42,2147483647]:
   for fall in [0,1,185,350,1024,5000]:rows.append(dict(weapon=weapon,mode=mode,before=before,commandSeed=seed,fallVelocitySource=fall,original=engine.land(ps[weapon],before,fall,seed)))
  for dt in [0,1/64,1/60]:chains.append(dict(weapon=weapon,mode=mode,before=before,commandSeed=42,fallVelocitySource=350,time=1.1,dt=dt,original=engine.sequence(ps[weapon],before,350,42,1.1,dt)))
 report=dict(status='original_pistol_mode_onland_and_tick_chain_executed',sourceServerSha256=p.d.SHA,sourceItemsSha256=sha,sourceVstdlibSha256=p.r.s.VSHA,
  rows=rows,chains=chains,limits=['Same native OnLand/CRC/RNG as rifle oracle, pistol current-mode profile consumer.','Full movement, fall damage/stamina/water/moving platforms are not executed.','Host asinf/expf/sincosf float adapters, no full Linux libm ulp claim.'])
 (ROOT/'output/tests/source-pistol-landing-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(status=report['status'],rows=len(rows),chains=len(chains))))
if __name__=='__main__':main()
