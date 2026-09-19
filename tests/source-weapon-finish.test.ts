import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { validSourceWeaponFinish, sourceWeaponFinishKey } from "../game/source-weapon-finish";
import {SOURCE_FINISHES,SOURCE_FINISH_WEAPONS} from "../game/source-finish-table";
import { sourceRedlineSkinParameters } from "../game/source-redline-seed";
import { Simulation, initPhysics } from "../game/simulation";
import { sourceSimulationFixture } from "./fixtures/source-simulation-fixture";

// No DOM, GPU, socket or server is started: exercise the real public setter with
// explicit presentation/transport sinks, independently from its constructor.
vi.mock("../game/scene", () => ({ Art: class {} }));
vi.mock("../game/audio", () => ({ AudioEngine: class {} }));
import { Game } from "../game/runtime";

const selection = () => ({ weapon: "vandal" as const, paintKitId: 282 as const, seed: 422, wear: .4 });
beforeAll(initPhysics);
const simulations: Simulation[] = [];
afterEach(() => { simulations.splice(0).forEach((simulation) => simulation.dispose()); });
function simulation() {
  const s = new Simulation("training", false, sourceSimulationFixture());
  simulations.push(s); return s;
}
function runtime(s: Simulation, canSend = true, source = true) {
  return {
    sourceWeaponFinish: validSourceWeaponFinish(selection()), sim: s, you: "local",
    sourceScenario: source ? sourceSimulationFixture() : undefined,
    art: { setSourceWeaponFinish: vi.fn() }, room: { send: vi.fn() },
    canSendRoomState: () => canSend, notify: vi.fn(),
  };
}
function set(g: ReturnType<typeof runtime>, value: unknown) {
  Game.prototype.setSourceWeaponFinish.call(g as unknown as Game, value);
}

describe("Source finish wire input and native parameter handoff", () => {
  it("keeps all 238 original finish endpoints valid through runtime, renderer and JSON wire checks", () => {
    let finishes=0,lowerRoundingCases=0,upperRoundingCases=0;
    for(const weapon of SOURCE_FINISH_WEAPONS)for(const finish of SOURCE_FINISHES[weapon.id]){
      finishes++;
      if(Math.fround(finish.wearMinimum)<finish.wearMinimum)lowerRoundingCases++;
      if(Math.fround(finish.wearMaximum)>finish.wearMaximum)upperRoundingCases++;
      for(const wear of [finish.wearMinimum,finish.wearMaximum,(finish.wearMinimum+finish.wearMaximum)/2]){
        const packet={weapon:weapon.id,paintKitId:finish.paintKitId,seed:422,wear};
        const runtime=validSourceWeaponFinish(packet);
        expect(runtime,`${weapon.id}:${finish.paintKitId} wear=${wear}`).not.toBeNull();
        const renderer=validSourceWeaponFinish(runtime),server=validSourceWeaponFinish(JSON.parse(JSON.stringify(runtime)));
        expect(renderer).toEqual(runtime);expect(server).toEqual(runtime);
        expect(sourceWeaponFinishKey(renderer)).toBe(sourceWeaponFinishKey(runtime));
        expect(runtime!.wear).toBe(Math.fround(wear));
      }
    }
    expect(finishes).toBe(238);expect(lowerRoundingCases).toBe(42);expect(upperRoundingCases).toBe(93);
  });
  it("rejects the adjacent representable float32 outside every original wear window",()=>{
    const adjacent=(value:number,direction:1|-1)=>{
      if(value===0)return direction*2**-149;
      const bytes=new ArrayBuffer(4),view=new DataView(bytes);view.setFloat32(0,value);
      view.setUint32(0,view.getUint32(0)+direction);return view.getFloat32(0);
    };
    for(const weapon of SOURCE_FINISH_WEAPONS)for(const finish of SOURCE_FINISHES[weapon.id])
      for(const wear of [adjacent(finish.wearMinimum,-1),adjacent(finish.wearMaximum,1),finish.wearMinimum-.001,finish.wearMaximum+.001,Number.MAX_VALUE,-Number.MAX_VALUE])
        expect(validSourceWeaponFinish({weapon:weapon.id,paintKitId:finish.paintKitId,seed:422,wear}),`${weapon.id}:${finish.paintKitId} outside ${wear}`).toBeNull();
    // Distinct JS numbers that denote the same original float32 endpoint are
    // intentionally the same inventory value, not materially out-of-range.
    for(const wear of [.099999999,.700000001])expect(validSourceWeaponFinish({...selection(),wear})).not.toBeNull();
  });

  it("round-trips boundary and near-boundary wears into stable native parameters", () => {
    const wears = [.1, .100000001, .123456789, .39999999, .4, .40000001, .69999999, .7];
    for (const seed of [0, 1, 422, 1000]) for (const wear of wears) {
      const accepted = validSourceWeaponFinish({ ...selection(), seed, wear });
      expect(accepted, `seed=${seed}, wear=${wear}`).not.toBeNull();
      const wire = JSON.parse(JSON.stringify(accepted));
      const decoded = validSourceWeaponFinish(wire);
      expect(decoded).toEqual(accepted);
      expect(decoded).not.toBe(accepted);
      expect(sourceWeaponFinishKey(decoded)).toBe(sourceWeaponFinishKey(accepted));
      const original = sourceRedlineSkinParameters(accepted!);
      expect(sourceRedlineSkinParameters(decoded!)).toEqual(original);
      expect(original.sourceInput.seed).toBe(seed);
      // Inventory wear is passed through to original six-digit material parsing;
      // a second .1 + .6 * wear remap would violate both endpoint observations.
      if (wear === .1 || wear === .7) expect(original.wear).toBe(Math.fround(wear));
    }
  });

  it("rejects malformed packets without coercion or accepting unsupported kits/weapons", () => {
    const bad: unknown[] = [null, undefined, false, 282, "default", [], {},
      { ...selection(), seed: "422" }, { ...selection(), seed: -1 },
      { ...selection(), seed: 1001 }, { ...selection(), seed: 1.5 },
      { ...selection(), seed: NaN }, { ...selection(), seed: Infinity },
      { ...selection(), wear: "0.4" }, { ...selection(), wear: NaN },
      { ...selection(), wear: Infinity }, { ...selection(), wear: -.1 },
      { ...selection(), wear: .0999999 }, { ...selection(), wear: .7000001 },
      { ...selection(), paintKitId: "282" }, { ...selection(), paintKitId: 283 },
      { ...selection(), weapon: "m4a4" }, { ...selection(), weapon: "ak47" }];
    for (const value of bad) expect(validSourceWeaponFinish(value)).toBeNull();
  });

  it("owns a minimal packet copy and drops spoofed player/combat and nested data", () => {
    const packet = { ...selection(), playerId: "someone-else", hp: 999,
      primary: "m4a4", parameters: { pattern: [[1, 0, 0, 999]] } };
    const result = validSourceWeaponFinish(packet)!;
    expect(Object.keys(result).sort()).toEqual(["paintKitId", "seed", "weapon", "wear"]);
    packet.seed = 1000; packet.wear = .7; packet.parameters.pattern[0][3] = 0;
    expect(result).toEqual({ ...selection(), wear: Math.fround(.4) });
    result.seed = 0;
    expect(packet.seed).toBe(1000);
  });

  it("cache keys preserve effective float32 identity without conflating other selections", () => {
    expect(sourceWeaponFinishKey(validSourceWeaponFinish({ ...selection(), wear: .4 })))
      .toBe(sourceWeaponFinishKey(validSourceWeaponFinish({ ...selection(), wear: .400000001 })));
    const keys = [null, selection(), { ...selection(), seed: 1000 }, { ...selection(), wear: .7 }]
      .map((value) => sourceWeaponFinishKey(validSourceWeaponFinish(value)));
    expect(new Set(keys).size).toBe(4);
    expect(sourceWeaponFinishKey(undefined)).toBe(sourceWeaponFinishKey(null));
  });
});

describe("Source finish simulation ownership", () => {
  it("isolates authority, successive snapshots, and different players' finish objects", () => {
    const s = simulation(), a = s.addPlayer("local", "A", "amber"), b = s.addPlayer("remote", "B", "blue");
    a.sourceWeaponFinish = validSourceWeaponFinish(selection())!;
    b.sourceWeaponFinish = validSourceWeaponFinish(selection())!;
    const first = s.snapshot(), second = s.snapshot();
    const fa = first.players.find((p) => p.id === a.id)!.sourceWeaponFinish!;
    const fb = first.players.find((p) => p.id === b.id)!.sourceWeaponFinish!;
    const sa = second.players.find((p) => p.id === a.id)!.sourceWeaponFinish!;
    expect(fa).not.toBe(a.sourceWeaponFinish); expect(fa).not.toBe(sa); expect(fa).not.toBe(fb);
    fa.seed = 1000; fa.wear = .7;
    expect(a.sourceWeaponFinish.seed).toBe(422); expect(sa.seed).toBe(422); expect(fb.seed).toBe(422);
    a.sourceWeaponFinish.seed = 0;
    expect(sa.seed).toBe(422);
    delete a.sourceWeaponFinish;
    const cleared = s.snapshot().players.find((p) => p.id === a.id)!;
    expect(cleared).not.toHaveProperty("sourceWeaponFinish");
    expect(sa.seed).toBe(422);
  });

  it("preserves the cosmetic preference through a normal respawn without changing combat fields", () => {
    const s = simulation(), p = s.addPlayer("local", "A", "amber");
    p.sourceWeaponFinish = validSourceWeaponFinish(selection())!;
    s.spawn(p);
    expect(s.snapshot().players[0].sourceWeaponFinish).toEqual(validSourceWeaponFinish(selection()));
    expect(p).toMatchObject({ hp: 100, alive: true, weapon: "vandal" });
  });
});

describe("Source finish public runtime setter", () => {
  it("updates only the local player's owned copy and sends the validated selection", () => {
    const s = simulation(), local = s.addPlayer("local", "A", "amber"), remote = s.addPlayer("remote", "B", "blue");
    const g = runtime(s), packet = { ...selection(), seed: 1000, hp: 999 };
    const before = { hp: local.hp, weapon: local.weapon, ammo: local.ammo };
    set(g, packet);
    expect(local.sourceWeaponFinish).toEqual(g.sourceWeaponFinish);
    expect(local.sourceWeaponFinish).not.toBe(g.sourceWeaponFinish);
    expect(remote).not.toHaveProperty("sourceWeaponFinish");
    expect(local).toMatchObject(before);
    expect(g.room.send).toHaveBeenCalledExactlyOnceWith("sourceFinish", validSourceWeaponFinish(packet));
    expect(g.art.setSourceWeaponFinish).toHaveBeenCalledExactlyOnceWith(g.sourceWeaponFinish);
    packet.seed = 0;
    expect(local.sourceWeaponFinish!.seed).toBe(1000);
    expect(g.sourceWeaponFinish!.seed).toBe(1000);
  });

  it("clears explicitly with null and does not send from an unsynchronized or non-Source session", () => {
    for (const [canSend, source] of [[false, true], [true, false]]) {
      const s = simulation(), p = s.addPlayer("local", "A", "amber"), g = runtime(s, canSend, source);
      p.sourceWeaponFinish = validSourceWeaponFinish(selection())!;
      set(g, null);
      expect(g.sourceWeaponFinish).toBeNull(); expect(p).not.toHaveProperty("sourceWeaponFinish");
      expect(g.room.send).not.toHaveBeenCalled();
      expect(g.art.setSourceWeaponFinish).toHaveBeenCalledExactlyOnceWith(null);
    }
  });

  it("invalid edits preserve the selected finish instead of silently sending a default reset", () => {
    const s = simulation(), p = s.addPlayer("local", "A", "amber"), g = runtime(s);
    p.sourceWeaponFinish = validSourceWeaponFinish(selection())!;
    const before = { ...g.sourceWeaponFinish! };
    for (const value of [undefined, "", { ...selection(), wear: NaN }, { ...selection(), seed: 1001 }]) set(g, value);
    expect(g.sourceWeaponFinish).toEqual(before);
    expect(p.sourceWeaponFinish).toEqual(before);
    expect(g.room.send).not.toHaveBeenCalled(); expect(g.art.setSourceWeaponFinish).not.toHaveBeenCalled();
  });
});
