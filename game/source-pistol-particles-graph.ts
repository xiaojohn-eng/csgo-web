/** Original PCF data graph. It deliberately does not invent particle operators. */
export const SOURCE_PISTOL_PARTICLE_GRAPH_VERSION='csgo-pistol-particle-graph-12426148-r1';
export type SourceParticleReference={ref:string;name:string};
export type SourceParticleElement={id:string;name:string;type:string;attributes:Record<string,unknown>;attributeTypes:Record<string,string>};
export type SourceParticleFile={path:string;bytes:number;sha256:string};
/** One original SpriteCard sheet frame: its own duration and four
 * `TexCoord(left, top, right, bottom)` rects (the first is the sheet rect; a
 * dual-sequence texture uses the rest). */
export type SourceParticleSheetFrame={duration:number;rects:[number,number,number,number][]};
export type SourceParticleSheetSequence={id:number;flags:number;frameCount:number;duration:number;
 frames:SourceParticleSheetFrame[]};
/** The decoded `VTF_RSRC_SHEET` resource: `sequenceCount` sequences, each an
 * animation of `frameCount` frames whose durations sum to the sequence's own total.
 * A system's original `Sequence Random` selects one; `frameCount` is the sheet's
 * total. This mirrors `decodeSourcePistolParticleSheet`, which is the authority. */
export type SourceParticleSheet={version:number;sequenceCount:number;frameCount:number;sequences:SourceParticleSheetSequence[]};
export type SourceParticleResource={tag:string;flags:number;value:number;sheetFile?:SourceParticleFile;
 sheet?:SourceParticleSheet;decoded?:boolean};
export type SourceParticleTexture={source:string;file:SourceParticleFile;width:number;height:number;frames:number;frameDecodeStatus:string;
 /** VTF 7.2+ carries the resource dictionary; 7.0/7.1 predate it and so cannot
  * hold a sprite sheet at all. Absent on exports that did not record it. */
 resourceTable?:string;
 images:{frame:number;file:SourceParticleFile;rgbaSha256:string}[];resources:SourceParticleResource[]};
export type SourcePistolParticleGraph={format:'source-pistol-particles-v1';build:12426148;root:string;roots?:{name:string;id:string}[];
 source:{sha256:string};elements:SourceParticleElement[];
 materialResolutions?:{systemValue:string;sourceValue:string;resolved:string;reason:string}[];
 namedReplacements:{source:string;field:string;target:string;name:string}[];materials:{source:string;file:SourceParticleFile;definition:Record<string,unknown>;textures:{parameter:string;source:string}[]}[];
 textures:SourceParticleTexture[]};
export type SourceParticleNativeDefaults={format:'source-pistol-particle-native-defaults-v1';clientSHA256:string;status:'original-unpack-getters-executed';
 operators:{functionName:string;nativeGetterExecuted:boolean;registrationVA?:string;definitionVTable?:string;factory?:string;unpackGetter?:string;tableVA?:string;fields:{name:string;default:string|null;nativeType:number;offset:number;bytes:number}[]}[];
 /** Original names this build cannot tell apart, and names with no schema at all.
  * Both are declared instead of guessed, and a system that needs one fails closed. */
 unresolvedOperators?:string[];absentOperators?:string[];
 /** Legacy class-style spellings the closure uses, resolved to the registration they
  * stand for. The probe's own list of names it could not tell apart is kept beside it
  * so the aliases can be audited against how they were found. */
 aliasedOperators?:{requested:string;resolved:string}[];probeUnresolvedOperators?:string[]};
const phases=['initializers','operators','emitters','renderers','children','forces','constraints']as const;
/** The original muzzle systems this build exports a closure from. A graph is
 * accepted only when its declared root is one of them, so a new export can never
 * silently become the root of an existing port or of an unknown one. */
export const SOURCE_PARTICLE_GRAPH_ROOTS:readonly string[]=['weapon_muzzle_flash_pistol','weapon_muzzle_flash_assaultrifle','weapon_muzzle_flash_awp','explosion_smokegrenade'];
function check(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
function references(value:unknown):SourceParticleReference[]{
 if(Array.isArray(value))return value.flatMap(references);
 if(value&&typeof value==='object'){
  const v=value as Record<string,unknown>;
  if('ref'in v){check(typeof v.ref==='string'&&typeof v.name==='string','Invalid original particle reference');return[v as SourceParticleReference];}
  return Object.values(v).flatMap(references);
 }return[];
}
export function prepareSourcePistolParticleGraph(input:unknown){
 const data=structuredClone(input)as SourcePistolParticleGraph;
 check(data?.format==='source-pistol-particles-v1'&&data.build===12426148&&Array.isArray(data.elements),'Unknown original pistol particle graph');
 const elements=new Map(data.elements.map(e=>[e.id,e]));check(elements.size===data.elements.length,'Duplicate original particle element');
 const root=elements.get(data.root);check(root?.type==='DmeParticleSystemDefinition'&&SOURCE_PARTICLE_GRAPH_ROOTS.includes(root.name),'Wrong original particle graph root');
 for(const declared of data.roots??[])check(elements.get(declared.id)?.name===declared.name,'Unresolved original particle root declaration');
 const systems=new Map<string,SourceParticleElement>();
 // One original block names its material without the `.vmt` extension. The export
 // records what that string resolved to, so the resolution is checked rather than
 // guessed here.
 const materialPath=(value:unknown)=>{let path=String(value).replace(/\\/g,'/').toLowerCase();if(!path.startsWith('materials/'))path='materials/'+path;return path;};
 const resolvedMaterials=new Map<string,string>();
 for(const row of data.materialResolutions??[])resolvedMaterials.set(materialPath(row.systemValue),materialPath(row.resolved));
 for(const e of data.elements){check(e.id&&e.name&&e.attributes&&e.attributeTypes,'Malformed original particle element');
  for(const ref of references(e.attributes))check(elements.get(ref.ref)?.name===ref.name,'Unresolved original particle reference: '+ref.name);
  if(e.type==='DmeParticleSystemDefinition'){
   check(!systems.has(e.name),'Duplicate original particle system');systems.set(e.name,e);
   for(const phase of phases)check(Array.isArray(e.attributes[phase]),'Original particle phase absent: '+phase);
   const material=String(e.attributes.material??'');
   if(material)check(data.materials.some(m=>m.source===(resolvedMaterials.get(materialPath(material))??materialPath(material))),'Original particle material unresolved: '+materialPath(material));
  }
 }
 for(const row of data.materialResolutions??[])check(data.materials.some(m=>m.source===materialPath(row.resolved)),'Unresolved original particle material resolution: '+row.systemValue);
 for(const r of data.namedReplacements)check(elements.has(r.source)&&elements.get(r.target)?.name===r.name,'Original particle fallback unresolved');
 for(const m of data.materials)for(const t of m.textures)check(data.textures.some(v=>v.source===t.source),'Original particle texture unresolved: '+t.source);
 const visited=new Set<string>(),active=new Set<string>();
 function visit(id:string){check(!active.has(id),'Cyclic original particle graph');if(visited.has(id))return;active.add(id);
  const e=elements.get(id)!;for(const r of references(e.attributes))visit(r.ref);for(const r of data.namedReplacements.filter(r=>r.source===id))visit(r.target);
  active.delete(id);visited.add(id);
 }
 // Every declared root of the exported closure is traversed, so a graph that ships
 // more than one original system still proves all of its elements reachable.
 for(const start of data.roots?.length?data.roots.map(r=>r.id):[data.root])visit(start);
 check(visited.size===elements.size,'Unreachable original particle elements');
 return {data,root,elements,systems,
  phase(name:string,phase:typeof phases[number]){const system=systems.get(name);check(system,'Unknown original particle system');
   return(system.attributes[phase]as SourceParticleReference[]).map(r=>elements.get(r.ref)!);},
  functionNames:[...new Set(data.elements.flatMap(e=>typeof e.attributes.functionName==='string'?[e.attributes.functionName]:[]))].sort()};
}
/** The original operator definition a name refers to, and whether that took a legacy
 * alias.
 *
 * A shipped PCF can name an operator by the lowercase class-style spelling its
 * authoring tool wrote (`remap initial scalar`), while this build's registry holds the
 * display name (`Remap Initial Scalar`) and the C++ class name
 * (`C_INIT_RemapScalar`). Neither of the file's spellings is registered verbatim, and
 * the same file uses both spellings for the same operator (`weapon_muzzle_flash_
 * assaultrifle_main` writes `Remap Initial Scalar`, `weapon_muzzle_flash_assualtrifle_
 * flame` writes `remap initial scalar`), which is why the original treats them as one
 * definition. This resolves a name by its normalised form (case, spaces and
 * underscores ignored) and only when exactly one registered operator matches, so an
 * ambiguous name still fails closed instead of being guessed at. */
export function sourceParticleSchemaFor(name:string,native:SourceParticleNativeDefaults){
 const exact=native.operators.find(o=>o.functionName===name);
 if(exact)return {schema:exact,aliasedFrom:null as string|null};
 const normalise=(value:string)=>value.toLowerCase().replace(/[\s_]+/g,'');
 const wanted=normalise(name),matches=native.operators.filter(o=>normalise(o.functionName)===wanted);
 return matches.length===1?{schema:matches[0],aliasedFrom:name}:null;
}

/** Resolved configuration is inspectable data, not an implemented operator.
 * Native enum 2=int, 3=float, 4=bool, 8=color, 10=Vector3, 11=Vector4.
 * The enum comes from executing the build's own unpack table getters. */
export function sourcePistolParticleParameters(element:SourceParticleElement,native:SourceParticleNativeDefaults){
 check(native.format==='source-pistol-particle-native-defaults-v1'&&native.status==='original-unpack-getters-executed','Native particle defaults are unverified');
 const requested=String(element.attributes.functionName),resolved=sourceParticleSchemaFor(requested,native);
 check(resolved?.schema.nativeGetterExecuted,'Original particle operator schema missing');
 const schema=resolved.schema;
 const values:Record<string,unknown>={},origins:Record<string,'pcf'|'native-default'|'unresolved'>={};
 for(const f of schema.fields){
  if(Object.hasOwn(element.attributes,f.name)){values[f.name]=structuredClone(element.attributes[f.name]);origins[f.name]='pcf';continue;}
  if(f.default===null){values[f.name]=null;origins[f.name]='unresolved';continue;}
  const numbers=f.default.trim().split(/\s+/).map(Number);let value:unknown;
  if(f.nativeType===2)value=Number(f.default);
  else if(f.nativeType===3)value=Math.fround(Number(f.default));
  else if(f.nativeType===4){check(f.default==='0'||f.default==='1','Unknown native particle boolean default');value=f.default==='1';}
  else if(f.nativeType===8||f.nativeType===10||f.nativeType===11){
   check(numbers.length===(f.nativeType===10?3:4)&&numbers.every(Number.isFinite),'Invalid native particle vector default');value=f.nativeType===8?numbers:numbers.map(Math.fround);
  }else {values[f.name]=f.default;origins[f.name]='unresolved';continue;}
  check(typeof value!=='number'||Number.isFinite(value),'Invalid native numeric default');values[f.name]=value;origins[f.name]='native-default';
 }
 const unknownOverrides=Object.keys(element.attributes).filter(k=>k!=='functionName'&&!schema.fields.some(f=>f.name===k));
 return {functionName:String(element.attributes.functionName),schemaFunctionName:schema.functionName,aliasedFrom:resolved.aliasedFrom,
  values,origins,unknownOverrides};
}

/** Version 1 sheet record layout, independently bounded against complete raw
 * VTF resources. UV animation interpolation remains a separate native task. */
export function decodeSourcePistolParticleSheet(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
 const u=()=>{check(at+4<=bytes.length,'Truncated particle sheet');const n=view.getUint32(at,true);at+=4;return n;};
 const f=()=>{check(at+4<=bytes.length,'Truncated particle sheet');const n=view.getFloat32(at,true);at+=4;check(Number.isFinite(n),'Nonfinite particle sheet value');return n;};
 const version=u(),count=u();check(version===1&&count>0&&count<10000,'Unsupported original particle sheet');
 const sequences=[];const ids=new Set<number>();
 for(let i=0;i<count;i++){
  const id=u(),flags=u(),frameCount=u(),duration=f();check(!ids.has(id)&&flags<=1&&frameCount>0&&frameCount<10000&&duration>0,'Invalid original sheet sequence');ids.add(id);
  const frames=[];let total=0;
  for(let j=0;j<frameCount;j++){
   const frameDuration=f();check(frameDuration>0,'Invalid original sheet frame duration');total+=frameDuration;
   const images=Array.from({length:4},()=>Array.from({length:4},f));
   check(images.every(uv=>uv.every(v=>v>=0&&v<=1)&&uv[0]<=uv[2]&&uv[1]<=uv[3]),'Invalid original sheet UV bounds');frames.push({duration:frameDuration,images});
  }
  check(Math.abs(total-duration)<1e-4,'Original sheet durations differ');sequences.push({id,flags,duration,frames});
 }
 check(at===bytes.length,'Trailing original particle sheet bytes');return {version,sequences,bytesConsumed:at};
}
