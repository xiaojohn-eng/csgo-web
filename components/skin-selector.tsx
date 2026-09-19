"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ScanEye, Search, X } from "lucide-react";
import { SKINS, validSkinId, type SkinId } from "@/game/skins";
import type { WeaponId } from "@/game/types";
import type {SourceWeaponFinish} from '@/game/source-weapon-finish';
import {sourceFinishWearWindow} from '@/game/source-weapon-finish';
import {SOURCE_FINISHES,SOURCE_FINISH_WEAPONS} from '@/game/source-finish-table';
import "./skin-selector.css";

export type SkinSelectorProps = {
  weapon: string;
  weaponId: WeaponId;
  selected: SkinId;
  onSelect: (id: SkinId) => void;
  onInspect: () => void;
  sourceFinish?:SourceWeaponFinish|null;
  onSourceFinish?:(value:SourceWeaponFinish|null)=>void;
  sourceFinishStatus?:'default'|'loading'|'ready'|'error';
};

const RARITY_COLORS: Record<string, string> = {
  工业级: "#91b5c4",
  军规级: "#6f93ee",
  受限: "#ad89e8",
  保密: "#d87bcd",
  隐秘: "#ef8b82",
};

type DisplayFinish = {id:string;name:string;subtitle:string;color:string;accent:string;rarity:string;pattern:number};
const SOURCE_DEFAULT: DisplayFinish = {id:'default',name:'原版默认',subtitle:'DEFAULT',color:'#34383b',accent:'#92502f',rarity:'默认',pattern:0};
/** The generated table's own entry shape, for the one field of it the menu reads. */
type SourceFinishEntry = {readonly paintKitId:number;readonly chineseName:string;readonly englishName:string;readonly rarityChineseLabel:string};
const SOURCE_FINISHES_BY_WEAPON: Record<string,readonly SourceFinishEntry[]> = SOURCE_FINISHES;
const FINISH_WEAPON_IDS: readonly string[] = SOURCE_FINISH_WEAPONS.map(entry=>entry.id);
/** Original finish names and rarity tiers, scoped to the weapon in hand. */
function sourceFinishEntries(weapon:string,title:string):readonly DisplayFinish[]{
  const entries=SOURCE_FINISHES_BY_WEAPON[weapon];
  if(!entries)return [];
  return entries.map(finish=>({id:String(finish.paintKitId),name:finish.chineseName,
    subtitle:`${title} / ${finish.englishName}`,color:'#1d2124',accent:'#8d949a',
    rarity:finish.rarityChineseLabel,pattern:0}));
}

function SourceFinishPreview({ skin, weaponId, weapon }: { skin: DisplayFinish; weaponId: string; weapon: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <span className="skin-selector__preview" data-status={status}>
      {status !== 'error' && <img
        className="skin-selector__preview-image"
        src={`/source/csgo-12426148/skin-previews-20260913/${weaponId}/${skin.id}.png`}
        alt={`${weapon} · ${skin.name} 库存预览`}
        width="360"
        height="270"
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />}
      {status !== 'ready' && <span className="skin-selector__preview-status">
        {status === 'error' ? '展示图片暂不可用' : '图片加载中'}
      </span>}
    </span>
  );
}

function FinishSwatch({ skin, weapon }: { skin: DisplayFinish; weapon: string }) {
  const id = `finish-${useId().replace(/:/g, "")}`;
  const pistol = /p12|pistol|手枪|sidearm/i.test(weapon);
  return (
    <svg viewBox="0 0 180 72" className="skin-selector__swatch" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={skin.color} />
          <stop offset="1" stopColor={skin.accent} />
        </linearGradient>
        <pattern
          id={id}
          width={skin.pattern === 5 ? 14 : 20}
          height="20"
          patternUnits="userSpaceOnUse"
          patternTransform={skin.pattern === 4 ? "rotate(35)" : undefined}
        >
          <rect width="20" height="20" fill={skin.color} />
          {skin.pattern === 0 && (
            <path d="M0 1H20 M0 11H20" stroke={skin.accent} strokeOpacity=".18" strokeWidth="1" />
          )}
          {skin.pattern === 1 && <path d="M1 0V20" stroke={skin.accent} strokeWidth="2" />}
          {skin.pattern === 2 && (
            <path d="M0 0H9V5H14V11H6V16H0Z M15 14H20V20H11V17H15Z" fill={skin.accent} />
          )}
          {skin.pattern === 4 && <rect width="8" height="20" fill={skin.accent} />}
          {skin.pattern === 5 && (
            <path
              d="M7 0Q14 5 7 10Q0 15 7 20 M0 10Q7 5 14 10"
              fill="none"
              stroke={skin.accent}
              strokeWidth="1.5"
            />
          )}
        </pattern>
      </defs>
      <g
        fill={skin.pattern === 3 ? `url(#${id}-fade)` : `url(#${id})`}
        stroke="#c5d5df"
        strokeOpacity=".22"
        strokeWidth=".7"
        strokeLinejoin="round"
      >
        {pistol ? (
          <>
            <path d="M44 21H131L135 27V37H78L71 58H48L54 38H43Z" />
            <path d="M70 37H97L92 49H75" fill="none" strokeWidth="3" />
          </>
        ) : (
          <>
            <path d="M14 27L44 31V23H104L109 25H136V32H159V37H137V41H99L95 48H83L78 59H67L70 42H44L26 50H14Z" />
            <path d="M92 42L104 43L112 60H96Z" />
            <path d="M67 23V17H91V23 M139 31V21H144V32" />
          </>
        )}
      </g>
      <path
        d={pistol ? "M48 26H129" : "M49 28H130"}
        stroke={skin.accent}
        strokeWidth="1.5"
        opacity=".85"
      />
    </svg>
  );
}

export function SkinSelector({ weapon, weaponId, selected, onSelect, onInspect,sourceFinish,onSourceFinish,sourceFinishStatus }: SkinSelectorProps) {
  const root = useRef<HTMLElement>(null);
  const collection = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const searchId = useId();
  const collectionId = useId();
  const [search, setSearch] = useState('');
  const sourceAK = weaponId === 'vandal'||weaponId==='m4a4'||weaponId==='glock'||weaponId==='usp'||weaponId==='deagle'||weaponId==='awp';
  // A finish belongs to one weapon, so the menu lists the finishes of the weapon in hand
  // and reads the selection only when the selection is that weapon's.
  const finishWeapon = FINISH_WEAPON_IDS.includes(weaponId) ? weaponId : null;
  const originalFinish=!!finishWeapon&&sourceFinish!==undefined&&!!onSourceFinish;
  const scopedFinish = originalFinish&&sourceFinish?.weapon===finishWeapon ? sourceFinish : null;
  const factory={...SOURCE_DEFAULT,subtitle:weapon+' / DEFAULT'};
  const finishes: readonly DisplayFinish[] = originalFinish?[factory,...sourceFinishEntries(finishWeapon,weapon)]:sourceAK?[factory]:SKINS;
  const query = originalFinish ? search.trim().toLocaleLowerCase() : '';
  const visibleFinishes = query ? finishes.filter(skin => `${skin.name} ${skin.subtitle}`.toLocaleLowerCase().includes(query)) : finishes;
  const equippedId = originalFinish&&scopedFinish?String(scopedFinish.paintKitId):sourceAK ? 'default' : selected;
  const equipped = finishes.find((skin) => skin.id === equippedId);
  const wearWindow = scopedFinish?sourceFinishWearWindow(scopedFinish.weapon,scopedFinish.paintKitId):null;
  /** Selecting a finish keeps the current pattern seed, and brings the wear inside the
   * new finish's own original window when it does not already sit there. */
  const sourceFinishFor = (id:string):SourceWeaponFinish => {
    const paintKitId = Number(id), window = sourceFinishWearWindow(finishWeapon,paintKitId);
    if(!window||!finishWeapon) throw Error(`No original ${finishWeapon??weapon} finish ${id} is staged`);
    const seed = scopedFinish?.seed ?? 422, wear = scopedFinish?.wear ?? window.wearMinimum;
    return {weapon:finishWeapon as SourceWeaponFinish['weapon'],paintKitId,seed,
      wear:Math.min(Math.max(wear,window.wearMinimum),window.wearMaximum)};
  };

  useEffect(() => setSearch(''), [weaponId]);
  useEffect(() => { collection.current?.scrollTo({ top: 0 }); }, [weaponId, query]);

  useEffect(() => {
    const inspect = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.code !== "KeyF" ||
        event.repeat ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector('[role="dialog"]') ||
        document.pointerLockElement ||
        !root.current?.getClientRects().length
      )
        return;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="slider"]'))
      )
        return;
      event.preventDefault();
      onInspect();
    };
    window.addEventListener("keydown", inspect);
    return () => window.removeEventListener("keydown", inspect);
  }, [onInspect]);

  return (
    <section ref={root} className={`skin-selector${sourceAK ? ' skin-selector--source' : ''}`} aria-labelledby={titleId}>
      <header className="skin-selector__header">
        <div>
          <p className="skin-selector__eyebrow">
            FINISH COLLECTION <span>{String(finishes.length).padStart(2, "0")}</span>
          </p>
          <h3 id={titleId}>
            武器涂装 <span>{weapon}</span>
          </h3>
        </div>
        <span className="skin-selector__available">{originalFinish?'原版涂装':sourceAK ? '原版默认已接入' : '全部可装备'}</span>
      </header>
      {originalFinish && <div className="skin-selector__collection-tools">
        <div className="skin-selector__search">
          <Search size={14} aria-hidden="true" />
          <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="搜索皮肤中文 / 英文名" aria-label="搜索皮肤中文或英文名" aria-controls={collectionId} />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="清空皮肤搜索"><X size={13} /></button>}
        </div>
        <span className="skin-selector__result-count" role="status" aria-live="polite">{visibleFinishes.length} / {finishes.length}</span>
      </div>}
      {sourceAK && <p className="skin-selector__preview-note">库存预览，具体图案与磨损以右侧检视为准</p>}
      <div ref={collection} id={collectionId} className="skin-selector__grid" role="group" aria-label={`${weapon} 皮肤选择`}>
        {visibleFinishes.map((skin) => {
          const active = equippedId === skin.id;
          const style = {
            "--finish-color": skin.color,
            "--finish-accent": skin.accent,
            "--finish-rarity": RARITY_COLORS[skin.rarity] ?? "#91b5c4",
          } as CSSProperties;
          return (
            <button
              type="button"
              key={skin.id}
              className="skin-selector__card"
              style={style}
              aria-pressed={active}
              aria-label={`${skin.name}，${skin.rarity}${active ? "，已装备" : "，点击装备"}`}
              onClick={() => originalFinish?onSourceFinish?.(skin.id==='default'?null:sourceFinishFor(skin.id))// The invented placeholder list is the only branch left here, so its id is
          // normalised back into the skin catalogue's own domain.
          :onSelect(validSkinId(skin.id))}
            >
              <span className="skin-selector__rarity">{skin.rarity}</span>
              <span className="skin-selector__check">
                {active && <Check size={12} strokeWidth={2.5} />}
              </span>
              {sourceAK
                ? <SourceFinishPreview key={`${weaponId}/${skin.id}`} skin={skin} weaponId={weaponId} weapon={weapon} />
                : <FinishSwatch skin={skin} weapon={weapon} />}
              <span className="skin-selector__name">{skin.name}</span>
              <span className="skin-selector__subtitle" title={skin.subtitle}>{skin.subtitle}</span>
            </button>
          );
        })}
        {!visibleFinishes.length && <div className="skin-selector__empty">
          <p>没有找到匹配的皮肤</p>
          <button type="button" onClick={() => setSearch('')}>清空搜索，查看全部</button>
        </div>}
      </div>
      {originalFinish&&scopedFinish&&<div className="skin-selector__parameters">
        <label>图案编号<input aria-label="涂装图案编号" type="number" min="0" max="1000" step="1" value={scopedFinish.seed}
          onChange={e=>{const seed=Number(e.target.value);if(Number.isInteger(seed)&&seed>=0&&seed<=1000)onSourceFinish?.({...scopedFinish,seed});}}/></label>
        {/* The wear range is the selected finish's own original window, so the control
            cannot ask for a wear the original never presents for it. */}
        <label>磨损 <output>{scopedFinish.wear.toFixed(3)}</output><input aria-label="涂装磨损" type="range"
          min={wearWindow?.wearMinimum??0} max={wearWindow?.wearMaximum??1} step="0.001" value={scopedFinish.wear}
          onChange={e=>onSourceFinish?.({...scopedFinish,wear:Number(e.target.value)})}/></label>
      </div>}
      <footer className="skin-selector__footer">
        <div className="skin-selector__equipped" role="status" aria-live="polite">
          <Check size={15} />
          <span>
            {originalFinish&&scopedFinish&&sourceFinishStatus!=='ready'?sourceFinishStatus==='error'?'涂装加载失败，重新选择后重试':'正在加载涂装…':<>已装备 <strong>{equipped?.name ?? "原厂涂装"}</strong></>}
          </span>
        </div>
        <button
          type="button"
          className="skin-selector__inspect"
          onClick={onInspect}
          aria-keyshortcuts="F"
        >
          <ScanEye size={15} /> 检视武器 <kbd>F</kbd>
        </button>
      </footer>
    </section>
  );
}

export default SkinSelector;
