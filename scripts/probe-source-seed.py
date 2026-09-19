"""Execute original client MD5 and actual-build server SHA1 seed pipelines.
Platform time and random entropy are explicit fixture inputs. Hash arithmetic
is entirely original instructions; only external memory-copy is supplied.
"""
from pathlib import Path
import importlib.util,struct,json,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('damage',ROOT/'scripts/probe-source-damage.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class NativeSeed(d.OriginalDamage):
    def __init__(self):
        super().__init__();self.time=0;self.entropy=0;self.adapter=d.STOP+768
        self.u.mem_write(self.adapter,b'\xdd\x05'+struct.pack('<I',self.adapter+32)+b'\xc3')
        assert self.external[0x7d3b78]=='Plat_FloatTime'and self.external[0x7d3bb9]=='RandomInt'
        assert self.raw[0x434582:0x434591].hex()=='68c12a3301685307220168604e7901'
        assert self.raw[0x1332ac1:0x1332ac3]==b'1\0'
    def hook(self,u,at,size,data):
        super().hook(u,at,size,data)
        sp=u.reg_read(UC_X86_REG_ESP)
        if at==0x7d3b77:
            u.mem_write(self.adapter+32,struct.pack('<d',self.time));self.ints(sp-4,[at+5]);u.reg_write(UC_X86_REG_ESP,sp-4)
            u.reg_write(UC_X86_REG_EIP,self.adapter)
        elif at==0x7d3bb8:
            assert struct.unpack('<2I',u.mem_read(sp,8))==(0,0x7fffffff)
            u.reg_write(UC_X86_REG_EAX,self.entropy);u.reg_write(UC_X86_REG_EIP,at+5)
        elif self.external.get(at+1)=='memcpy':
            dest,src,length=struct.unpack('<3I',u.mem_read(sp+(4 if self.raw[at]==0xe9 else 0),12))
            assert length<4096
            u.mem_write(dest,bytes(u.mem_read(src,length)));u.reg_write(UC_X86_REG_EAX,dest)
            if self.raw[at]==0xe9:
                u.reg_write(UC_X86_REG_EIP,self.uint(sp));u.reg_write(UC_X86_REG_ESP,sp+4)
            else:u.reg_write(UC_X86_REG_EIP,at+5)
    def server(self,time,entropy):
        self.reset();self.time=time;self.entropy=entropy;self.u.reg_write(UC_X86_REG_EBX,d.P)
        self.run(0x7d3b77,[0x7d3c26])
        payload=bytes(self.u.mem_read(d.F-0xf8,16));digest=bytes(self.u.mem_read(d.F-0xe8,20));value=self.uint(d.P+0x44)
        assert digest==hashlib.sha1(payload).digest()
        assert value==int.from_bytes(digest[:4],'little')
        return dict(platformSeconds=time,entropy=entropy,payloadHex=payload.hex(),sha1=digest.hex(),serverSeedUnsigned=value,seedByte=value&255)
    def client(self,command):
        self.reset();self.ints(d.F,[d.STOP,command]);self.u.reg_write(UC_X86_REG_ESP,d.F)
        self.run(0xe752d0,[d.STOP]);value=self.u.reg_read(UC_X86_REG_EAX)
        expected=int.from_bytes(hashlib.md5(struct.pack('<I',command)).digest()[6:10],'little');assert value==expected
        return dict(commandNumber=command,md5PseudoRandom=value,clientSeed=value&0x7fffffff)
def main():
    engine=NativeSeed()
    client=[engine.client(c)for c in [0,1,2,42,255,256,65535,2147483647,4294967295]]
    server=[engine.server(t,e)for t in [0,.001,1,123.456,86400.125,1e7]for e in [0,1,1234567,2147483647]]
    report=dict(status='original_command_seed_blocks_executed',sourceServerSha256=d.SHA,client=client,server=server,
                defaultCustomSeed=True,functions={'processUsercmds':'0x7d3a40','clientMD5':'0xe752d0','predictionSeedSetter':'0x600360'},
                limits=['Platform seconds and prior global RandomInt state are supplied inputs; record resulting authoritative seed for replay.',
                        'This actual build hashes 16 bytes with SHA1, unlike the fixed public SDK float-time-bitcast branch.'])
    (ROOT/'output/tests/source-seed-native.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'client':len(client),'server':len(server)}))
if __name__=='__main__':main()
