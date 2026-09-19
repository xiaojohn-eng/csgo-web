# App740 AK/M4A4 散布与后坐取证

当前纯层包括 seed / spread / recoil 表，以及 `source-accuracy.ts`、`source-punch.ts`、`source-rifle-handling.ts`、`source-landing.ts`、`source-aim.ts` 的逐 tick 状态、落地和弹道/相机轴桥接。普通 mode0 AK/M4 的 tick / accepted-shot / deployment / weapon.OnLand 已有原指令对照，当前专项 **21/21通过**。本报告只验这些纯层；父任务另行接入 Simulation/runtime/scene 并做 LAN/浏览器验收，不能把纯层 oracle 当全部原引擎武器管线或主观反馈验收。下文早期slice的小结为历史阶段，最新边界见末两节。

原 `server.so` SHA256：`7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。原 `bin/libvstdlib.so` SHA256：`bed32bd6bc26d6808b3e003fdf57066e0df884f2b264255450bdc75f64b314af`。所有地址均为本 App740 build12426148 的 ELF32 虚拟地址。

## 原种子确实有两条链

1. 解码命令 `0x8bb470` 在 `0x8bba10..0x8bba2c` 将 commandNumber（cmd+4）交给 `0xe752d0`，原 MD5 摘要 byte6..9 取 little-endian uint32，再与 `0x7fffffff`，写 cmd+0x40。
2. `sv_usercmd_custom_random_seed` 的本 build 构造默认 **1**：原注册 `0x434587`、实例 `0x1794e60`。
3. `ProcessUsercmds 0x7d3a40` 的默认分支调用 `Plat_FloatTime`，加 double `4294967296.0`；再调用 `RandomInt(0,2147483647)`。这两项组成 **little-endian double8B + int4B + zero4B** 的16B，执行原 SHA1，结果首4B作为 cmd+0x44。关闭此 ConVar 时 `0x7d3ab0` 直接复制 cmd+0x40 到+0x44。
4. `0x600360` 分别将 cmd+0x40/+0x44 存入全局 `0x16d2424/0x16d2420`，命令结束时清回 -1。实际 rifle fire `0xd4b1f0` 在 `0xd4b494` 读取 **后者低8位**；FX_FireBullets `0xcb4bc0` 在 `0xcb539f..0xcb53ae` 加1后调用 RandomSeed。

因此 `sourceCommandSeed(seq)&255` 不能冒充默认服务器散布种子。`sourceServerSeed(platformSeconds,entropy)` 返回有符号 int32，调用方把结果或低8位记录在权威每发事件/重放数据；该纯函数不读取当前时钟，也不隐式取随机数。平台时间必须是 caller 提供的单调运行时间，entropy 的实际全局 RNG 历史本次没有重建。

固定官方 [Source SDK 的 ProcessUsercmds](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/player.cpp#L3300) 支持“两套种子”的来源，但它的旧实现仅将 float(time*1000) 位模式当 server seed。**本安装版本已经改用16B SHA1，不能照抄旧 SDK 的数值生成式。**

`scripts/probe-source-seed.py` 执行原 MD5、完整 SHA1 round/update/final/output，以及当前 ProcessUsercmds 的组合块。只供应平台时间、外部 RandomInt 返回值和 memcpy；hash 算术没有 host 替身。9项命令种子、24项服务器时间/entropy 组合均与独立标准 hash 和纯 TypeScript 值一致。回执：`output/tests/source-seed-native.json`。

## 原 RNG 与射线散布

原 vstdlib 导出符号：CUniformRandomStream SetSeed `0x1cd10`、GenerateRandomNumber `0x1ce70`、RandomFloat `0x1d060`。32项 shuffle 状态、40轮初始化、整数常量16807/127773/2836/2147483647和 float32 映射直接来自此二进制。固定官方 [random.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/vstdlib/random.h) 只用来核对接口与32项状态；不把缺失的 random.cpp 当已公开来源。

普通 AK/M4 每发依次取：r1∈[0,1]、a1∈[0,2π]、r2∈[0,1]、a2∈[0,2π]。不准确度和武器 spread 各自形成一个半径为线性随机值的分量，两个分量相加：

```
x = cos(a1) * (r1 * inaccuracy) + cos(a2) * (r2 * spread)
y = sin(a1) * (r1 * inaccuracy) + sin(a2) * (r2 * spread)
```

这里是原 SSE 运算次序的概念式，实现逐步 Math.fround。原 FX 段 `0xcb5bac`、`0xcb5780..0xcb57ed` 和 FireBullet `0xc738b3..0xc7398d` 证明 x/y 是 **right/up 基向量的无量纲系数**。方向为 `normalize(forward+right*x+up*y)`，原归一化长度加 `FLT_EPSILON`。不是 sqrt(random) 的单圆盘，也不是把 x/y 直接加到 yaw/pitch 弧度。

`sourceRifleSpread(seedByte,inaccuracy,spread)` 返回x/y和四个原随机值；`sourceSpreadDirection({forward,right,up},offset)` 接受 caller 已含原 aim punch 的世界基向量。只覆盖普通单弹 rifle，不包括霰弹枪固定pattern、R8、Negev特殊半径变换。

`scripts/probe-source-spread.py` 执行原完整 RNG（含锁状态；只供应隔离线程ID）和原 SSE 散布/方向块。260条种子序列共 **10,400** 次 RandomFloat（覆盖0/负/INT32边界、超过32项shuffle）；256 seed bytes×5 spread输入共 **1,280** 组。TypeScript 所有中间/最终对照误差0。外部 sincosf 由 host sin/cos 转float供应，所以不声称重现所有 glibc sincosf ulp；原随机与SSE算术本身没有替身。回执：`output/tests/source-spread-native.json`、`source-spread-verification.json`。

## 原全自动后坐表

原生成器 `0xca1a90` 的 `0xca2199..0xca23d0` 为每武器生成两个模式×64项。AK recoil seed=223、magnitude=30；M4A4 seed=38965、magnitude=23；两枪 angle=0、angle variance=70、magnitude variance=0，两个模式的这些字段相同。原 item 属性 SHA与伤害报告相同，逐 prefab 继承保存在回执。

默认 ConVar 的实际构造：suppression_shots=4、suppression_factor=.75、variance=.55。每条先原 RNG 取角度扰动和强度扰动；首条直接用值，其后以.55从上一条已处理值向新值插值；前4条再乘 `.75 + index*(1-.75)/4`。**被压制后的强度会进入下一条的递推**，不能先独立生成64项后统一乘头4项。原查询 `0xca30e0` 用 `mode*64+(index&63)`，不是到弹匣长度就截断。

`sourceRifleRecoil(weapon,shotIndex,mode=0)` 返回原 angle/magnitude。`scripts/probe-source-recoil.py` 执行整个原生成循环，原 vstdlib 调用由另一隔离原生实例运行，四个模式共256项与 TypeScript逐值相等。回执 `output/tests/source-recoil-native.json`。

原 `0xd42490` 对全自动武器使用 `int(m_flRecoilIndex)` 查表，非全自动另用命令seed；本候选不支持后者。原 `0xc70850` 将 angle×原π/180后计算sin/cos，**将负cos/sin×magnitude加入 player+0xa7c/+0xa80 的 punch velocity**，还存在额外 view-punch 分支。`0xc70ab0` 才将 player+0xa70..a78 的 punch angle乘默认 weapon_recoil_scale=2，供射线视角使用。

## 状态依赖及后续接入边界

本轮已确认的真实状态与顺序，仍不等于完整状态机验收：

| 原状态/函数 | 真实含义与接入要求 |
| --- | --- |
| weapon+0xa84，m_fAccuracyPenalty | 持久状态。射击后 `0xd4b577` 加本模式 inaccuracy fire；射线使用的是加增量之前的状态。 |
| weapon+0xa98，m_flRecoilIndex | 浮点持久状态。`0xd4b5b9` 先按旧index注入后坐；随后 shotsFired+1，再 recoilIndex+1。 |
| weapon+0xaec，m_fLastShotTime | 原 recovery 用 lastShotTime+原cycleTime+当前frameTime 与curtime比较，不能只用旧shotIdle>.18近似。 |
| getter `0xd3ff60` | 持有者、force/no-spread ConVar、最大速度、实际横向速度、m_bIsWalking、grounded、垂直速度、accuracyPenalty、额外瞬态值共同决定。 |
| 移动部分 | 最大速度的.34到.95为归一化区间；跑动时对clamp后的t做两次sqrt，步行flag保留线性t，再乘原inaccuracy move。原m_bIsWalking的+0x16a9由SendProp注册交叉确认。 |
| 属性单位 | spread/inaccuracy 原字段经 `0x8fddd0` 的 `float32(raw)*float32(.001)` 缩放；getter `0xc980a0` 同样乘.001。不得把原6.41当6.41弧度，也不能直接当角度。 |
| penalty recovery `0xd42060` | 站/蹲、reload、air/ladder目标不同。高于目标时用 `target + expf(-ln(10)*dt/recoveryTime)*(penalty-target)`；低于目标会直接抬到目标。 |
| recovery time `0xd41e70` | 站/蹲初始与final参数按int(recoilIndex)在原transition start2/end5之间插值；air返回4×crouch time，ladder有单独选择。 |
| recoilIndex recovery | 原 `0xd422b0` 在射后时间条件满足后指数退减；它与accuracyPenalty不是同一数。 |
| punch decay `0xba6f20`/`0xba6e30` | 独立player angle+velocity状态，angle先指数与线性长度回中，积分半步velocity，再指数衰减velocity，再积分半步；默认angle exp8、linear18、velocity exp4.5。本轮仅静态链，不声称完整tick oracle。 |

原AK stand/crouch原字段6.41/4.81、fire7.8、move175.059998；M4A4主模式4.9/4.1、fire7、move137.880005。完整原字段（含alt、air、land、recovery）在 recoil原生JSON中保留，不能把M4A4的alt属性误当已存在M4A1-S模式。

给共享 Simulation 的最小方向：持久化每武器 accuracyPenalty/recoilIndex/lastShotTime及当前模式；每玩家 punchAngle[3]/punchVelocity[3]；每条收到的权威命令固定 serverSeed（网络输入不能覆盖），发射事件记录取用的seedByte。按原tick顺序更新准确度、用当前pose/眼睛/punch确定基向量、射线散布/命中，再推进射后增量。snapshot/replay必须保存这些权威状态；客户端可做反馈预测，但不知道新serverSeed时不能声称预测命中同值。

早期第一层记录（后续状态以文末共享接入验收为准）：seed2、spread3、recoil2共 **7/7通过**，全项目 `tsc --noEmit`退出0。未运行浏览器、未动端口、未改 handling/Simulation。需继续闭合的部分：完整 air/land/ladder/reload/weapon-switch 状态时序、punch每tick原生对照、射击状态和snapshot/重放接入、主观开枪反馈与LAN实际交火验收。


## 逐 tick 状态 slice（r1）

纯合成入口 `game/source-rifle-handling.ts`，版本 `csgo-rifle-handling-12426148-r1`。constructor 原 accuracyPenalty/recoilIndex/lastShotTime/lastUpdateTime 都是 0。每武器独立保存这四项；每玩家保存 `punch.angle[3] / velocity[3] / viewPunch[3]`。角度是原 QAngle 度，速度为度/秒。`context.velocitySource` 为原 Source `[x,y,z]` 单位/秒，Z 向上；从当前浏览器速度换算为 `[vx/.0254, -vz/.0254, vy/.0254]`。最大移速取原 AK215/M4225，不以已经蹲/步行减速后的速度重定义误差阈值。

接口按原边界拆开：

- `createSourceRifleHandlingState('ak47'|'m4a4')` 创建独立普通 mode0 状态。
- `sourceRifleHandlingTick(state,context,time,dt)` 更新一次当前武器准确度及玩家两套 punch。caller 负责每权威 tick 唯一调用、实际运动 flags 与时钟；本模块不自己跑计时器。
- `sourceRifleHandlingShot(state,context,time,serverSeed)` 只在 caller 已通过 alive/ammo/reload/cadence 后调用。返回 `shot` 包含旧 inaccuracy/recoilIndex、原 spread、serverSeed/seedByte、旧 aimPunch×2、随机偏移；返回新 state 才加 fire penalty、原 recoil impulse、recoilIndex+1 和 lastShotTime。
- `sourceRifleHandlingSwitch(state,weapon,context,time)` 只在接受 deploy 时调用。切同一枪没有制造 reset；切到另一枪按原 holstered elapsed 恢复它的 penalty，再归零它的 recoilIndex，player punch 保留。

原 `0xd443d0` 的 `0xd443f5`（武器 vt+0x73c）在后续射击处理前执行 UpdateAccuracyPenalty；`0xd447a0` 的忙碌帧入口同样调用。原 movement `0xba2610` 的 `0xba29bd` 先调用 vt+0x48→`0x712520`（view punch），`0xba29c5` 再 vt+0x138→`0xba6f20`（aim punch）。两者互相不依赖，合成函数保持两状态独立。整场 movement/weapon 事件调度仍由 caller 接入；不声称已执行完整原 PlayerRunCommand。

原 rifle `0xd4b56f..0xd4b614` 先加 fire penalty，`0xd42490` 依据旧 float32 recoilIndex 的截断整数访问原 64 项表，再将后坐注入 player velocity，最后增加 recoilIndex。`0xd43820` 的射击处理在 `0xd43a43..0xd43a6f` 把 curtime 写入 lastShotTime。此处没有借用旧 shotHeat/shotIdle。

默认 `weapon_accuracy_reset_on_deploy=0`，不能把切枪当成清空后坐。原 `0xd44ec0` 使用 `clamp((curtime-lastUpdateTime)/GetRecoveryTime,0,1)` 线性减少 penalty；这里不是 tick 的指数恢复。原 player+0x160a 是 **ExoJump 装备**：`equips or removes exojump` 命令注册调用 `0x645160` 读取/切换它。它在 airborne target 上乘 .5；普通 Dust2 本合同固定未装备，不能误映射为 crouching。普通 crouching 仅由 FL_DUCKING bit2 决定。

M4A4 主模式 cycleTime=.09s、AK=.1s。recoilIndex 时间门使用原 float32 `curtime > lastShotTime + frameTime + cycleTime`，指数系数 `2*ln(10)`。普通两枪 reload inaccuracy 参数都是0，reloading 不产生额外 penalty 或清空恢复状态。Ladder target 是本模式 inaccuracyLadder 加主模式 inaccuracyLadder（普通 mode0 即两倍），恢复时间为原 stand recovery；此项只证明误差算法，不证明当前 controller 已支持爬梯。

## Aim punch 和额外 view punch

`sourcePunchTick` 对 aim angle 先乘 `expf(-8*dt)`，向量长度再减 `18*dt`（归零分支按原 SSE）；随后加旧 velocity 半步、velocity 乘 `expf(-4.5*dt)`、再加新 velocity 半步。`weapon_recoil_decay1_exp=3.5` 虽被注册，在本 build 没有发现除构造外的读取，未拿它替代实际使用的参数。

`sourcePunchImpulse` 执行原 `0xc70850` 的两个分支：原 recoil angle 经 float32 π/180 和 sincosf 后，负 cos/sin×magnitude 加到 aim velocity；另以默认 `weapon_recoil_view_punch_extra=.055` 直接减到独立 viewPunch 的 pitch/yaw。原 `0x712520` 调 `0x712430`，viewPunch 以 exp18/linear0 独立恢复，包括浮点平方下溢后整个向量归零的真实分支。所有默认值均在 native probe 里从本 build 对应 ConVar 构造 PUSH 参数重新核对，JSON保留注册VA。

`sourceShotPunch(state)` 仅返回 aim angle×默认 weapon_recoil_scale2；额外 viewPunch 不影响本模块权威射线。客户端可以按这两套状态显示原反馈，但不能同时再加现有 `recoilOffset()` 的经验曲线。

## 浏览器视角与原射线的桥接

当前 `handling.ts` 的浏览器 forward 是 `(-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))`，yaw/pitch 为弧度。等价原 QAngle 为 `[-pitch*180/pi, (yaw+pi/2)*180/pi, 0]`。将 **sourceShotPunch 输出的度数** 加到这个 QAngle，再按原 AngleMatrix/AngleVectors 建基向量。Source→browser 的方向转换是 `C(x,y,z)=(x,z,-y)`；方向无需乘 .0254。

`sourceBrowserShotBasis(yawRadians,pitchRadians,shot.punchAngles)` 已提供返回 `{forward,right,up}` 的纯函数。原矩阵第二列是 left，因此 right 要取负。调用方随后执行 `sourceSpreadDirection(basis,shot.offset)`，得到浏览器单位方向。不要把 spread.x/y 当欧拉角，也不要把 degree punch 直接加到 browser radians。

`source-aim` 的105项原 AngleMatrix（含正负yaw/pitch、非零roll、偏转）最大分量误差0；无punch时与当前浏览器 forward 对齐。-5°原 pitch punch 会抬高浏览器视线5°；+5°原yaw则按浏览器+yaw转向。浏览器弧度转换属于当前项目坐标桥接，不冒称原网络QAngle量化已重建。

## 原指令回执、复现与重放交接

`scripts/probe-source-accuracy.py` 执行原完整 GetInaccuracy / GetRecoveryTime / UpdateAccuracyPenalty / view-punch / aim-punch / recoil impulse 函数，以及原射后写入、deploy 分支。原 recoil 表由另一原 vstdlib 实例生成，lookup 仅以资源映射适配器提供原表，`mode*64+(index&63)` 仍跑原指令；不是 host 抄一份数值公式当 oracle。仅持有者/武器info/资源查询、网络dirty通知，以及外部标准 expf/sincosf 是适配器；不执行实体、声音、动画、弹药副作用。不主张跨所有 glibc expf/sincosf 的最后一位完全相同。

- 1,320 个独立 tick，包括站/蹲/步行/跑、向上/向下速度、apex、时间门、不同 recoilIndex、零dt及向量下溢：所有状态/getter/recovery误差0。
- 20 个 deploy（站/蹲、不同holstered时长）、30个 impulse：逐值相等。
- 两枪各640 tick，合计1,280连续 tick / 60发，含 walking/running/crouch/crouch-move/jump/stop-recovery/ladder/reload/switch：所有武器和punch状态与原指令相等。第350tick JSON序列化还原后续回放同值。这里的 accepted-shot 时间表由 fixture 提供，未冒称验证发射/重装动画调度。
- `source-aim` 105项原矩阵对照最大分量误差0。

回执为 `output/tests/source-accuracy-native.json`、`source-accuracy-verification.json`、`source-handling-sequences.json`、`source-aim-native.json`、`source-aim-verification.json`。原始二进制和native回执都是私有输入；若缺少这些文件，相关 native对照测试会明确skip，不算验收通过。普通坐标/版本/输入边界测试仍可运行。

复现命令（项目根）：

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-accuracy.py
.tools/source-binary-venv/bin/python scripts/probe-source-aim.py
npx vitest run tests/source-seed.test.ts tests/source-spread.test.ts tests/source-recoil.test.ts tests/source-accuracy.test.ts tests/source-aim.test.ts
npx tsc --noEmit
```

服务器要把 handling version 纳入 Simulation版本，并在snapshot/replay保存完整 `activeWeapon / weapons / punch`；每发保存权威serverSeed或至少seedByte。命令sequence的MD5种子与默认server SHA1种子是不同链，不能用 `seq &255` 替代。客户端可基于相同已接受事件预测 accuracy/punch；尚未收到该发serverSeed时散布命中不能声称确定预测，收到receipt后才能原值重放。render dt 不得推进这些权威字段。

继续取证范围：原 OnLand `0xd40580` 的额外 penalty/随机 aim impulse，以及原 movement向它传入的实际标量、触发时序与seed语义。普通 OnJump 武器槽 `0xd3e5c0` 是空函数，jump/airborne误差已由本slice getter/target覆盖。尚未把未知 OnLand 标量猜成 KCC vy；未覆盖完整原降落回调、ExoJump、非默认 ConVars、M4 alt模式、换弹/射速事务、实时网络和主观反馈验收。

## 接受射击预测与落地事件补齐

`sourceRifleHandlingAfterAcceptedShot(state,time)` 不接 seed，只返回确定性的射后 accuracy / recoil 状态。服务器 `sourceRifleHandlingShot` 内部复用它；不能再额外推进一次。客户端必须先通过自身与服务器一致的 alive / ammo / cadence / reload 接受条件，才能预测调用。该 API 不返回随机偏移、射线或命中，不以假 seed 制造客户端弹道。新增 40 次连续射击 × 4 个不同服务器 seed 验证射后状态相同，旧输入不变。

`source-landing.ts` 的版本为 `csgo-rifle-landing-12426148-r1`，应与 handling version 一同纳入调用方版本合同。正常原移动的具体链来自当前 `server.so`：

| 原指令位置 | 已验证行为 |
|---|---|
| `PlayerMove 0x714a30` / `0x714b04..0x714b2b` / `0x714d50..0x714da7` | 先读取当前 ground entity；无地面才把 CMoveData+0x48 的 **Source Z-up 当前速度取负** 写 player+0xa58。发生在该 command 的重力与移动碰撞之前。已有地面则保留上一个样本。 |
| SendProp 注册 `0x7e96ac` | 原字段名为 `m_flFallVelocity`，player local data 内 offset0x6c，对应 player+0xa58。 |
| `CheckFalling 0x709a00` | 当前已有 ground 且该字段 **严格大于0** 时调用落地 hook，随后清零。350不是枪械落地阈值，它只控制另一个粗落地/声音/伤害分支。 |
| GameMovement vtable `0x12a2184+0x80` → `0xb9fdc0` | CS 移动落地 hook 保留原 float 入参，处理独立 stamina 后 tail-jump `0xc73550`。 |
| player `0xc73550` → rifle vtable+0x718 → `0xd40580` | 当前 active weapon 接收该原始 fall velocity。不是碰撞后已被置零的 vy，也不是位移差 / dt。 |
| `0xd40580` | penalty += fall×inaccuracyLand；再将落地角增量直接加到 aim angle 的 pitch/yaw，保留 aim velocity 与 viewPunch。 |

这与 [固定官方 SDK 的 PlayerMove / CheckFalling 字段生命周期](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp)一致；本 build 的武器增量、stamina 分流和具体偏移以原二进制为准。普通 Dust2 静态地面无需移动底座修正。原高冲击分支对浮动物体减200、对下落底座加底座负 vz；水、移动平台、强制1000落地事件、stamina和坠落伤害未包含在本纯武器回调中。

调用方必须持久化 `fallVelocitySource`，初始为0，连同运动快照/重放保存：

1. 保存此次重力/KCC之前的原始速度；先完成原采样点前对应的 ground categorization。
2. `sourceFallVelocityBeforeMove(previous,groundedAtSample,velocityZSource)`：无 ground 才更新为 `-vz`，上升时允许负值，不使用历史最大值。若本 tick 初始分类已找到地面，保留上一空中 tick 的正样本。
3. KCC / 最终 ground 分类后执行 `sourceFallVelocityAfterMove(sample,groundedAfter)`。返回 `landedFallVelocitySource` 为数值或 null，并返回需要持久化的新字段；落地事件后字段为0。不要另外根据 `before.grounded !== after.grounded` 再发一遍事件。
4. 若有事件，`sourceRifleOnLand(handling,impact,sourceCommandSeed(command.seq))` 更新当前枪与玩家状态。浏览器 vy 到原 Z 速度是 `vy / .0254`，不能直接传米/秒。

实际顺序需要拆开原先的组合 tick：

```
sourceRifleHandlingMovementTick(state,dt)   // view + aim 衰减
movement / ground categorization / OnLand
sourceRifleHandlingWeaponTick(state,context,time,dt) // active accuracy
accepted shot / sourceRifleHandlingShot 或预测 AfterAcceptedShot
```

`sourceRifleHandlingTick` 仍保留为没有中间落地事件时的便捷组合，内部复用同一分段函数。落地增量不能在组合 tick 之前统一加（会被错误先衰减 aim），也不能在组合 tick 之后统一加（会错过当帧 weapon recovery）。

原落地数值：`increment = float32(fallVelocitySource * inaccuracyLand)`，AK land = float32(.242×.001)，M4 = float32(.192×.001)。pitch 增量为 `asinf(clamp(increment,-1,1)) × 11.459155082702637` 度；yaw 增量再乘 `SharedRandomFloat(-1,1) × .10000000149011612`。这是直接 aim angle，不是 recoil velocity，也不是仅供视觉的 viewPunch，后续子弹会读取 aim×2。

SharedRandomFloat 的 tag 为 **`LandPunchAngleYaw`**，additional seed = 0。原 `0x8d2b60` 读的是正常 MD5 命令 seed global0x16d2424；与服务器子弹 SHA1 seed global0x16d2420分开。`0x8d2530` 执行标准 CRC32，输入依次为 little-endian int32 命令 seed、little-endian int32 additional=0、17字节 ASCII tag（不含 NUL）；CRC结果作为 int32 交给原 CUniformRandomStream，再取[-1,1]。预测与服务器可以由同一合法 seq 获得同一落地增量，网络输入不能自带覆盖 seed。

本次证据：`scripts/probe-source-landing.py` 执行原完整 weapon.OnLand、原 CRC32、原 vstdlib RNG，300项双枪/10seed/15速度案例；另36项原采样指令，20项连续两次 CheckFalling ground/positive/dispatch/clear，30项原 punch decay→OnLand→accuracy 的混合时序。`output/tests/source-landing-native.json` 保留每个输入输出；300项数值比较 **0误差**。CheckFalling 探针设置health=0跳过无关粗落地副作用，不能称完整原引擎运动验收。外部 `__asinf_finite` 仅由主机 libm 取 float32 返回；不声称整个 Linux glibc transcendental ulp 同值。

## 相机后坐与弹道分开

新增 `sourceBrowserCameraBasis(yawRadians,pitchRadians,punchState)`，返回浏览器 `{forward,right,up}`。直接供 Three `Matrix4.makeBasis(right,up,-forward)`，包含 roll；不要用自拟 Euler 顺序。它使用原正常客户端画面合同：**先 base angle + viewPunch，再加 aimPunch×2×0.45**，保留原每步 float32 的舍入顺序。射线 `sourceBrowserShotBasis(...,sourceShotPunch(...))` 仍使用 aimPunch×2，viewPunch不参与射线。

本机原 `client_client.so` SHA256 `21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb`：注册 `0x3b63cb` 证明 view_recoil_tracking 默认 .45；`0x3be3b8` 证明 weapon_recoil_scale 默认2。C_CSPlayer 原 vtable0x1022b68+0x634→0x5c3f50，正常分支将原 aim 字段×2；camera block `0x57c43e..0x57c4e8` 先加 viewPunch（player+0x2fe0），再加上述 getter结果×.45。独立 `scripts/probe-source-camera.py` 执行这一原默认分支，随后原 server AngleMatrix；105组 yaw/pitch/aim/view/roll 的全部 basis 分量 **0误差**，Three camera 正交基方向校验通过。

这份相机数值回执不涵盖原 spectator/demo/特殊模式、相机原点/bob/fall视觉、完整客户端渲染或主观后坐体验。默认画面追踪系数不能直接替代弹道系数，更不能再次叠加旧 generic recoilOffset。

独立只读审阅：asset_audit 已检查 accuracy / punch / rifle-handling 的 per-weapon 保留、BEFORE/AFTER射击状态、player punch切枪保留与单位边界，未发现P1/P2；该审阅没有替代原生oracle，也没有声称完整网络JSON schema已验证。共享 Simulation/runtime/scene 的正式接入与真实浏览器验收由父任务另行完成。


## 2026-09-09 共享模拟与实际浏览器接入

原 AK/M4 状态现已接入 `Simulation`、网络快照、预测重演与 `Art` 相机。Source 玩家携带每枪 accuracy、player punch 和持久化 fallVelocity；相同 JSON snapshot.time 后逐条重演未确认命令，覆盖开火、换弹、跳跃、落地，310tick状态和弹药/冷却逐项一致。原 movement-punch→fall/land→weapon-accuracy→accepted shot 顺序保留。独立护甲、碰撞与完整原动作时序的边界不因本改动改变。

服务器为接受的子弹自行产生 seed，记录 BEFORE inaccuracy/spread/recoilIndex/punch、浏览器输入角与实际射线。种子生成使用原 SHA1 字节构造；当前进程的 crypto entropy/monotonic clock 不声称再现原引擎其他事件的全局 RNG 历史。客户端只预测确定性的射击后状态、声音、抛壳/枪口，绝不使用假 server seed 预测命中。实际射线回传后仍绘制一次，不被此前声音去重吞掉，也不会重复抛壳。现有 generic shotHeat 仅保留动作/AI节奏，不能进入 Source 实际散布或镜头。

相机使用 native camera basis（viewPunch + aim×2×.45），不再叠加 generic kick；实际弹道使用独立 aim×2 basis。完整76测试文件470项通过、全tsc通过，候选构建与服务重启完成。真实训练浏览器通过连续射击、空中射击、蹲伏、落地和换弹，`output/playwright/source-r4-native-handling-gpu.json` 留下16实际子弹及589相机帧，其中141帧有明显后坐；换弹恢复30发，原状态恢复检查通过，errors[]。`scripts/validate-source-handling-browser.ts` 回算实际ray误差≤1.12e-16、相机方向误差≤7.49e-8，`output/tests/source-handling-browser-validation.json`。

此处验收仍使用当前60Hz调度与Rapier碰撞响应；原IN_SPEED、梯子、水、stamina、完整高冲击落地视觉/伤害、原64tick命令调度及换弹/拔枪解锁仍需继续对应，不把有界状态校验称为完整原引擎或主观手感完全相同。

随后实际 HTTP LAN 双浏览器 M4 也通过，`output/playwright/source-r4-native-handling-lan-gpu.json`：两端相同 handling/landing 仿真身份、2个实际M4子弹状态回读、移动/蹲伏/换弹/检视/音频正常，errors[]、退出rooms[]。仍为一台Mac上的两个浏览器。实际SDK旧/缺失版本拒绝、正确双端、席位与清房已重新验证，见 `output/tests/source-simulation-identity.json`。
