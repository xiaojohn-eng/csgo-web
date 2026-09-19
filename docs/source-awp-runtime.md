# AWP 原命令、镜档和动画时钟

基线 `a94e8bcc3af60ed7b3fd2002bf0dead8baefd826`。本增量只接独立 AWP owner，不改共享 simulation/types/runtime/assets/profiles/server 或运行服务。原资产使用既有 AWP MDL/声音/人物包；未新增替代动画。

原 `server.so` SHA-256：`7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。原 AWP FP MDL：`37e15ab1db5613843df7efaf2dc61cf3dc5dc1642a4eee74f74596c10b56e0c3`。RTTI `0x12e7208`；AWP 主 vtable `0x12e92f4`。读取原类型表 `0x1725f18` 得 `SniperRifle=5`。只在这些独立核对后复用普通 base-gun command 和 VM 时钟。

| 原槽 | 原函数 | 消费 |
|---|---|---|
| 0x4ac | 0xd4d5c0 | Deploy |
| 0x4b0 | 0xd4cc60 | Holster |
| 0x4d0 | 0xd4ac70 | ItemPostFrame，包括恢复镜档 |
| 0x4f8 | 0xd4ca70 | Reload |
| 0x4fc | 0xd4b7e0 | PrimaryAttack |
| 0x500 | 0xd4bd20 | SecondaryAttack |
| 0x4dc | 0xd47610 | WeaponIdle |
| 0x71c | 0xd47770 | HasZoom |
| 0x6f4 | 0xd3e960 | 原镜档 FOV |
| 0x6f8 | 0xd3e9d0 | 原镜档过渡时间 |

`inspect-source-awp-command.py` 保存每个原函数的字节 SHA、反汇编、字段地址和名字注册检查。原服务器命令在 Unicorn 中执行，未运行游戏进程。

## 命令契约

`createSourceAWPCommandState`、`sourceAWPCommandFrame`、`sourceAWPDeploy`、`sourceAWPHolster`、`sourceAWPAnimationEvent` 是无共享玩家状态的纯输入/输出调用。

状态保存普通 base-gun 的弹药、冷却、ownerNextAttack、半自动 latch 和 reloadVisComplete；额外保存 `zoomLevel: 0|1|2`、`zoomReadyTime`、`scoped`、`resumeZoom`、`fovTarget/fovStart/fovTime/fovDuration`。完整状态可 JSON 往返。

- 原弹匣 5 / 后备 30；主攻击间隔 f32(1.455)。原 AWP 是半自动输入 latch，按住主攻击不自动连射。最后一发仍选择 activity 192；没有 AWP activity 195。
- 次攻击按 `0 → 1 → 2 → 0` 切换，原 FOV 为 `90 → 40 → 10 → 90`；三个镜档过渡均 f32(0.05)，nextSecondary 由原外层写 now+f32(0.3)。原开镜声音为 `Weapon_AWP.Zoom`。
- 次攻击依次输出 `fov`、`zoom-smoothing-reset(field:0xa8c,value:0)`、`sound`。该事件明确带 field=0xa8c，仅清镜头相关平滑项；不得清真正弹道 penalty（0xa84）。
- 实弹射击的 bullet 事件保存退镜前的 mode/accuracyMode/recoilMode。随后立即发出 default FOV/0.05 s 过渡，scoped=false、resumeZoom=true、mode=0，保留 zoomLevel。不是等火动画 0.2 周期才修改 FOV。
- `now >= nextPrimary` 时恢复镜档发生在 weapon-tick 和当前输入之前。恢复过渡 0.1 s，zoomReadyTime=f32(now+0.1)，然后 resumeZoom=false。空仓通常不恢复；原 noAutoReload 分支的例外也有原生覆盖。
- reload activity 194，动画时长 f32(110/30)；原 event54 在周期 0.5454545617103577 提交弹药，reloading/owner busy 冷却仍延续至动画结束。重装必须清掉上次 reloadVisComplete。
- Deploy 原活动183，时长1.25秒，清镜档/scoped/resumeZoom并发出 target=0 的默认视野请求；原 latch 要求松开攻击后再打。
- Holster 清镜档/mode并发出 target=0，取消未完成装弹时的武器冷却；原收枪函数自身保留 player scoped/resumeZoom 字段。新武器 Deploy 清掉这些 player 字段，集成方不能把旧武器的保存字段直接覆盖新玩家视野。

`sourceAWPFov(state, now)` 返回 `{state, value}`，执行原服务端 `0x7cb6b0` 的 f32 smoothstep 和整数截断；`fovTarget=0` 是原默认 FOV sentinel，普通默认 FOV90。GetFOV 在过渡结束时更新 fovStart；SetFOV 先采样旧过渡。不要用线性 CSS 缩放替代这一数值契约。镜片材质、遮罩/HUD、宽高比投影和客户端最终渲染由共享入口另接。

`0xd499e0` 读取0xa8c，以每帧10×frametime趋近真实GetInaccuracy，再用它修饰镜档FOV；0xd3ff60/0xd42060 的弹道penalty位于0xa84。原次攻击只清前者。三项原字段隔离测试以ballisticPenalty=f32(.37)、zoomSmoothing=f32(.25)开/退镜，确认前者保留、后者归零。这里不将这个孤立原函数声称为已完成客户端scope呈现。

## Runtime 和动画契约

`createSourceAWPRuntimeState(now)` 返回 `weapon:'awp'`、command、handling、animation、idleTime 和可选 action。`sourceAWPRuntimeFrame` 接普通命令字段、accuracy 以及 `execution:{type:'authority',serverSeed}` 或 `{type:'prediction'}`。命令初版只发出意图；后续 handling 增量已使权威 bullet 带原散布/recoil 状态的 `.shot`，预测只更新状态且不带 serverSeed/shot。命中判定仍由权威世界调用负责。

`sourceAWPRuntimeDeploy(state, now, accuracy)` 和 `sourceAWPRuntimeHolster(state, now)` 负责同一原命令调用。后续独立 handling 增量已加入原精度/后坐力，Frame 输入须带 `accuracy: SourceAccuracyContext`；完整调用顺序见 [source-awp-handling.md](source-awp-handling.md)。`sourceAWPRuntimePostThink(state,{now,viewmodelTime:{animTime,previousAnimTime},active?,owner?})` 必须在玩家命令之后调用，只给当前实际持有枪推进；inactive/无 owner 明确返回不推进。它执行原 VM advance/dispatch，随后将 event54 提交给命令 owner。不要再在渲染器回调中重复提交换弹。

四个原活动映射：185→awp_idle/0、192→awp_fire/1、183→awp_draw/2、194→awp_reload/3。三条 lookat01/prepare/loop 原序列4–6完整保留，无伪造命名活动；本增量提供 requestSequence，具体 inspect 输入触发另接。原 lookat 名字前缀 guard 对4、5、6均拒绝 cycle< f32(.98) 时被 idle 打断。七个原序列的 flags 均非循环（包括 lookat01_loop）；同序列 reset 仍增加三个原 parity。

PostThink 返回两路：

- `animationEvents`：原服务端真正收集到的事件（如5004声音、54换弹）；仍按 MDL 原存储顺序。
- `animationCues`：按同一原周期窗口读取的客户端记录/不透明标记，带 record/name/recordEvent/type/cycle/options/status。抛壳 `AE_CLIENT_EJECT_BRASS` 原注册71/type1040，fire cycle f32(.46)，典型64Hz连续推进第50 tick才过该周期；原枪口5001在首帧。音频仍可由既有原 timeline owner 消费，不能重复播放。

`AE_WPN_UNZOOM` 确实在原 MDL fire cycle f32(.2)，但本地原 server.so、32/64 位 client_client.so 和 client.dll 均无该名字注册串。原服务端事件表没有这个注册，原 collector不向权威weapon handler发送它。保留 `status:'unregistered-marker'`（典型64Hz第22 tick），不臆造第二次 FOV 或其他动作处理。字节不存在证明保存在 discovery JSON；不声称已经实现未知客户端处理器。

## 独立验证

- 3,447 原命令边界/ordered events；含2,550条连续原生状态链、开镜中断、镜档恢复优先级、空仓、reloading、输入组合、owner busy、holster/deploy。
- 324 原服务端整数 FOV 对照，包括 target0 和打断旧过渡。
- 16 原 event54 处理器对照，包含无 owner、非 reloading 和后备不足。
- 551 原 VM reset/advance/dispatch 帧，147原 request guard。
- 240 原 idle 条件/时间存储。
- 3,000 联合 command→idle→VM→event54帧，含4次原事件提交，逐帧检查动作身份、generation、clock parity、事件顺序和 JSON 回放。

重跑：

```sh
.tools/source-binary-venv/bin/python scripts/inspect-source-awp-command.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-command.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-animation-clock.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-runtime.py
npx vitest run tests/source-awp-command.test.ts tests/source-awp-animation-clock.test.ts tests/source-awp-runtime.test.ts
npm run typecheck
```

本工作树最终 AWP 专属测试11文件36测试通过，`npm run typecheck`通过。冻结的未跟踪证据逐文件清单为 `docs/source-awp-runtime-evidence-files.json`。

这些脚本使用既有原始 ELF/MDL、SourceIO audit 和 FDE 清单；共享探针只读。scope aim-controller/observer/FOV override、heavy armour、特殊游戏模式、原客户端 UI 和inspect输入选择不在本轮契约。精度/后坐力/普通伤害/弹道已由后续 [独立 handling 增量](source-awp-handling.md) 补齐；共享网络和玩法入口仍由主目录集成。以上是原生数值与模型时钟证据，不表示 AWP 已在主游戏可玩或完成视觉/局域网验收。
