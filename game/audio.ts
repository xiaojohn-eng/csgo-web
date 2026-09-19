import type { WeaponId } from './types';
import type { SourcePistolMode } from './source-pistol-handling';
import sourceM4Audio from './source-m4a4-audio.json';
import sourceAKAudio from './source-ak47-audio.json';
import sourcePistolAudio from './source-pistol-audio.json';
import sourcePistolCommandAudio from './source-pistol-command-audio.json';
import sourceDeagleAudio from './source-deagle-audio.json';
import {loadSourceDeagleAudio} from './source-deagle-audio';
import {loadSourceAWPAudio} from './source-awp-audio';
import {loadSourceImpactAudio,type SourceImpactAudioOwner} from './source-impact-audio';
import {loadSourceExplosionAudio,type SourceExplosionAudioOwner,type SourceExplosionKind} from './source-explosion-audio';
import {sourceSha256} from './source-sha256';
const SOURCE_RIFLE_AUDIO=[...sourceAKAudio,...sourceM4Audio];
export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  volume = 0.45;
  noise: AudioBuffer | null = null;
  buffers = new Map<string, AudioBuffer>();
  raw = new Map<string, ArrayBuffer>();
  decoded = false;
  private preparing?:Promise<void>;
  private preparingPistols?:Promise<void>;
  private preparingPistolCommands?:Promise<void>;
  private preparingDeagle?:Promise<void>;
  private preparingAWP?:Promise<void>;
  private preparingImpacts?:Promise<void>;
  private preparingExplosions?:Promise<void>;
  private sourceAWPOwner?:Awaited<ReturnType<typeof loadSourceAWPAudio>>;
  private sourceImpactOwner?:SourceImpactAudioOwner;
  private sourceExplosionOwner?:SourceExplosionAudioOwner;
  disposed = false;
  sourceHashes=new Map<string,boolean>();
  sourceAKHashes=new Map<string,boolean>();
  sourcePistolHashes=new Map<string,boolean>();
  sourcePistolCommandHashes=new Map<string,boolean>();
  sourceDeagleHashes=new Map<string,boolean>();
  sourceAWPHashes=new Map<string,boolean>();
  sourceImpactHashes=new Map<string,boolean>();
  sourceExplosionHashes=new Map<string,boolean>();
  sourceEvents:{key:string;time:number;volume:number;playbackRate:number}[]=[];
  loading:Promise<unknown>;
  constructor(options:{legacySamples?:boolean}={}){this.loading = Promise.allSettled(
    [
      ...(options.legacySamples===false?[]:[
      'vandal',
      'spectre',
      'marshal',
      'sidearm',
      'step1',
      'step2',
      'step3',
      'step4',
      'step5',
      'step6',
      ]),
      ...SOURCE_RIFLE_AUDIO.map(s=>s.key),
    ].map(async (name) => {
      const original=SOURCE_RIFLE_AUDIO.find(s=>s.key===name);
      const response = await fetch(original?.url??`/audio/${name}.wav`,{cache:'no-cache'});
      if (!response.ok) throw new Error(`Audio ${name}: ${response.status}`);
      const data=await response.arrayBuffer();
      if(original){if(data.byteLength!==original.bytes||await sourceSha256(new Uint8Array(data))!==original.sha256)throw Error('Original rifle sound checksum differs');(name.startsWith('source_ak47_')?this.sourceAKHashes:this.sourceHashes).set(name,true);}
      if(!this.disposed)this.raw.set(name,data);
    }),
  ).catch(() => {
    /* Synthesized fallback keeps audio available if a download fails. */
  });}
  /** Decode before the ready menu becomes actionable. In particular the first
   * draw event at time zero must not race initial AudioContext decoding. */
  prepare(originalSource=false){
    return this.preparing??=(async()=>{
      await this.loading;if(this.disposed)return;
      if(originalSource&&(this.sourceHashes.size!==sourceM4Audio.length||this.sourceAKHashes.size!==sourceAKAudio.length))throw Error('Original rifle sounds are incomplete');
      if(typeof OfflineAudioContext==='undefined')return;
      const decoder=new OfflineAudioContext(1,1,44100);
      const settled=await Promise.allSettled([...this.raw].map(async([name,bytes])=>{
        try{const buffer=await decoder.decodeAudioData(bytes.slice(0));if(!this.disposed)this.buffers.set(name,buffer);}
        catch(error){if(originalSource&&name.startsWith('source_'))throw error;}
      }));
      const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
      if(!this.disposed){this.decoded=true;this.raw.clear();}
    })();
  }
  /** Explicit pistol preparation keeps unused sidearms out of rifle startup.
   * Shared original WAVs are decoded once; all event aliases retain their own
   * verified key. Await before offering the first pistol draw action. */
  preparePistols(){
    return this.preparingPistols??=this.preparePistolRecords([...sourcePistolAudio.weapons.glock.records,...sourcePistolAudio.weapons.usp.records],this.sourcePistolHashes);
  }
  preparePistolCommands(){return this.preparingPistolCommands??=this.preparePistolRecords(sourcePistolCommandAudio,this.sourcePistolCommandHashes);}
  /** Reuse the verified Deagle owner and shared sample destination. Await this
   * and preparePistolCommands before the first Deagle draw/empty command. */
  prepareDeagle(){return this.preparingDeagle??=loadSourceDeagleAudio(this).then(owner=>{
    if(this.disposed){owner.dispose();throw Error('Audio engine disposed');}
    for(const[key,verified]of Object.entries(owner.hashVerified))this.sourceDeagleHashes.set(key,verified);
  });}
  prepareAWP(){return this.preparingAWP??=loadSourceAWPAudio(this).then(owner=>{
    if(this.disposed){owner.dispose();throw Error('Audio engine disposed');}
    this.sourceAWPOwner=owner;for(const[key,verified]of Object.entries(owner.hashVerified))this.sourceAWPHashes.set(key,verified);
  });}
  sourceAWPEvent(event:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){return this.sourceAWPOwner?.event(event,volume,pan,position,occluded)??false;}
  /** The original bullet-impact waves. Loaded before the first shot can land so a
   * surface impact either plays an original wave or nothing at all. */
  prepareImpacts(){return this.preparingImpacts??=loadSourceImpactAudio(this).then(owner=>{
    if(this.disposed){owner.dispose();throw Error('Audio engine disposed');}
    this.sourceImpactOwner=owner;for(const[key,verified]of Object.entries(owner.hashVerified))this.sourceImpactHashes.set(key,verified);
  });}
  sourceImpactEvent(event:string,volume=.8,pan=0,position?:{x:number;y:number;z:number},occluded=false,draw?:number){
    return this.sourceImpactOwner?.event(event,volume,pan,position,occluded,draw)??false;
  }
  sourceImpactAudit(){return this.sourceImpactOwner?{hashVerified:this.sourceImpactOwner.hashVerified,
    records:this.sourceImpactOwner.records.length,played:this.sourceImpactOwner.played,
    history:this.sourceImpactOwner.history}:null;}
  prepareExplosions(){return this.preparingExplosions??=loadSourceExplosionAudio(this).then(owner=>{
    if(this.disposed){owner.dispose();throw Error('Audio engine disposed');}
    this.sourceExplosionOwner=owner;
    for(const[key,verified]of Object.entries(owner.hashVerified))this.sourceExplosionHashes.set(key,verified);
  });}
  sourceExplosionEvent(kind:SourceExplosionKind,position?:{x:number;y:number;z:number}){
    return this.sourceExplosionOwner?.event(kind,position)??false;
  }
  sourceExplosionAudit(){return this.sourceExplosionOwner?{
    hashVerified:this.sourceExplosionOwner.hashVerified,played:this.sourceExplosionOwner.played}:null;}
  sourceWeaponEvent(weapon:'glock'|'usp'|'deagle'|'awp',event:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){
    return weapon==='awp'?this.sourceAWPEvent(event,volume,pan,position,occluded):this.sourcePistolEvent(weapon,event,volume,pan,position,occluded);
  }
  private async preparePistolRecords(records:readonly{sha256:string;bytes:number;url:string;key:string}[],hashes:Map<string,boolean>){
      if(this.disposed)throw Error('Audio engine disposed');
      if(typeof OfflineAudioContext==='undefined')throw Error('Original pistol audio decoder unavailable');
      const decoder=new OfflineAudioContext(1,1,44100),decoded=new Map<string,Promise<AudioBuffer>>();
      const settled=await Promise.allSettled(records.map(async row=>{
        let pending=decoded.get(row.sha256);
        if(!pending){pending=(async()=>{const r=await fetch(row.url,{cache:'no-cache'});if(!r.ok)throw Error('Pistol audio HTTP '+r.status);
          const data=await r.arrayBuffer();if(data.byteLength!==row.bytes||await sourceSha256(new Uint8Array(data))!==row.sha256)throw Error('Original pistol sound checksum differs');
          return decoder.decodeAudioData(data);
        })();decoded.set(row.sha256,pending);}
        const buffer=await pending;if(!this.disposed){this.buffers.set(row.key,buffer);hashes.set(row.key,true);}
      }));
      const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
      if(this.disposed)throw Error('Audio engine disposed');
      if(hashes.size!==records.length)throw Error('Original pistol sounds are incomplete');
  }
  listener(x: number, y: number, z: number, yaw: number) {
    const listener = this.ctx?.listener;
    if (!listener) return;
    const values = [x, y, z, -Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0];
    const params = [
      listener.positionX,
      listener.positionY,
      listener.positionZ,
      listener.forwardX,
      listener.forwardY,
      listener.forwardZ,
      listener.upX,
      listener.upY,
      listener.upZ,
    ];
    if (params.every(Boolean))
      params.forEach((param, i) => {
        param.value = values[i];
      });
    else {
      // Compatibility fallback for browsers without AudioParam listener fields.
      // eslint-disable-next-line typescript/no-deprecated
      listener.setPosition(x, y, z);
      // eslint-disable-next-line typescript/no-deprecated
      listener.setOrientation(
        ...(values.slice(3) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ]),
      );
    }
  }
  sample(
    name: string,
    volume: number,
    pan = 0,
    position?: { x: number; y: number; z: number },
    occluded = false,
    playbackRate?:number,
  ) {
    const buffer = this.buffers.get(name),
      ctx = this.ctx;
    if (!buffer || !ctx || !this.master) return false;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate??(name.startsWith('source_')?1:0.985 + Math.random() * 0.03);
    if(name.startsWith('source_')){this.sourceEvents.push({key:name,time:ctx.currentTime,volume,playbackRate:source.playbackRate.value});if(this.sourceEvents.length>64)this.sourceEvents.shift();}
    gain.gain.value = volume * (occluded ? 0.42 : 1);
    filter.type = 'lowpass';
    filter.frequency.value = occluded ? 1400 : 19000;
    source.connect(filter);
    filter.connect(gain);
    let spatial: AudioNode;
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 7;
      panner.maxDistance = 120;
      panner.rolloffFactor = 1.4;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      spatial = panner;
    } else {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      spatial = panner;
    }
    gain.connect(spatial);
    spatial.connect(this.master);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      spatial.disconnect();
    };
    source.start();
    return true;
  }
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const compressor = this.ctx.createDynamicsCompressor();
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(
        1,
        this.ctx.sampleRate * 0.5,
        this.ctx.sampleRate,
      );
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    if (!this.decoded) {
      this.decoded = true;
      void this.loading.then(async () => {
        if (this.disposed || !this.ctx) return;
        for (const [name, bytes] of this.raw) {
          try {
            const buffer = await this.ctx.decodeAudioData(bytes.slice(0));
            if (!this.disposed) this.buffers.set(name, buffer);
          } catch {
            /* Missing sample uses synthesis. */
          }
        }
        this.raw.clear();
      });
    }
  }
  setVolume(n: number) {
    this.volume = n;
    if (this.master) this.master.gain.value = n;
  }
  tone(
    freq: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
    pan = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain(),
      p = this.ctx.createStereoPanner();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq * 0.35),
      t + duration,
    );
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    p.pan.value = pan;
    o.connect(g);
    g.connect(p);
    p.connect(this.master);
    o.start();
    o.stop(t + duration);
  }
  hiss(duration: number, volume: number, freq: number, pan = 0) {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime,
      src = this.ctx.createBufferSource(),
      filter = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain(),
      p = this.ctx.createStereoPanner();
    src.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    p.pan.value = pan;
    src.connect(filter);
    filter.connect(g);
    g.connect(p);
    p.connect(this.master);
    src.start();
    src.stop(t + duration);
  }
  /** For USP use the accepted bullet's mode: 1 attached, 0 detached. Omission
   * retains the default attached USP state and the old five-argument API.
   * Animation sounds remain owned by sourcePistolEvent's timeline caller. */
  shot(
    id: WeaponId|'deagle',
    volume = 1,
    pan = 0,
    position?: { x: number; y: number; z: number },
    occluded = false,
    sourcePistolMode: SourcePistolMode = 1,
  ) {
    if(id==='glock'){this.sourcePistolEvent('glock','weapon_glock.single',volume,pan,position,occluded);return;}
    if(id==='usp'){this.sourcePistolEvent('usp',sourcePistolMode===1?'weapon_usp.silencedshot':'weapon_usp.single',volume,pan,position,occluded);return;}
    if(id==='deagle'){this.sourcePistolEvent('deagle','weapon_deagle.single',volume,pan,position,occluded);return;}
    if(id==='awp'){this.sourceAWPEvent('weapon_awp.single',volume,pan,position,occluded);return;}
    if(id==='m4a4'&&this.sourceRifleEvent('weapon_m4a1.single',volume,pan,position,occluded))return;
    if(id==='vandal'&&this.sourceRifleEvent('weapon_ak47.single',volume,pan,position,occluded))return;
    if (this.sample(id==='vandal'?'source_ak47_shot':id, volume, pan, position, occluded)) return;
    const heavy = id === 'marshal';
    this.hiss(heavy ? 0.3 : 0.14, 0.48 * volume, heavy ? 2400 : 4600, pan);
    this.tone(heavy ? 110 : 155, 0.17, 0.4 * volume, 'triangle', pan);
    this.tone(900, 0.025, 0.09 * volume, 'square', pan);
  }
  stepCounter = 0;
  step(volume = 0.17, pan = 0) {
    if (this.sample(`step${(++this.stepCounter % 6) + 1}`, volume * 2.3, pan))
      return;
    this.hiss(0.07, volume, 950, pan);
    this.tone(85, 0.045, volume * 0.35, 'sine', pan);
  }
  hit(head = false) {
    this.tone(head ? 1200 : 800, 0.075, 0.12, 'sine');
    this.tone(head ? 1600 : 1100, 0.04, 0.09, 'triangle');
  }
  reload() {
    this.hiss(0.08, 0.15, 3800);
    this.tone(700, 0.04, 0.06, 'square');
  }
  reloadStage(point: number) {
    this.hiss(
      point < 0.5 ? 0.1 : 0.065,
      point > 0.8 ? 0.1 : 0.17,
      point < 0.5 ? 2100 : 4800,
    );
    this.tone(point > 0.8 ? 1050 : 480, 0.055, 0.065, 'triangle');
  }
  sourceM4Event(event:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){
    return this.sourceRifleEvent(event,volume,pan,position,occluded);
  }
  sourceRifleEvent(event:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){
    const choices=SOURCE_RIFLE_AUDIO.filter(s=>s.event===event.toLowerCase());
    if(!choices.length)return false;
    const chosen=choices[Math.floor(Math.random()*choices.length)];
    const pitch=chosen.pitch[0]+Math.random()*(chosen.pitch[1]-chosen.pitch[0]);
    const gain=chosen.volume[0]+Math.random()*(chosen.volume[1]-chosen.volume[0]);
    return this.sample(chosen.key,volume*gain,pan,position,occluded,pitch/100);
  }
  sourcePistolEvent(weapon:'glock'|'usp'|'deagle',event:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){
    const records=weapon==='deagle'?sourceDeagleAudio.weapons.deagle.records:sourcePistolAudio.weapons[weapon].records;
    const choices=[...records,...sourcePistolCommandAudio].filter(s=>s.event===event.toLowerCase());
    if(!choices.length)return false;
    const chosen=choices[Math.floor(Math.random()*choices.length)];
    const pitch=chosen.pitch[0]+Math.random()*(chosen.pitch[1]-chosen.pitch[0]);
    const gain=chosen.volume[0]+Math.random()*(chosen.volume[1]-chosen.volume[0]);
    return this.sample(chosen.key,volume*gain,pan,position,occluded,pitch/100);
  }
  beep() {
    this.tone(1050, 0.06, 0.07);
  }
  round() {
    this.tone(480, 0.2, 0.1);
    setTimeout(() => this.tone(720, 0.2, 0.09), 140);
  }
  explosion() {
    this.hiss(0.48, 0.5, 1000);
    this.tone(75, 0.5, 0.5, 'triangle');
  }
  dispose() {
    this.disposed = true;
    this.sourceExplosionOwner?.dispose();
    this.buffers.clear();
    this.raw.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
