"""Independent generic float32 interpreter of original PS tokens for GPU QA."""
from pathlib import Path
import importlib.util,json,struct,sys
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('redline_tokens',ROOT/'scripts/inspect-source-vhv-encoding.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
kind=lambda t:((t>>28)&7)|((t>>8)&24)
def execute(code,values,c3):
 regs={(1,0):[.2,.3,.4,.5],(1,1):[.6,.7,.8,.9],(2,3):list(map(f,c3))};reads=[]
 def read(t):
  r=regs[(kind(t),t&2047)];mod=(t>>24)&15;assert mod in [0,1]
  return [(-1 if mod else 1)*r[(t>>(16+2*i))&3] for i in range(4)]
 for at,row in m.instructions(code).items():
  op=row[0]&65535;d=row[1]
  if op==31:continue
  if op==81:regs[(kind(d),d&2047)]=list(struct.unpack('<4f',struct.pack('<4I',*row[2:])));continue
  if op==66:
   sampler=row[3]&2047;uv=read(row[2])[:2];reads.append([sampler,uv]);value=list(map(f,values[str(sampler)]))
  else:
   a=read(row[2]);b=read(row[3]) if len(row)>3 else None;c=read(row[4]) if len(row)>4 else None
   if op==1:value=a
   elif op==2:value=[f(x+y) for x,y in zip(a,b)]
   elif op==4:value=[f(f(x*y)+z) for x,y,z in zip(a,b,c)]
   elif op==5:value=[f(x*y) for x,y in zip(a,b)]
   elif op==8:value=[f(f(f(a[0]*b[0])+f(a[1]*b[1]))+f(a[2]*b[2]))]*4
   elif op==11:value=[max(x,y) for x,y in zip(a,b)]
   elif op==18:value=[f(f(x*y)+f(f(1-x)*z)) for x,y,z in zip(a,b,c)]
   else:raise ValueError(op)
  if d&(1<<20):value=[min(1,max(0,x)) for x in value]
  dest=regs.setdefault((kind(d),d&2047),[0]*4)
  for i in range(4):
   if d&(1<<(16+i)):dest[i]=f(value[i])
 return {'rgba':regs[(8,0)],'samplerReads':reads}
def main():
 out=ROOT/'.reference-assets/source-exports/ak47-redline-programs';programs={key:(out/f'customweapon_ps30-static{static}-dynamic0.dx9').read_bytes() for key,static in [('color',7),('exponent',17)]};rows=[];seed=1729
 for i in range(192):
  values={}
  for sampler in [0,1,2,3,5,8]:
   color=[]
   for j in range(4):seed=(1664525*seed+1013904223)&0xffffffff;color.append(f((seed>>8)/16777215))
   values[str(sampler)]=color
  values['8'][3]=[0,.125,.499,.5,.501,.75,.77,.9,1][i%9]
  c3=list(map(f,[1,150/255,.1,[0,.1,.2,.7,1,2][i%6]]));rows.append({'samples':values,'c3':c3,'expected':{key:execute(code,values,c3) for key,code in programs.items()}})
 result={'format':'source-redline-token-oracle-v1','boundary':'Independent Python register interpreter on original DX9 operands, separate f32 MAD products; not original D3D GPU floating point guarantee. Synthetic sampled RGBA intentionally exercises non-Redline alpha cases.','programSHA':{key:m.sha(code) for key,code in programs.items()},'cases':rows};(out/'token-oracle.json').write_text(json.dumps(result,indent=2)+'\n');print('Generated',len(rows),'independent cases for both original passes')
if __name__=='__main__':main()
