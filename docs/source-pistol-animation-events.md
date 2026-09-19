# 原手枪换弹完成事件：App740 build 12426148

新增 `game/source-pistol-animation-events.ts`，没有修改已交付 Glock 帧命令、handling 或共享游戏文件。原 `AE_WPN_COMPLETE_RELOAD` 事件会提前装填弹匣；原 owner deadline 仍负责换弹锁结束。两条路径都必须保留。

## 实际证据

`server.so` SHA256 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。所有地址为此 ELF 的原 VA，不泛化到其他 build。

- 注册函数 `0x6ba9d0` 的 `0x6badd2..0x6baddb` 将 `AE_WPN_COMPLETE_RELOAD` 注册为 id **54**、类型 **17**。加上新事件位 1024，运行时类型为 **1041 / 0x411**。
- 原 Glock `models/weapons/v_pist_glock18.mdl` SHA `48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242`，`glock_reload` 的事件 cycle **0.4117647111415863**。原序列 69 帧、30 FPS；名义事件时间约 0.933333 秒，不能把它当换弹解锁时间。
- USP `v_pist_223.mdl` 的 reload 事件 cycle **0.446153849363327**，序列 66 帧、30 FPS；名义事件时间约 0.966667 秒。USP 完整命令尚在独立实现，此文只交付共用 event54 状态写入。
- 原 collector `0x5a80d0` 读取 80 字节 MDL event，按 `startCycle <= eventCycle < endCycle` 选择非循环事件；等于区间末端的事件延至下一窗口。它按原 event 记录顺序枚举，不能假定 MDL 所有事件已按时间排序。
- `0x5a8249` 将新 event id 写至运行时 `event+2` 的 uint16；`0x5a8234` 保存类型。这直接证明了原 handler 所读的打包布局，无须猜 `animevent_t`。
- `0xd45296→0xd454bb→0xd45608` 实际分派到 event54，先将 W+aa4 置 true，再查询 owner；有 owner 时将 `min(maxClip-clip,reserve)` 转移至弹匣。它**不检查 reloading、owner busy 或旧 aa4，不改变 reloading/nextPrimary/nextSecondary/ownerNextAttack/lastShot**。无 owner 时仍置 aa4，弹药不转移。

## 调用顺序与最小接法

本 build 的正常活人 `CBasePlayer::PostThink` (`0x7cdde0`) 原调用顺序已用有界原指令执行和独立 callback 记录确认：

1. `0x7ce297` 调 Player vt+728=`0x61be70`：包含原 ownerNextAttack busy/post gate，之后消费当前武器命令。
2. `0x7ce0ca` 调 Player DispatchAnimEvents。
3. `0x7ce12b` 调 Weapon_FrameUpdate → `0x5c1360` → active weapon vt+630=`0x5d3320`。
4. 武器推进/世界事件之后，`0x5d33d8` 推进原 viewmodel，`0x5d33f6` 尾调 viewmodel DispatchAnimEvents，target 为 weapon；weapon HandleAnimEvent (`0x5d3590`) 再调 vt+634=`0xd45270`。

因此在桥层依次做：

```ts
const command = sourceGlockCommandFrame(previous, context);
consumeHandlingEventsInOriginalOrder(command.events);
let state = command.state;
// 权威动画时间轴在本帧 command 之后推进；BusyFrame 也必须推进。
for (const event of advanceCurrentAuthoritativeWeaponAnimation()) {
  if (event.id === 54) {
    state = sourcePistolCompleteReload(state, { weapon: 'glock', owner: true });
  }
}
// 完整 state 进入权威 Player / snapshot / history。
```

`advanceCurrentAuthoritativeWeaponAnimation` 是调用方已有/待接接口的占位名称，不是本模块导出函数。由权威序列身份、生命、换枪和取消代际筛除旧事件，再调用 helper；不能让客户端 renderer 回写 ammo。原 handler 自身不拒绝陈旧事件，因此 helper 也不伪装具有这种校验。换枪前后需保证只推进当前 active weapon；重新装填会清 aa4，后续新序列事件可再次转移弹药。

导出 API：

- `sourcePistolCompleteReload(state, {weapon:'glock'|'usp-s', owner?:boolean})`：保留所有额外字段和时钟，返回新 state。
- `sourcePistolEventInCycleWindow(cycle,start,end)`：原 f32 非循环区间比较。
- `SOURCE_COMPLETE_RELOAD_EVENT = 54`。

提前装弹后仍保留 reloading，未来 owner deadline fallback 仅转移剩余所需弹数并解除 reloading，不会重复扣除已转移弹药。Holster 在 aa4=true 时保留原 nextPrimary/nextSecondary，而 aa4=false 的中断会走已交原清时钟分支。

## 验证及边界

执行 `.tools/source-binary-venv/bin/python scripts/probe-source-pistol-animation-events.py` 生成 `output/tests/source-pistol-animation-events-native.json`。其包含 48 个原事件状态案例（event54 的 Glock 完整字段对照 16 例）、原 MDL collector 6 个临界窗口、原 PostThink→Weapon_FrameUpdate 的 6 个有序 callback。`tests/source-pistol-animation-events.test.ts` 5 项与旧 Glock 10 项合计 **15/15** 通过。

明确的适配：原模型新事件名称按本 ELF 注册表解析后写入**内存副本**，磁盘 MDL 不变；原 collector、原 event dispatcher 和状态写入执行实际指令。PostThink 顺序试验用 callback 替代重型 Player command/骨骼推进/事件内部，仅验证原控制流与 target；命令和 event54 状态写入另有独立原指令证据。未运行完整服务器游戏循环，也未宣称所有隐藏 Player gate 均已覆盖。

本 helper 不实现完整 StudioFrameAdvance、事件补发/丢包、循环序列、源动画图或重型护甲 playbackRate；传入区间必须来自权威当前序列时钟。已读原默认 viewmodel `0x5b7fc0` 用实际 animtime 差、间隔 clamp、playbackRate 和 SequenceDuration 累积 cycle，不能以任意 UI 动画 elapsed 反向决定服务器状态。
