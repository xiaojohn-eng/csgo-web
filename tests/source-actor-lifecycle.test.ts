import * as T from 'three';
import {expect,it,vi} from 'vitest';
import {Art} from '../game/scene';
import type {Player} from '../game/types';

function harness(){
  const art=Object.create(Art.prototype) as Art;
  art.originalDust2=true;art.scene=new T.Scene();art.actors=new Map();
  const finishRequests=new Map(),finishRelease=vi.fn();
  // The owner that has already resolved, so a released root is handed back to its own
  // material without waiting a microtask, the way a scene that has finished loading does.
  const owner={releaseRoot:finishRelease};
  Object.assign(art,{sourceFinishRequests:finishRequests,
    sourceFinishOwners:new Map([['vandal',Promise.resolve(owner)]]),sourceFinishReady:new Map([['vandal',owner]])});
  const sharedGeometry=new T.BoxGeometry(),sharedMaterial=new T.MeshBasicMaterial();
  const geometryDispose=vi.spyOn(sharedGeometry,'dispose'),materialDispose=vi.spyOn(sharedMaterial,'dispose');
  const make=(team:string,weapon?:string)=>{const root=new T.Group();root.userData.sourceCharacter={};root.userData.sourceTeam=team;root.userData.sourceWeaponId=weapon;
    root.add(new T.Mesh(sharedGeometry,sharedMaterial));return root;};
  const releaseActor=vi.fn((root:T.Group)=>{root.removeFromParent();delete root.userData.sourceCharacter;return true;});
  art.assets={releaseActor,operator:vi.fn((p:Player)=>make(p.team,p.weapon))} as unknown as Art['assets'];
  return{art,make,releaseActor,geometryDispose,materialDispose,finishRequests,finishRelease};
}
it('retires a disconnected Source actor and its marker without disposing shared character assets',()=>{
  const h=harness(),root=h.art.actor({id:'peer',team:'blue'} as Player);
  h.finishRequests.set(root,{key:'vandal:282:422:0.4',status:'ready'});
  const marker=root.getObjectByName('TeamMarker') as T.Mesh;
  const markerGeometry=vi.spyOn(marker.geometry,'dispose'),markerMaterial=vi.spyOn(marker.material as T.Material,'dispose');
  h.art.updateActors([],'host',0);
  expect(h.art.actors.size).toBe(0);expect(root.parent).toBeNull();expect(h.releaseActor).toHaveBeenCalledOnce();
  expect(markerGeometry).toHaveBeenCalledOnce();expect(markerMaterial).toHaveBeenCalledOnce();
  expect(h.geometryDispose).not.toHaveBeenCalled();expect(h.materialDispose).not.toHaveBeenCalled();
  expect(h.finishRelease).toHaveBeenCalledExactlyOnceWith(root);expect(h.finishRequests.size).toBe(0);
});
it('recreates the correct original model when an existing player ID changes team',()=>{
  const h=harness(),old=h.art.actor({id:'peer',team:'amber'} as Player);
  const next=h.art.actor({id:'peer',team:'blue'} as Player);
  expect(next).not.toBe(old);expect(next.userData.sourceTeam).toBe('blue');expect(old.parent).toBeNull();
  expect(h.art.actors.get('peer')).toBe(next);expect(h.releaseActor).toHaveBeenCalledExactlyOnceWith(old);
  expect(h.geometryDispose).not.toHaveBeenCalled();expect(h.materialDispose).not.toHaveBeenCalled();
});
it('recreates the held rifle skeleton when the same player buys a different original weapon',()=>{
  const h=harness(),old=h.art.actor({id:'peer',team:'blue',weapon:'m4a4'} as Player);
  const next=h.art.actor({id:'peer',team:'blue',weapon:'vandal'} as Player);
  expect(next).not.toBe(old);expect(next.userData.sourceWeaponId).toBe('vandal');
  expect(h.releaseActor).toHaveBeenCalledExactlyOnceWith(old);expect(h.art.actors.size).toBe(1);
  expect(h.geometryDispose).not.toHaveBeenCalled();expect(h.materialDispose).not.toHaveBeenCalled();
});
