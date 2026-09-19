# 原 Glock18 / USP-S handling 独立切片

`game/source-pistol-handling.ts` 已完成普通 Glock 单发/三连发子弹，以及 USP-S 两个消音器有效模式的纯数值状态。版本为 `csgo-pistol-handling-12426148-r1`。本轮四套专项 **17/17 通过**，全项目 `tsc --noEmit` 退出 0；没有构建、启动服务或操作浏览器。是否可玩、网络接入和声画验收由主任务另行验证。

这里的原生 oracle 在隔离 Unicorn 中执行本机官方 App740 build **12426148** 的 i386 原指令。不是把 TypeScript 数学公式复制成 Python 来生成期望值。

| 原文件 | SHA256 |
| --- | --- |
| `csgo/bin/server.so` | `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386` |
| `bin/libvstdlib.so` | `bed32bd6bc26d6808b3e003fdf57066e0df884f2b264255450bdc75f64b314af` |
| `csgo/scripts/items/items_game.txt` | `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623` |

## 原消费者与模式

实际 `CWeaponGlock` vtable `0x12ec7ac`、`CWeaponUSP` vtable `0x12f6d5c` 的 `+0x738/+0x73c` 指向 `0xd3ff60/0xd42060`，`+0x4fc` 指向 `0xd4b7e0`。因此读取默认 item 属性后，仍执行原 getter、UpdateAccuracy、RecoveryTime、ApplyRecoil 和状态 stores 验证；不以字段存在代替消费者验证。

| 消费者 | 本构建地址 | 本轮执行范围 |
| --- | --- | --- |
| inaccuracy / spread / recovery | `d3ff60 / d3ed90 / d41e70` | 原函数，当前模式、状态、原默认 ConVars |
| UpdateAccuracyPenalty | `d42060` | 原函数，站/蹲/步行/跑动/air/reloading |
| 半自动 recoil 表 | `ca2199..ca23d0` | 原 RNG、两个模式各 64 项，full-auto 属性为 0 |
| ApplyRecoil / table lookup | `d42490 / ca30e0` | 原函数，正常 command seed 分支 |
| accepted primary 数值状态 | `d4b56f..d4b614` | fire penalty、完整 ApplyRecoil、index stores |
| queued Glock 数值状态 | `d49e0a..d49ecd` | 当前模式 penalty、硬 mode1 recoil、index stores |
| primary notification 时间 | `d43a43..d43a6f` | 原 `lastShot` store，和是否接受子弹分开 |
| accepted Reload 增量 | `d4cb7f..d4cbb4` | recoilIndex +1；不制造射击副作用 |
| deployment 数值分支 | `d44ec0..d44e50` | 原默认 reset-off 的恢复/index 分支 |
| weapon.OnLand | `d40580` | 原函数、SharedRandomFloat CRC32 和原 vstdlib RNG |
| normal bullet spread | `cb539f..cb53ae`、`cb5a30..cb57ed` | 每发重设 RNG，真实 R8/Negev 排除比较及 offset SSE |

属性继承从原 `weapon_glock_prefab` / `weapon_usp_silencer_prefab` 递归合并。`secondary.attributes` 有多个同名 block，必须依原顺序全部合并，不能把 parser 返回的列表当空对象。

下表是原 item 数值；所有 `spread` / `inaccuracy ...` 由原消费者按 float32 × float32(0.001) 转成运行值，公开 profile 已做该转换。

| 参数 | Glock 0 | Glock 1 | USP 0：拆除 | USP 1：安装 |
| --- | ---: | ---: | ---: | ---: |
| max player speed，Source units/s | 240 | 240 | 240 | 240 |
| spread | 2 | 15 | 2.5 | 1.5 |
| inaccuracy crouch | 4.2 | 3 | 3.68 | 3.68 |
| inaccuracy stand | 5.6 | 5.6 | 4.9 | 4.9 |
| inaccuracy fire | 56 | 45 | 71 | 52 |
| inaccuracy move | 10 | 12.95 | 13.87 | 13.87 |
| inaccuracy jump | 87.870003 | 87.870003 | 94.480003 | 94.480003 |
| inaccuracy jump initial | 96.620003 | 96.620003 | 96.599998 | 96.599998 |
| inaccuracy ladder | 137 | 119.25 | 138.320007 | 119.9 |
| inaccuracy land | .185 | .185 | .191 | .198 |
| inaccuracy reload | 0 | 0 | 0 | 0 |
| recoil angle variance，degrees | 20 | 20 | 0 | 0 |
| recoil magnitude | 18 | 30 | 29 | 23 |
| recoil magnitude variance | 0 | 5 | 0 | 0 |

Glock 的 recoil seed 为 4484，crouch/stand recovery 从 .2 到 .33，index 转换区间为 **0→5**。USP recoil seed 5426，crouch recovery .291277、stand .349532，final 与对应起始相同，转换区间 0→0。原 recoilIndex 停火衰减比较读取 normal `cycletime`：Glock .15、USP .17；不能把 raw alt cycletime 自动放进这个数学比较，也不能据此替代 command 的真实开火时钟。

USP 的 `m_bSilencerOn` 原 network registration `d3fb95..d3fba6` 指向 **weapon+aa5**。完成安装事件 `d45ec1..d45ef4` 设置 aa5=true、mode=1；完成拆除事件 `d45861..d4587c` 设置 aa5=false、mode=0，8 项原指令案例均通过。模块只消费完成后的有效模式，不假设按下 secondary 后立即变化。

纠正早期字段猜测：info+23d 在实际 parser 是 **`is revolver`**；`has silencer` 使用独立属性 getter。不能把 `d4d680..d4d6db` 的 +23d 分支用作 USP 初始模式证据。factory 要求 caller 显式提供已确认模式；本切片不裁定 USP deploy 初态、切换接受或动画完成时钟。

## 两套种子与半自动后坐

原 `ApplyRecoil d42490` 在 `d424e0` 先读取 **正常 prediction command seed global `0x16d2424`**。只有 full-auto 才在 `d42560` 用截断后的 recoilIndex 覆盖查表参数。Glock/USP 的 full-auto 属性为 0，最终索引为 `mode*64 + (commandSeed & 63)`，不能照用 rifle 的“第几发决定后坐”。原半自动表也跳过 rifle 的邻项平滑和首发抑制；即使 variance=0，生成该项仍消耗 RNG。

authority bullet seed 来自已验证的服务器 SHA1 链，存在 **global `0x16d2420`**。`600360` 从当前 command+40/+44 安装两套 seed，离开 command 后清成 -1。primary `d4b494` 和 queued `d49c0e` 都读同一个 server global 的低 8 位；每次 `FX_FireBullets` 再独立 `RandomSeed(seedByte+1)`。本轮补了 8 组原 scope/primary/queue/clear 指令回读。

因此：

- authority 每条命令提供一个 `serverSeed`，该命令中被接受的 bullet 事件原样使用它。不能按弹匣差、queued schedule 或逐弹 supplier 另造 seed。
- `commandSeed` 是当前合法命令的正常 MD5 prediction seed，供半自动 recoil 和 SharedLand 使用；不要沿用排队首发旧命令的 seed。
- 客户端能由合法 seq 得到 commandSeed，并预测 accepted state；没有 serverSeed 时只用 `AfterAcceptedBullet`，不生成随机射线或声称预测命中。
- shot 从 **BEFORE** accuracy/punch 状态取值，再推进一次 after-shot state。即使 seed 字节相同，不同发的 penalty、punch 也可能不同。
- 原本将“queued 后仍走 primary gate”简述为“同帧还能发 primary”是不准确的。当前正常状态中 queued 先增加 Player shotsFired，后续 primary gate 被锁存拒绝；1241 帧 corpus 中 196 帧 queued→tick、0 帧 queued 后 accepted primary。不要合成额外补射。

## 最小 API 与时序

状态完整保存 `version / activeWeapon / modes / weapons / punch`。每枪 accuracy 包含 `penalty / recoilIndex / lastShotTime / lastUpdateTime`；punch 是玩家的 `angle / velocity / viewPunch`，切枪不清空。没有隐含全局随机流或内部墙钟。

```ts
const initial = createSourcePistolHandlingState('glock18', {
  glock18: 0, 'usp-s': 1, // caller 已确认的有效模式
});

// 每个 shared simulation tick；相机 render dt 不调用这些函数。
let handling = sourcePistolHandlingMovementTick(previous, dt);
// caller 原移动事务完成后，仅对其唯一 land event 调用：
if (land) handling = sourcePistolHandlingOnLand(
  handling, land.fallVelocitySource, commandSeed,
);

// Glock command bridge 必须保持原 event 顺序：queue → tick → 后续命令分支。
for (const event of commandResult.events) {
  if (event.kind === 'weapon-tick') {
    handling = sourcePistolHandlingMode(handling, event.mode);
    handling = sourcePistolHandlingWeaponTick(
      handling, {...context, reloading: event.reloading}, now, dt,
    );
  } else if (event.kind === 'bullet') {
    // authority：获得 BEFORE shot 与 AFTER state，后者只采用一次。
    const result = sourcePistolHandlingBullet(
      handling, context, now, {commandSeed, serverSeed}, event,
    );
    handling = result.state;
    // prediction 改用 AfterAcceptedBullet(handling,now,commandSeed,event)，
    // 不能在已调用 Bullet 后再调用一次 AfterAcceptedBullet。
  } else if (event.kind === 'activity' && event.activity === 194) {
    handling = sourcePistolHandlingAfterAcceptedReload(handling);
  }
}
handling = sourcePistolHandlingPrimaryTime(handling, commandResult.state.lastShot);
handling = sourcePistolHandlingMode(handling, commandResult.state.mode);
```

`SourcePistolBulletEvent` 显式包含 `{source:'primary'|'queued', mode, accuracyMode, recoilMode, scheduledTime}`。primary 三个 mode 必须一致；queued 仅支持 Glock，TE mode 和 recoilMode 硬 1，accuracyMode 是当时 weapon mode，允许已切回 0。spread getter 也读取当前 accuracyMode；不能将 queued 硬 mode1 等同所有 getter 均 mode1。

`sourcePistolHandlingAfterAcceptedBullet(state, now, commandSeed, event)` 只需 `source/accuracyMode/recoilMode`。queued 不写 primary notification 时间；`scheduledTime` 只保留原事件调度信息，不替代 now、lastShot 或 seed。最终 `PrimaryTime` 从 command 原结果同步，因为干扣通知也可能改变该字段。

`sourcePistolHandlingAfterAcceptedReload` 只执行原成功 Reload 的 recoilIndex+1；`context.reloading=true` 则只表示该次 WeaponTick 的状态。Glock Player shotsFired 归零由 command owner 执行，与浮点 recoilIndex 分开。不能每个 reload tick 都加 1。

`sourcePistolHandlingSwitch` 仅对新选中的不同枪执行原 deployment 数值恢复，保留旧枪状态和玩家 punch；同枪调用原样返回。显式 deployment owner 可使用 `sourcePistolAccuracyDeploy`。这不是 deploy/holster 命令接受器，不能由任何 UI 切枪尝试就重置数值。

`sourcePistolHandlingTick` 是 MovementTick→WeaponTick 便利组合。仅适合这两步之间没有 land、queued 或其他原事件的 caller；Glock command 桥应使用分段 API。

## 单位、落地与渲染边界

velocitySource 为 **Source Z-up 的 units/s**，不是浏览器米/秒；grounded/crouching/walking 是权威原移动状态，walking 用已验证的真实 IN_SPEED 有效 flag。aim/view punch 仍为 Source QAngle **degrees**。`shot.punchAngles` 已是原 aim angle×2；散布 x/y 是基向量系数，不是角度。

原相机/弹道转换复用 `source-aim.ts`：弹道只加 aim punch，不把 viewPunch 加进去；camera 才按原 `base + viewPunch + (aim*2)*.45` 建 `right/up/-forward` 基。不要再套旧 generic kick。该坐标桥的原指令证据和 Source↔浏览器轴规则见 `docs/source-handling.md`，手枪没有另一套轴约定。

OnLand 复用原函数，不手猜新的阈值。caller 的原移动落地 sampler 在 grounded 且 retained fallVelocitySource>0 时发唯一事件并清零；本函数只消费该事件，不自己去重，也不从 KCC 最后归零的 vy 猜冲击。SharedLand 的 tag=`LandPunchAngleYaw`、additional seed=0，使用正常非负 MD5 command seed；`MovementTick → OnLand → 原 command event 序列`，不在落地之后再次衰减同一 tick 的 punch。72 项四 profile 的落地和 12 项 punch→land→accuracy 原连续块数值全同。

## 验证、复现和限界

| 回执 | 真实执行和 TypeScript 对照 |
| --- | --- |
| `output/tests/source-pistol-handling-native.json` | 1312 getter/recovery/tick；256 表项；552 primary；276 queued；20 deploy；20 accepted Reload；4×480=1920 连续 tick |
| `output/tests/source-pistol-spread-native.json` | 4096 spread，含所有 256 seed bytes；8 完成消音事件；8 原命令种子 scope |
| `output/tests/source-pistol-landing-native.json` | 72 原 OnLand；12 punch→land→accuracy 链 |
| `output/tests/source-glock-handling-chain-native.json` | 原 command corpus 的 1241 独立帧和 400 连续 burst 帧，与另次原数值消费者组合；JSON 恢复和无 serverSeed 预测 state 全同 |

所有已列数值比较使用严格相等，当前误差 0。联合 corpus 的 command 输入 SHA 为 `0d8e179d33c243d9bef1cf8bfd8e5ea403dc38a049f82b2c031a8f521a8dbb3b`；测试校验仍匹配原 command 回执。这个联合 oracle 是**独立原命令运行 + 独立原数值消费者运行**组合，不是启动整个原引擎；不把它说成 GPU、网络或完整动画验收。

复现（需要本机私有原资产、现有 Unicorn venv 和 command 原回执）：

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-handling.py
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-spread.py
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-landing.py
.tools/source-binary-venv/bin/python scripts/probe-source-glock-handling-chain.py
npx vitest run tests/source-pistol-handling.test.ts tests/source-pistol-spread.test.ts tests/source-pistol-landing.test.ts tests/source-glock-handling-chain.test.ts
npx tsc --noEmit
```

原文件缺失时对应 native-fixture tests 标为 skip，不能报作本次原生通过。对象 owner/info、item/schema identity、原默认配置读取与无关 network dirty/资源查找由 harness adapter 提供；原数学/分支/stores/RNG 本身执行。外部 expf、sincosf、asinf 由 host libm 后转 float32，不能声称全部 Linux glibc 超越函数 ULP 一致。当前测试只证明所列样本严格相等。

未覆盖：手枪完整 movement/world 事务、ExoJump、非默认 ConVars/特殊游戏模式、damage/穿透、完整 USP secondary/deploy 时序、音频/动画/材质和浏览器主观体验。Glock ammo/扳机/三连发队列接受由 `source-glock-command.ts` 负责；两者共同接入版本合同和 ingress/schema 校验由 caller 负责。本轮不修改 shared Simulation/runtime/scene、既有 rifle 数学或当前运行候选。

最终 command fixture 由 1281 扩为 1290：修正 adapter info+124 的 has-silencer 标志，并放行成功 Reload 尾部 `d3f530` 清 aa4，新增 9 项初态 reloadVisComplete=true。原 1281 项按 label/input/context 对齐输出变化 0；联合 oracle 已针对最终 1290 输入重新运行，得到 1241 个普通 frame 和 400 个连续 frame。
