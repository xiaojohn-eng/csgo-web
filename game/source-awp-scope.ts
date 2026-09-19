/** Original installed i386 CHudScope::Paint, client SHA 21d2d652...43d4cb.
 * This pure owner returns original VGUI primitives in their original order.
 * Pixels, blend state, viewport and camera remain renderer responsibilities. */
export const SOURCE_AWP_SCOPE_VERSION='app740-12426148-awp-client-scope-v1';
export type SourceAWPScopeState={blur:number};
export type SourceAWPScopeContext={
 width:number;height:number;dt:number;scoped:boolean;playerFov:number;zoomFov:number;
 displayInaccuracy:number;spread:number;defaultFov?:number;sniperWidth?:number;
 player?:boolean;weapon?:boolean;viewmodel?:boolean;correctViewmodelType?:boolean;
 observerInterpolationState?:number;observerMode?:number;observerTarget?:boolean;isPlayer?:boolean;weaponType?:number;
 /** Original viewmodel +0x2aac/+0x2ab0, already evaluated by that owner. */
 viewmodelX?:number;viewmodelY?:number;weaponOffset?:number;
};
export type SourceAWPScopeColor=[number,number,number,number];
export type SourceAWPScopeVertex=[number,number,number,number];
export type SourceAWPScopeDraw={kind:'line'|'rect';color:SourceAWPScopeColor;rect:[number,number,number,number]}|{kind:'polygon';color:SourceAWPScopeColor;texture:1|2|3;vertices:SourceAWPScopeVertex[]};
const F=Math.fround,T=(v:number)=>Math.trunc(v)||0,L=.001953125,H=.998046875;
/** Constructor sets one; a completed unscoped/default-FOV Paint resets two. */
export function createSourceAWPScopeState():SourceAWPScopeState{return {blur:1};}
export function sourceAWPScopePaint(state:Readonly<SourceAWPScopeState>,input:Readonly<SourceAWPScopeContext>){
 const x={player:true,weapon:true,viewmodel:true,correctViewmodelType:true,observerInterpolationState:0,observerMode:0,observerTarget:true,isPlayer:true,weaponType:5,defaultFov:90,sniperWidth:1,viewmodelX:0,viewmodelY:0,weaponOffset:0,...input};
 if(!Number.isInteger(x.width)||!Number.isInteger(x.height)||x.width<1||x.height<1||x.width>32768||x.height>32768||![state.blur,x.dt,x.playerFov,x.zoomFov,x.displayInaccuracy,x.spread,x.viewmodelX,x.viewmodelY,x.weaponOffset].every(v=>Number.isFinite(F(v)))||x.dt<0||state.blur<0||x.displayInaccuracy<0||x.spread<0||!Number.isInteger(x.sniperWidth)||x.sniperWidth<1)throw RangeError('Invalid original AWP scope context');
 let blur=F(state.blur);const draws:SourceAWPScopeDraw[]=[];
 const finish=()=>({state:{blur},draws});
 if(!x.player||x.observerInterpolationState===1||x.observerMode!==0&&(x.observerMode!==4||!x.observerTarget||!x.isPlayer)||!x.weapon||x.weaponType!==5)return finish();
 if(F(x.playerFov)===F(x.defaultFov)&&!x.scoped)blur=2;
 if(F(x.defaultFov)===F(x.zoomFov)||!x.scoped||!x.viewmodel||!x.correctViewmodelType)return finish();
 const tangent=F(Math.tan(Math.max(F(F(x.zoomFov)*F(.008726646192371845)),F(.35))));
 const amount=Math.max(0,Math.min(100,F(F(F(F(x.displayInaccuracy)+F(x.spread))*320)/tangent)));
 const target=amount>=2?F(F((amount-2)*(1/30))*F(.4)):0;
 const delta=F(target-blur),step=F(Math.abs(F(F(x.dt)*delta))*19);
 blur=delta>step?F(blur+step):-step>delta?F(blur-step):target;
 const h14=T(x.height/14),h20=T(x.height/20);
 const offsetX=T(F(F(x.weaponOffset)+F(F(x.viewmodelY)*F(h14)))),offsetY=T(F(F(x.viewmodelX)*F(h14)));
 let scale=F(F(.04)*blur);if(scale>.22)scale=F(.22);
 const inset=T(x.height*.5*scale+h14),left0=T((x.width-x.height)/2)+inset;
 const left=left0+offsetX,right=x.width-left0+offsetX,top=inset+offsetY,bottom=x.height-inset+offsetY;
 const cx=T(x.width/2)+offsetX,cy=T(x.height/2)+offsetY;
 const lensX=T(F(F(cx)+F(F(x.height)*scale))),lensY=T(F(F(cy)+F(F(x.height)*scale)));
 const polygon=(texture:1|2|3,color:SourceAWPScopeColor,vertices:SourceAWPScopeVertex[])=>draws.push({kind:'polygon',texture,color,vertices});
 const box=(kind:'line'|'rect',color:SourceAWPScopeColor,rect:[number,number,number,number])=>draws.push({kind,color,rect});
 polygon(3,[255,255,255,200],[[cx+lensX,cy+lensY,H,L],[cx-lensX,cy+lensY,L,L],[cx-lensX,cy-lensY,L,H],[cx+lensX,cy-lensY,H,H]]);
 const hair:SourceAWPScopeColor=[0,0,0,Math.max(32,255-T(F(900*blur)))];
 if(x.sniperWidth>1){const half=T(x.sniperWidth/2);box('rect',hair,[0,cy-half,x.width+offsetX,cy+x.sniperWidth-half]);box('rect',hair,[cx-half,0,cx+x.sniperWidth-half,x.height+offsetY]);}
 else{box('line',hair,[0,cy,x.width+offsetX,cy]);box('line',hair,[cx,0,cx,x.height+offsetY]);}
 const line:SourceAWPScopeColor=[0,0,0,Math.min(80,T(F(700*blur)))];
 polygon(2,line,[[cx-h20,offsetY,L,L],[cx+h20,offsetY,H,L],[cx+h20,x.height+offsetY,H,H],[cx-h20,x.height+offsetY,L,H]]);
 polygon(2,line,[[x.width+offsetX,cy-h20,L,H],[x.width+offsetX,cy+h20,H,H],[offsetX,cy+h20,H,L],[offsetX,cy-h20,L,L]]);
 const black:SourceAWPScopeColor=[0,0,0,255];
 polygon(1,black,[[cx,cy,L,L],[right,cy,H,L],[right,bottom,H,H],[cx,bottom,L,H]]);
 polygon(1,black,[[cx-1,top,L,H],[right,top,H,H],[right,cy+1,H,L],[cx-1,cy+1,L,L]]);
 polygon(1,black,[[left,cy,H,L],[cx,cy,L,L],[cx,bottom,L,H],[left,bottom,H,H]]);
 polygon(1,black,[[left,top,H,H],[cx,top,L,H],[cx,cy,L,L],[left,cy,H,L]]);
 box('rect',black,[0,0,x.width,top]);box('rect',black,[0,bottom,x.width,x.height]);box('rect',black,[0,top,left,x.height]);box('rect',black,[right,top,x.width,x.height]);
 return finish();
}
/** Original 0xbd4040 mixed float32/double operation order. Its renderer caller
 * supplies ratio=aspect*.75: fov is a 4:3 reference horizontal angle. */
export function sourceAWPScaleFov(fov:number,ratio:number){
 if(!Number.isFinite(F(fov))||fov<=0||fov>=180||!Number.isFinite(F(ratio))||ratio<=0)throw RangeError('Invalid original FOV scale');
 const tangent=F(Math.tan(F(F(fov)*.008726646259971648)));
 return F(F(Math.atan(F(tangent*F(ratio)))*57.29577951308232)*2);
}
