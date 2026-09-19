# 原 Glock 权威动画时钟与事件窗口

本切片新增 `game/source-glock-animation-clock.ts`、`source-glock-animation-data.ts` 和 `source-viewmodel-animation-time.ts`，不修改已交命令/handling 或共享游戏文件。它执行当前原 Glock 六条默认非循环 viewmodel 序列的原时钟合同，并输出服务器侧原动画事件。第一人称可以按 `cycle * duration` 采样，不能再从界面 elapsed 反推权威事件。

## 固定输入与原字段

来源 `App740 build 12426148`，server SHA `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`；MDL SHA `48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242`。

| 原序号 | 原序列 | duration（源 float32 秒） | fadeOut（源 float32 秒） |
|---|---|---:|---:|
| 0 | glock_idle | 0.03333333507180214 | 0.20000000298023224 |
| 1 | glock_firesingle | 0.4000000059604645 | 0.20000000298023224 |
| 2 | glock_firelast | 0.4000000059604645 | 0.20000000298023224 |
| 3 | glock_draw | 1.100000023841858 | 0.20000000298023224 |
| 4 | glock_reload | 2.2666666507720947 | 0.20000000298023224 |
| 5 | lookat01 | 6.433333396911621 | 0.30000001192092896 |

`SOURCE_GLOCK_ANIMATION_DATA` 含该表、全部原 event 元数据和本 server 注册的数字 id/type。不要因最后一发把 192 改成 195；活动到 firesingle 的原命令行为保持不变。

完整 JSON state 的 11 字段如下，不得在 snapshot/回溯/重连时省略：

- `sequence`：原序号；`cycle`：+40c；`eventCursor`：+3b0。
- `animTime`：+70；`previousAnimTime`：+6c。
- `playbackRate`：+3d4；`finished`：+404。
- `sequenceParity`：+488；`resetEventsParity`：+48c；`animationParity`：+504（均原 3 bit）。

默认未冻结（+4ac=0）、无 playback-rate interpolation record；六序列 flags 均无 LOOP 位。速度 0/.5/1/2 已有原值样本，生产当前默认1。本切片拒绝未知序号、非有限值、负速率和超过验证范围的速率。

## 原指令与运行规则

`0x5b22b0..0x5b22de` 的 CBaseAnimating constructor 原块已执行：初生的两个 animTime 都等于 curtime。constructor playbackRate 为0，动作开始的 ResetSequenceInfo 才设为1。因此 `createSourceGlockAnimationClock(now)` 后必须按实际成功选择请求 draw 等动作；重新装备已存在 VM 不得重新调用 constructor。

成功 SendViewModelMatchingSequence `0x629820→0x5b45a0`：即使选同一非循环序列，也归零 cycle/eventCursor、清 finished、playbackRate=1，并递增三组 parity，&7。它**保留两个 animTime**。本 command 之后推进新动作会消费上一帧至今的原 interval。

`requestSourceGlockAnimationSequence` 还覆盖原 `0xd446fa..0xd44760`：当前是 `lookat01` 且 cycle<`float32(.98)` 时，请求 idle 保持旧 VM；fire/reload/draw 等可以中断。默认普通 owner/observer 外层门禁仍由调用方提供。`requestSourceGlockAnimationActivity` 按默认 MDL 五个具名 activity 映射 183→3、185→0、192→1、194→4、195→2；缺失的 184/HOLSTER 不改变 clock。

`StudioFrameAdvance 0x5b7fc0` 的原 float32 算法：

- 若 previousAnimTime 为0，先设为 animTime。
- interval=`clamp(float32(curtime-animTime),0,float32(.2))`，转 double 后与 `.001` 比较；`<=.001` 不推进。这里不是单纯用 command 的 dt。
- 超过阈值时，previousAnimTime=旧 animTime、animTime=curtime。然后按原 SSE 运算次序累加 `cycle + interval * playbackRate * float32(1/duration)`。
- 非循环 cycle 超出 [0,1) 时 clamp 并设 finished。尚在区间内时，`cycle > 1 - playbackRate * fadeOut / duration` 也会设 finished（按原逐步 f32 舍入）。因此 finished 不是片段到达末帧的同义词。
- 原 `DispatchAnimEvents 0x5b4290` 在 finished 非循环序列将窗口末端提高至 `float32(1.01)`；实际 cycle 不因此改为1。窗口为 `[eventCursor,end)`，再把 eventCursor 写成 end。playbackRate=0 或原序列没有事件时不移动 eventCursor。
- 原 collector `0x5a80d0` 按 MDL 记录顺序发出 server事件：新事件需 SERVER 位；旧事件 `<=4999` 或 `5004` 被采集。原 eventTime 保留真实原运算和舍入，它有时可略大于当前 curtime，是回调参数，**不得再拿它排队延迟执行 handler**。

Inspect 的 `AE_BEGIN_TAUNT_LOOP` 原注册为72、type1041，确实出现在原 server事件流。本默认未处于相关 Player 特殊状态时，原 `d45910` 的 Player gate 返回；clock只保留 event，不擅自制造循环或改 cycle。StatTrak/EjectBrass 的原 client-only事件不会被本 server collector当作服务器事件。

## 共享 Viewmodel 与推荐最小接法

原 `0x7c43d0` 读取 `Player + 0xfd8 + viewmodelIndex*4` 的 EHANDLE；CBaseCombatWeapon constructor `0x5de0e1` 将 +944(index) 置0。实际执行两把独立 weapon 的 constructor字段指令及原 EHANDLE lookup，均返回同一个 Player VM。AK/M4/Glock 更换武器或购买新武器都不能创建一个新的计时基准。

调用方在 Player 保存共享 `animTime/previousAnimTime`。每次有效 owned/model-valid active VM 的更新：

```ts
// 本帧 command 开始前，合入所有枪型持续推进的共享时间。
let animation = restoreSourceGlockAnimationClock({ ...savedGlockAnimation, ...playerViewmodelTimes });
// 原命令返回的 activity，逐个按原顺序处理。
for (const event of command.events) {
  if (event.kind === 'activity') animation = requestSourceGlockAnimationActivity(animation, event.activity).state;
}
// 可用的原 inspect 接受事件由调用方请求 sequence5；clock不代替接受门禁。
const result = sourceGlockAnimationFrame(animation, curtime); // command之后；Busy也执行
playerViewmodelTimes = { animTime: result.state.animTime, previousAnimTime: result.state.previousAnimTime };
for (const event of result.events) {
  if (event.recordEvent === 54) command.state = sourcePistolCompleteReload(command.state, { weapon: 'glock' });
}
```

当前枪不是 Glock 时，`advanceSourceViewmodelAnimTimes(playerViewmodelTimes,curtime).state` 推进相同两时钟，不需要 rifle duration。**Glock fullFrame内部已调用该helper，同帧不能先单独推进一次再调用fullFrame**。若没有原 active owned/model-valid VM 更新，不应无条件推进。

原三组 parity 也属于共享 VM；若调用方要逐值模拟它们，其他武器成功 SendMatchingSequence 时也须按同样规则递增。不要把按枪型单独累积的 parity 宣称为完整跨枪原值；目前核心事件准确性依赖 cycle/cursor，调用方宽域的取消generation应单独保存。

当前 `WeaponIdle` 选择不属于 clock：不能因 cycle==1/finished 自动请求185。它有独立 `timeWeaponIdle` 字段和 PostFrame 路径，补证正在单独进行；clock允许持有末帧直到实际新选择。命令接受、瞄准取消、缺失 firelast 选择、完整 inspect/toggle门禁也仍不由该时钟猜测。

## 验证

- `.tools/source-binary-venv/bin/python scripts/probe-source-glock-animation-clock.py`：**3292** 个独立/连续原 reset→advance→dispatch 样本，逐字段保存；6条×500帧连续；180 个原 lookat/idle临界门；3个constructor时间；2个weapon共享VM lookup。
- `.tools/source-binary-venv/bin/python scripts/export-source-glock-animation-data.py` 生成固定原序列表。
- `npx vitest run tests/source-glock-animation-clock.test.ts tests/source-pistol-animation-events.test.ts tests/source-glock-command.test.ts`：**22/22**，包含所有3292状态、事件浮点、JSON中途恢复、同序列重启、parity wrap、持其他枪10秒再换回首帧只消费1/64。
- 收据 `output/tests/source-glock-animation-clock-native.json` 与 `output/source-glock-animation-clock-tests.log`。

模型元数据/query、network dirty通知、视模bodygroups、插值/调试/事件transport为明确adapter；原reset字段写入、原时钟数学、原非循环finished判断、原event collector和事件timestamp数学全部执行实际i386。未运行完整Valve进程/渲染器；默认scope外的冻结、循环动画、observer/replay/高护甲特殊playback不能据此声称一致。
