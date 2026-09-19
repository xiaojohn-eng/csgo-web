"""Read twelve original gun-body VMTs without borrowing FP controls for world USP.

No texture export or original file modification. Runtime data only covers parsed
parameters; original shader formula evidence remains in source-material-environment.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import re

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/fidelity-materials-20260913/default-weapons'

def main():
    spec=importlib.util.spec_from_file_location('original_vpk',ROOT/'scripts/inventory-source-map.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    source=module.VPKIndex(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    weapons={'ak47':('rif_ak47/ak47','Source_AK47_VertexLitGeneric','Source_AK47_VertexLitGeneric'),
             'm4a4':('rif_m4a1/rif_m4a1','Source_M4A4_VertexLitGeneric','Source_World_M4A4_VertexLitGeneric'),
             'awp':('snip_awp/awp','Source_AWP_FP_VertexLitGeneric','Source_AWP_World_VertexLitGeneric'),
             'glock':('pist_glock18/pist_glock18','Source_glock_VertexLitGeneric','Source_World_glock_VertexLitGeneric'),
             'usp':('pist_223/pist_223','Source_usp_VertexLitGeneric','Source_World_usp_VertexLitGeneric'),
             'deagle':('pist_deagle/pist_deagle','Source_deagle_VertexLitGeneric','Source_World_Deagle_VertexLitGeneric')}
    data={};cases=[]
    OUT.mkdir(parents=True,exist_ok=True)
    for weapon,(stem,fpname,worldname) in weapons.items():
        data[weapon]={}
        for world in (False,True):
            path=f'materials/models/weapons/{"w_models/w_" if world else "v_models/"}{stem}.vmt'
            raw=source.read(path)
            text=re.sub(r'//[^\r\n]*','',raw.decode())
            params={key.lower():value for key,value in re.findall(r'"([^"\r\n]+)"\s+"([^"\r\n]+)"',text)}
            assert 'vertexlitgeneric' in text.lower()
            assert params['$phong']=='1' and params['$basemapalphaphongmask']=='1'
            assert '$bumpmap' not in params and '$phongexponenttexture' in params
            def vector(key):
                value=[float(n) for n in params[key].strip('[]').split()]
                assert len(value)==3
                return value
            half=params['$phongdisablehalflambert']=='0'
            assert half==(weapon=='usp' and world)
            albedo=params.get('$phongalbedotint','0')=='1'
            assert albedo!=half
            p=dict(name=worldname if world else fpname,boost=float(params['$phongboost']),
                   fresnel=vector('$phongfresnelranges'),phongMask='baseAlpha',halfLambert=half,albedoTint=albedo)
            if albedo:p['albedoBoost']=float(params['$phongalbedoboost'])
            else:p['tint']=[1,1,1]
            if '$envmap' in params:
                assert params['$envmap']=='env_cubemap' and params['$envmapfresnel']=='1'
                p['envmap']=dict(tint=vector('$envmaptint'),fresnel=True,mask='phongMask')
            else: assert half
            sha=hashlib.sha256(raw).hexdigest()
            variant='world' if world else 'firstPerson'
            data[weapon][variant]=dict(sourceVMT=path,sha256=sha,parameters=p)
            (OUT/f'{weapon}-{variant}.vmt').write_bytes(raw)
            lines={key:next(i+1 for i,line in enumerate(raw.decode().splitlines())
                           if re.search(r'"'+re.escape(key)+r'"',re.sub(r'//.*','',line),re.I)) for key in params}
            cases.append(dict(weapon=weapon,variant=variant,sourceVMT=path,sha256=sha,bytes=len(raw),
                              originalParameters=params,originalLineNumbers=lines,parameters=p))
    result=dict(format='source-default-weapon-vmts-v1',sourceApp=740,build=12426148,cases=cases,
                boundary='VPK CRC-verified original VMT bytes and explicit parsed controls. '
                         'Source light sampling and pixel equivalence need independent GPU acceptance.')
    encoded=json.dumps(result,indent=2)+'\n'
    (ROOT/'research/source-default-weapon-materials.json').write_text(encoded)
    (OUT/'evidence.json').write_text(encoded)
    (ROOT/'game/source-default-weapon-material-data.ts').write_text(
        '// Generated from twelve original VMTs by export-source-default-weapon-materials.py.\n'
        'export const SOURCE_DEFAULT_WEAPON_MATERIAL_DATA = '+json.dumps(data,separators=(',',':'))+' as const;\n')
    print(json.dumps(dict(materials=len(cases),output=str(OUT.relative_to(ROOT)))))

if __name__=='__main__':main()
