"""Current browser radians -> Source QAngle -> original AngleMatrix oracle."""
import importlib.util,json,math,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
def main():
    spec=importlib.util.spec_from_file_location('trace',ROOT/'scripts/probe-source-hitboxes.py')
    native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native);engine=native.OriginalTrace();rows=[];deg=180/math.pi
    for yaw in [-math.pi,-2,-math.pi/2,0,.7,math.pi/2,math.pi]:
        for pitch in [-1.4,-.4,0,.35,1.4]:
            for punch in [[0,0,0],[-4.75,1.125,0],[2.2,-5,.3]]:
                angles=[f(f(-pitch*deg)+f(punch[0])),f(f((yaw+math.pi/2)*deg)+f(punch[1])),f(punch[2])]
                m=engine.angle(angles)
                rows.append(dict(yaw=yaw,pitch=pitch,punch=punch,sourceAngles=angles,original=dict(forward=[m[0],m[8],-m[4]],right=[-m[1],-m[9],m[5]],up=[m[2],m[10],-m[6]])))
    report=dict(sourceServerSha256=native.SHA,function='0xef17b0',rows=rows,
                limits=['Browser radians bridge is a coordinate derivation checked against the current handling.ts forward convention, not an original command network quantizer.',
                        'Original AngleMatrix plus C(x,y,z)=(x,z,-y); right is negative left column; host sincosf rounded to float.'])
    (ROOT/'output/tests/source-aim-native.json').write_text(json.dumps(report,indent=2)+'\n');print('PASS',len(rows))
if __name__=='__main__':main()
