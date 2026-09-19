import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceAWPScopePaint,sourceAWPScaleFov} from '../game/source-awp-scope';
const native=JSON.parse(readFileSync('output/tests/source-awp-scope-native.json','utf8'));
function paint(input:any){return sourceAWPScopePaint({blur:input.blur??1},{width:1280,height:720,dt:1/64,scoped:true,playerFov:40,zoomFov:40,displayInaccuracy:.002,spread:.0002,...input});}
it('matches every original Paint vertex, half-texel UV, color and primitive order across 216 contexts',()=>{
 expect(native.clientSha256).toBe('21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb');expect(native.rows).toHaveLength(216);
 for(const [i,row]of native.rows.entries()){const got=paint(row.input);expect({blur:got.state.blur,draws:got.draws},`${i}`).toEqual(row.original);}
});
it('matches native visibility gates and 480 frames of scope blur, unzoom reset and viewmodel offsets',()=>{
 expect(native.gates).toHaveLength(23);
 for(const row of native.gates){const got=paint(row.input);expect({blur:got.state.blur,draws:got.draws}).toEqual(row.original);}
 let count=0;
 for(const chain of native.chains){let state={blur:chain.initial};for(const [i,row]of chain.frames.entries()){
  state=JSON.parse(JSON.stringify(state));const got=paint({...row.input,blur:state.blur});state=got.state;expect({blur:state.blur,draws:got.draws},`${chain.initial}/${i}`).toEqual(row.original);count++;
 }}expect(count).toBe(480);
});
it('matches all original mixed float/double FOV scaling calls',()=>{
 expect(native.projection).toHaveLength(42);
 for(const row of native.projection)expect(sourceAWPScaleFov(row.fov,row.ratio)).toBe(row.original);
});
