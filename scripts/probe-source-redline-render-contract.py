"""Installed CustomWeapon output-write and render-target selection boundary.

Executes bounded original x64 arithmetic/state writers. Hardware capability and
GL dispatch are explicit test inputs/sinks; no engine, window or driver starts.
Neither this receipt nor its high-resolution diagnostics are a pixel oracle.
"""
from pathlib import Path
import importlib.util,json,struct,sys
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
m=module('redline_render_elf','inspect-source-vhv-encoding.py');x=module('redline_render_x64','inspect-source-prop-tint.py')
q=lambda value:struct.pack('<Q',value)
i32=lambda value:struct.pack('<I',value)
def invoke(u,start,stop):
 u.reg_write(UC_X86_REG_RSP,x.BASE+0xf000);u.mem_write(x.BASE+0xf000,q(stop));u.emu_start(start,stop,count=20000);assert u.reg_read(UC_X86_REG_RIP)==stop
def main():
 shader=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
 api=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/shaderapidx9_client.so')
 togl=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/libtogl_client.so')
 material=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/materialsystem_client.so')
 client=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so')
 # Bind the original virtual slot to the original CShaderShadowDX8 RTTI/table.
 assert struct.unpack('<Q',api.code(0x315438,8))[0]==0x31a9a0
 assert struct.unpack('<Q',api.code(0x31a9a8,8))[0]==0xe37d0
 assert api.cstring(0xe37d0)=='16CShaderShadowDX8'
 assert struct.unpack('<Q',api.code(0x315440+0x98,8))[0]==0x5c980
 shader.check(0x65d55,'ff 90 98 00 00 00');api.check(0x5c9c2,'44 88 63 39')
 # Original libtogl SetRenderState jump-table case194 => original GL sRGB cap.
 table=togl.rip(0x2b4cb,'48 8d 0d')
 target=table+struct.unpack('<i',togl.code(table+(194-7)*4,4))[0]
 assert target==0x2b570;togl.check(0x2bf07,'bf b9 8d 00 00')
 # Hardware capability callback is a boolean test input. Original shadow method
 # and original libtogl dispatch execute; GL enable/disable are bounded sinks.
 us=x.emulator(shader);ua=x.emulator(api);ug=x.emulator(togl)
 object=x.BASE+0x1000;hardware=x.BASE+0x2000;vtable=x.BASE+0x3000;callback=x.BASE+0x4000;stop=x.BASE+0x7000
 ua.mem_write(object+8,q(hardware));ua.mem_write(hardware,q(vtable));ua.mem_write(vtable+0xd8,q(callback))
 glcontext=x.BASE+0x2000;glfunctions=x.BASE+0x3000;enable=x.BASE+0x4100;disable=x.BASE+0x4200
 # This named global's original consumers call +0x198 glEnable / +0x160 glDisable.
 globalGL=togl.rip(0x2befe,'48 8d 05');ug.mem_write(globalGL,q(glfunctions));ug.mem_write(glfunctions+0x198,q(enable));ug.mem_write(glfunctions+0x160,q(disable))
 ug.mem_write(enable,b'\xc3');ug.mem_write(disable,b'\xc3');calls=[]
 def capture(u,at,size,data):calls.append({'enabled':at==enable,'cap':u.reg_read(UC_X86_REG_RDI)})
 ug.hook_add(UC_HOOK_CODE,capture,begin=enable,end=disable)
 cases=[]
 for exponent in [False,True]:
  for preview in [False,True]:
   us.mem_write(x.BASE+0xe000-0x20c,bytes([exponent]));us.mem_write(x.BASE+0xe000-0x201,bytes([preview]));us.reg_write(UC_X86_REG_R14,object)
   us.emu_start(0x65d3a,0x65d55,count=50);assert us.reg_read(UC_X86_REG_RIP)==0x65d55
   argument=us.reg_read(UC_X86_REG_RSI);assert argument==int(not exponent or preview)
   for supported in [False,True]:
    ua.mem_write(callback,b'\xb8'+i32(supported)+b'\xc3');ua.ctl_remove_cache(callback,callback+6)
    for initial in [0,4,0xa3,0xff]:
     ua.mem_write(object+0x39,bytes([initial]));ua.reg_write(UC_X86_REG_RDI,object);ua.reg_write(UC_X86_REG_RSI,argument)
     invoke(ua,0x5c980,stop);value=ua.mem_read(object+0x39,1)[0];assert value==((initial&~4)|(4 if argument and supported else 0)),(exponent,preview,supported,initial,argument,value)
     # Native original queued D3D state writer after thread-local context fetch.
     writer=x.BASE+0x3000;stream=x.BASE+0x5000
     ua.mem_write(writer+0x40,q(30));ua.mem_write(writer+0x38,q(stream));ua.reg_write(UC_X86_REG_RAX,writer);ua.reg_write(UC_X86_REG_RDX,30)
     ua.reg_write(UC_X86_REG_R13,(value>>2)&1);ua.emu_start(0x62874,0x6289e,count=50)
     command=list(struct.unpack('<3I',ua.mem_read(stream,12)));assert command==[1,194,int(bool(value&4))]
     # Original libtogl direct SRGB-capability path; alternate deferred path also
     # records the same requested flag at +0x458, but is not a rendered oracle.
     calls.clear();ug.mem_write(object,bytes(0x1000));ug.mem_write(glcontext,bytes(0x1000));ug.mem_write(object+0x1e8,q(glcontext));ug.mem_write(glcontext+0x166,b'\x01')
     ug.reg_write(UC_X86_REG_RDI,object);ug.reg_write(UC_X86_REG_RSI,194);ug.reg_write(UC_X86_REG_RDX,command[2]);invoke(ug,0x2b4a0,stop)
     assert calls==[{'enabled':bool(command[2]),'cap':0x8db9}]
     cases.append({'exponent':exponent,'preview':preview,'hardwareSupportsSRGB':supported,'initialShadowFlags':initial,'nativeArgument':argument,'nativeShadowFlags':value,'nativeD3DCommand':command,'nativeGLCalls':list(calls)})
 # Original fixed RT pool and original selection routine; availability models
 # successful original target creation, not a fabricated running engine state.
 rows=[]
 for n in range(4):
  address=0x37f760+n*24;name,width,flags,pointer=struct.unpack('<QIIQ',material.code(address,24))
  rows.append({'name':material.cstring(name),'size':width,'flagByte':flags&255,'nativeAvailable':(flags>>8)&255})
 assert [row['size'] for row in rows]==[1024,512,256,128]
 um=x.emulator(material);sizes=[]
 for n in range(4):um.mem_write(0x37f760+n*24+13,b'\x01')
 for requested in [1,64,127,128,129,255,256,257,511,512,513,768,1023,1024,1025,2048,4096]:
  um.reg_write(UC_X86_REG_RDI,requested);invoke(um,0x68d60,stop);index=um.reg_read(UC_X86_REG_RAX);selected=rows[index]['size']
  expected=next((size for size in [128,256,512,1024] if size>=requested),1024);assert selected==expected
  sizes.append({'requested':requested,'nativePoolIndex':index,'nativeTargetSize':selected})
 # Requested logical size = (1 << sizeLog2) >> picmip, from original function's
 # picmip-independent branch. The caller's actual AK sizeLog2 remains unproven.
 logical=[]
 for log2 in range(7,13):
  um.mem_write(object+0x21c,i32(log2));um.mem_write(object+0x2e0,b'\x01');um.reg_write(UC_X86_REG_RDI,object);invoke(um,0x699e0,stop)
  size=struct.unpack('<I',um.mem_read(object+0x2a8,4))[0];assert size==1<<log2;logical.append({'log2':log2,'ignorePicmip':True,'nativeSize':size})
 # Client's actual exponent descriptor, including the log2=9 special branch.
 # Input kit field comes from the hash-pinned original schema receipt; no host
 # implementation replaces the original integer-log2 helper called here.
 inputs=json.loads((ROOT/'.reference-assets/source-exports/ak47-redline-inputs/inputs.json').read_text())
 assert inputs['paintKitDefaults']['view_model_exponent_override_size']=='256'
 assert 'view_model_exponent_override_size' not in inputs['paintKit']
 uc=x.emulator(client);exponent_cases=[];frame=x.BASE+0xe000;kit=x.BASE+0x1000;descriptor=x.BASE+0x2000
 for color_log2 in [7,8,9,10,11,12]:
  for requested_exponent in [128,256,512,1024]:
   uc.mem_write(frame-0x260,q(kit));uc.mem_write(kit+0x11c,i32(requested_exponent))
   uc.mem_write(frame-0x200,i32(color_log2));uc.mem_write(frame-0x1f8,q(descriptor))
   uc.mem_write(frame-0x220,q(0));uc.mem_write(frame-0x1e0,q(descriptor));uc.mem_write(descriptor,bytes(24))
   uc.reg_write(UC_X86_REG_RCX,descriptor);uc.reg_write(UC_X86_REG_RSP,x.BASE+0xf000);uc.emu_start(0xcd67d3,0xcd6811,count=200)
   actual=struct.unpack('<I',uc.mem_read(descriptor+8,4))[0]
   assert actual==(8 if color_log2==9 else requested_exponent.bit_length()-1)
   exponent_cases.append({'colorLog2':color_log2,'kitExponentSize':requested_exponent,'nativeExponentLog2':actual,'nativeExponentSize':1<<actual,'redlineDefault':requested_exponent==256})
 # Follow selected RT -> shared VTF dimensions -> final VTF initializer.
 # The width/height/depth/mip getters and allocator are explicit object ABI
 # inputs; the original pool selection and native VTF init argument writer run.
 # The separate original draw and readback both use that same RT width/height
 # (0x6a210..0x6a2b2 and 0x6a3a0..0x6a438), without a 2048 upscale or tile loop.
 uv=x.emulator(material);vt=x.BASE+0x3000;shared=x.BASE+0x2000;final=x.BASE+0x2800
 callback_base=x.BASE+0x4000;init=x.BASE+0x4600;uv.mem_write(shared,q(vt));uv.mem_write(final,q(vt));uv.mem_write(vt+0x10,q(init));uv.mem_write(init,b'\xc3')
 initializations=[]
 def capture_init(u,at,size,data):
  stack=u.reg_read(UC_X86_REG_RSP)
  initializations.append({'width':u.reg_read(UC_X86_REG_RSI),'height':u.reg_read(UC_X86_REG_RDX),'depth':u.reg_read(UC_X86_REG_RCX),'format':u.reg_read(UC_X86_REG_R8),'flags':u.reg_read(UC_X86_REG_R9),'frames':struct.unpack('<Q',u.mem_read(stack+8,8))[0],'mipCount':struct.unpack('<Q',u.mem_read(stack+16,8))[0]})
 uv.hook_add(UC_HOOK_CODE,capture_init,begin=init,end=init)
 final_cases=[]
 for row in sizes:
  for exponent in [False,True]:
   size=row['nativeTargetSize'];mips=size.bit_length()
   for n,(slot,value) in enumerate([(0x78,size),(0x80,size),(0x88,1),(0x90,mips)]):
    callback=callback_base+n*0x100;uv.mem_write(vt+slot,q(callback));uv.mem_write(callback,b'\xb8'+i32(value)+b'\xc3');uv.ctl_remove_cache(callback,callback+6)
   uv.mem_write(object+0x2b0,q(shared));uv.mem_write(object+0x220,i32(exponent));uv.reg_write(UC_X86_REG_RBX,object);uv.reg_write(UC_X86_REG_RAX,final);uv.reg_write(UC_X86_REG_RSP,x.BASE+0xe000-0x40)
   uv.emu_start(0x69042,0x690c7,count=100)
   result=initializations[-1];assert result=={'width':size,'height':size,'depth':1,'format':65 if exponent else 66,'flags':0x400,'frames':1,'mipCount':mips}
   final_cases.append({'logicalRequest':row['requested'],'exponent':exponent,'nativeFinalVTFInit':result})
 formats={}
 for index,name in [(0,'RGBA8888'),(13,'DXT1'),(15,'DXT5'),(65,'DXT1_RUNTIME'),(66,'DXT5_RUNTIME')]:
  address=0x37f910+index*16;pointer=struct.unpack('<Q',material.code(address,8))[0]
  assert material.cstring(pointer)==name;formats[index]={'name':name,'tableEntry':hex(address)}
 assert struct.unpack('<Q',material.code(0x37b758,8))[0]==0x37ed40
 assert struct.unpack('<Q',material.code(0x37ed48,8))[0]==0x1304c0
 assert material.cstring(0x1304c0)=='11CVTFTexture'
 assert struct.unpack('<Q',material.code(0x37b760+0x170,8))[0]==0x115f70
 material.check(0x696a7,'ff 90 70 01 00 00')
 report={'status':'original_output_srgb_write_and_render_target_pool_executed','binaries':{name:e.identity() for name,e in [('stdshader',shader),('shaderapi',api),('togl',togl),('materialsystem',material),('client',client)]},
  'shadowVtable':{'rtti':'CShaderShadowDX8','typeinfo':'0x31a9a0','table':'0x315440','slotBytes':'0x98','method':'0x5c980','field':'object+0x39 bit2'},
  'writeCases':cases,'renderTargetPool':rows,'renderTargetCases':sizes,'logicalSizeCases':logical,'imageFormats':formats,'nativeMipGenerator':{'vtable':'0x37b760','slot':'0x170','method':'0x115f70','postReadbackCall':'0x696a7','methodExecuted':False},'exponentDescriptorCases':exponent_cases,'finalVTFInitCases':final_cases,
  'boundary':'Original installed CPU writer/GL dispatch and RT pool selection. Hardware capability and successful pool allocation are explicit inputs. Original GPU output pixel/quantization, gameplay caller profile and live picmip, input min/mag/mip filtering, native mip contents and final compressed VTF bytes are not verified. Final VTF allocation uses the selected RT dimensions; RT dimension getters and successful pool allocation are explicit ABI inputs. Original post-readback calls VTF slot+0x170 before converting every returned mip.'}
 path=ROOT/'.reference-assets/source-exports/ak47-redline-programs/render-contract.json';path.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'writeCases':len(cases),'targetCases':sizes,'file':str(path),'sha256':m.sha(path.read_bytes())},indent=2))
if __name__=='__main__':main()
