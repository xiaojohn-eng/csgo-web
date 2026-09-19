import {afterEach,describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import {Game} from '../game/runtime';
import {Art} from '../game/scene';
import type {Event as GameEvent} from '../game/types';

// Exercise the real event presentation and legacy geometry constructor without a WebGL
// context. Only the loaded original tracer renderer and the brass sink are replaced.
const scenes:T.Scene[]=[];
function harness(source:boolean){
  const scene=new T.Scene();scenes.push(scene);
  const spawn=vi.fn(),ejectCasing=vi.fn();
  const art=Object.assign(Object.create(Art.prototype),{
    originalDust2:source,scene,tracers:[],ejectCasing,sourceTracers:{spawn},
  }) as Art;
  const game=Object.assign(Object.create(Game.prototype),{
    art,you:'shooter',sourceScenario:source?{}:undefined,
  }) as {drawShot(event:GameEvent,own:boolean,predictedOwn:boolean):void};
  return{scene,art,game,spawn,ejectCasing};
}
afterEach(()=>{
  for(const scene of scenes.splice(0))scene.traverse(object=>{
    if(object instanceof T.Mesh){object.geometry.dispose();
      for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}
  });
});
type ShotEvent=Exclude<GameEvent,{type:'kill'}>&{type:'shot'};
const shot=(patch:Partial<ShotEvent>={}):ShotEvent=>({
  id:10,type:'shot',by:'shooter',seq:17,weapon:'vandal',
  x:1,y:2,z:3,dx:100,dy:0,dz:0,sourceTracer:{end:[181,2,3]},...patch,
});

describe('accepted Source shot presentation',()=>{
  it('draws the full authoritative endpoint without also constructing the legacy line or impact',()=>{
    const {game,scene,art,spawn,ejectCasing}=harness(true);
    game.drawShot(shot({impact:{x:181,y:2,z:3,nx:-1,ny:0,nz:0,surface:'C'}}),true,false);
    expect(spawn).toHaveBeenCalledExactlyOnceWith({
      weapon:'vandal',by:'shooter',seq:17,from:[1,2,3],to:[181,2,3],
    });
    // The old event vector is 100 m; the actual endpoint is 180 m away.
    expect(scene.children).toHaveLength(0);
    expect(art.tracers).toHaveLength(0);
    expect(ejectCasing).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['actor', [41,2,3]],
    ['open-air range limit', [209.0768,2,3]],
  ] as const)('draws a shot that ends at %s even though it has no surface impact',(_,end)=>{
    const {game,spawn,scene}=harness(true);
    const event=shot({sourceTracer:{end:[...end]}});
    expect(event.impact).toBeUndefined();
    game.drawShot(event,false,false);
    expect(spawn).toHaveBeenCalledExactlyOnceWith({
      weapon:'vandal',by:'shooter',seq:17,from:[1,2,3],to:[...end],
    });
    expect(scene.children).toHaveLength(0);
  });

  it('does not replay predicted local ejection when the authority supplies its ray',()=>{
    const {game,spawn,ejectCasing,art}=harness(true);
    game.drawShot(shot(),true,true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(ejectCasing).not.toHaveBeenCalled();
    expect(art.tracers).toHaveLength(0);
  });

  it('does not spend the viewer\'s own brass on a remote player\'s shot',()=>{
    const {game,spawn,ejectCasing}=harness(true);
    game.drawShot(shot({by:'remote'}),false,false);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0][0].by).toBe('remote');
    expect(ejectCasing).not.toHaveBeenCalled();
  });

  it('never invents an endpoint from a missing Source ray or from a sound-only report',()=>{
    const {game,spawn,scene,ejectCasing}=harness(true);
    game.drawShot(shot({sourceTracer:undefined}),true,false);
    game.drawShot({...shot(),type:'report'},true,false);
    expect(spawn).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    expect(ejectCasing).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy map\'s line, impact and ejection and ignores Source-only metadata there',()=>{
    const {game,spawn,ejectCasing,scene,art}=harness(false);
    game.drawShot(shot(),true,false);
    expect(spawn).not.toHaveBeenCalled();
    expect(ejectCasing).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(2);
    expect(art.tracers).toHaveLength(2);
    expect((scene.children[0] as T.Mesh).geometry.type).toBe('CylinderGeometry');
    expect((scene.children[1] as T.Mesh).position.toArray()).toEqual([101,2,3]);
  });
});
