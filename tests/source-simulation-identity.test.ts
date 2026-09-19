import {describe,it,expect} from 'vitest';
import {SOURCE_DUST2_ID,LEGACY_MAP_ID,sourceSimulationVersion} from '../game/source-identity';
import {requireSimulationVersion} from '../server/lan';
import {sourceRifleSimulationVersion,sourceUSPSimulationVersion} from '../game/source-rifle-profiles';
import {SOURCE_PISTOL_CHARACTERS} from '../game/source-pistol-character-contracts';
const files={level:{sha256:'a'.repeat(64)},collision:{sha256:'b'.repeat(64)},navigation:{sha256:'c'.repeat(64)},world:{sha256:'d'.repeat(64)}};
describe('Source simulation data compatibility',()=>{
  it('rejects old physics with the same BSP/map and rejects missing versions',()=>{
    const current=sourceSimulationVersion(files);
    const old=sourceSimulationVersion({...files,collision:{sha256:'e'.repeat(64)}});
    expect(()=>requireSimulationVersion({mapId:SOURCE_DUST2_ID,simulationVersion:current},current)).not.toThrow();
    for(const supplied of [old,undefined,null,{},current.slice(0,-1)])
      expect(()=>requireSimulationVersion({mapId:SOURCE_DUST2_ID,simulationVersion:supplied},current)).toThrow(/SIMULATION_MISMATCH/);
    expect(()=>requireSimulationVersion({mapId:SOURCE_DUST2_ID})).toThrow(/SIMULATION_MISMATCH/);
  });
  it('includes each simulation layer in a stable order but permits visual-only changes',()=>{
    const current=sourceSimulationVersion(files);
    for(const key of ['level','collision','navigation'])expect(sourceSimulationVersion({...files,[key]:{sha256:'f'.repeat(64)}})).not.toBe(current);
    expect(sourceSimulationVersion({...files,world:{sha256:'f'.repeat(64)}})).toBe(current);
    expect(sourceSimulationVersion({navigation:files.navigation,collision:files.collision,level:files.level})).toBe(current);
    expect(()=>sourceSimulationVersion({...files,collision:{sha256:'unknown'}})).toThrow(/collision/);
    expect(()=>sourceSimulationVersion({level:files.level,collision:files.collision})).toThrow(/navigation/);
  });
  it('preserves legacy rooms that do not load original Source simulation data',()=>{
    expect(()=>requireSimulationVersion({mapId:LEGACY_MAP_ID})).not.toThrow();
    expect(()=>requireSimulationVersion({})).not.toThrow();
  });
  it('rejects an old animation set even when all map physics receipts match',()=>{
    const variants={amber:{vandal:{poseVersion:'csgo-t-ak-12426148:old'},m4a4:{poseVersion:'csgo-t-m4-12426148:a'}},
      blue:{vandal:{poseVersion:'csgo-ct-ak-12426148:b'},m4a4:{poseVersion:'csgo-ct-m4-12426148:c'}}};
    const map=sourceSimulationVersion(files),old=sourceRifleSimulationVersion(map,variants);
    variants.amber.vandal.poseVersion='csgo-t-ak-12426148:corrected';const current=sourceRifleSimulationVersion(map,variants);
    expect(current).not.toBe(old);expect(()=>requireSimulationVersion({mapId:SOURCE_DUST2_ID,simulationVersion:old},current)).toThrow(/SIMULATION_MISMATCH/);
  });
});

it('rejects pre-USP clients and swapped original USP team receipts',()=>{
 const assets={amber:SOURCE_PISTOL_CHARACTERS['t-usp'],blue:SOURCE_PISTOL_CHARACTERS['ct-usp']};const next=sourceUSPSimulationVersion('rifle-glock-baseline',assets);
 expect(next).toContain('csgo-usp-runtime-12426148-r1');expect(next).toContain('app740-12426148-usp-animation-clock-v1');
 expect(()=>requireSimulationVersion({mapId:SOURCE_DUST2_ID,simulationVersion:'rifle-glock-baseline'},next)).toThrow(/SIMULATION_MISMATCH/);
 expect(()=>sourceUSPSimulationVersion('rifle-glock-baseline',{amber:assets.blue,blue:assets.amber})).toThrow(/USP/);
});
