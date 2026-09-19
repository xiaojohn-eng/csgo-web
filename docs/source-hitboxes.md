# 原 App740 命中体取证与纯查询

`game/source-hitboxes.ts` 提供 `createSourceHitboxes(poseIndex, poseVersion)`，由 SourceScenario `hitboxesByTeam` 按 T / CT 分派。当前两套原模型共44个命中体都是带局部旋转的 OBB，使用同一个权威 `sourcePose` 采样骨矩阵。已经接入实际 Simulation 原眼高/地图墙/历史回溯；不是 C02 或移动 AABB 的替代命中体。

## 当前构建的原指令证据

文件 `.reference-assets/csgo-legacy/csgo/bin/server.so`，App740 build12426148，SHA256 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`，ELF32 i386。只读定位，不启动原引擎，不修改资产。

- RTTI `14CBaseAnimating` 名字地址0x11b8b60，typeinfo0x11b8b74；primary vtable0x11b8be8，slot+0x40指向0x5b8270。该函数的参数/调用形状符合固定官方SDK [CBaseAnimating::TestHitboxes](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/baseanimating.cpp#L2836)。这是函数命名的交叉依据，私有CS:GO字段仍以本构建指令为准。
- 0x5b8327 调用0xec92d0。其0xec93a2/0xec93a5按 `index*64+index*4` 读取原68字节 hitbox。骨矩阵由 hitbox.bone 查独立矩阵表；T71骨与CT74骨没有混用。
- 0xec9444把 `hitbox+0x24` 地址送入0xef17b0，三float按度→弧度→sincos生成原AngleMatrix；0xec9465执行 `bone * angleMatrix`。不是把原extension全部当unused，也不是只旋转模型root。
- 0xec3456比较0与 `hitbox+0x30`，0xec345d在radius≤0跳OBB；正值路径对 `min/max` 两端点做骨变换，再连同radius交给0xf02480。该偏移的语义由消费链确认；本批T/CT44条都是0，因此全走旋转OBB。

原字段：bone+0，group+4，min+8，max+20，name offset+32，局部QAngle+36，radius+48；其余原字节仍保留，不推断更多语义。

0xec92d0还使用真实hitgroup优先级。每组内最近；头仅在不比胸/腹更远时优先，否则依次腹、胸、gear、手臂、generic、腿。这与“把所有盒统一取最近”不同，原指令跳表0x132ef74与8个合成CPU回执一起保存。

## 原CPU对照与精度边界

`scripts/probe-source-hitboxes.py` 使用固定本机官方文件SHA和关键机器码断言，再把原纯几何函数载入 Unicorn x86解释器。标准 `sincosf` 和 `memcpy` 是仅有的host回调；命中算法、旋转矩阵相乘和hitgroup选择执行原机器码。没有操作系统syscall、文件/网络callback或原进程注入。使用本地隔离venv：capstone5.0.6、pyelftools0.32、unicorn2.1.4。

- 原T与CT各10种真实连续姿态，覆盖站/走/跑/蹲静/蹲走、方向、俯仰、开火层；各22条射线见证，总440条。
- JS与原CPU全部命中组、头部判定、距离通过；最大距离差 **0.000000543625m**（0.544微米）。439条原hitbox编号完全相同。
- 唯一原编号边界：T样本2、目标上臂15，与前臂16交界。原CPU分别单测两个盒时float32 fraction完全相等，完整原循环保留16；双精度几何分出约0.111微米入口差，选择15。两者同group5、同伤害语义。`coincidentFloat32Surfaces`保留原单测回执；没有扩大几何epsilon，也不宣称bitwise复制SSE舍入。
- 接口严格拒绝缺pose/错误poseVersion、非单位射线、损坏68B metadata、正radius未验模型。当前工厂仅声明两套已验OBB，不能用来声称所有胶囊模型已支持。模型原生scale1；浏览器外层使用统一0.0254米/Source单位。
- actor变换按 `yaw+π/2` 后C轴变换，与原角色renderer一致；额外测试多个yaw/负高度/位移，不修改输入pose或共享index。reference独立只读检查未发现阻塞项。

## 真 Dust2 Simulation 验证

`scripts/source-combat-smoke.ts` 从私有官方完整 Dust2 碰撞、T/CT各自pose载入，调用真实 `Simulation.shoot`：T→CT与CT→T，目标站/蹲共4次均命中原head box11并造成伤害。射线见证点为原头盒内部上部，不使用肉眼猜测的头骨根点；头骨根点可能被原胸盒21正确挡住。原地图射线保持独立，头部先于地图墙。

另将目标当前根横移2m，用先前snapshot+SourcePose进行权威回溯，仍命中历史目标；不是把当前位置退回去测试。当前父任务合同已经允许原startsolid的distance0回执，不再过滤掉该情况。

- 300次单射线含完整原pose骨采样：平均 **0.098ms**，p99 **0.316ms**。
- 10个真实AI、1800个固定60Hz完整step：**24射击、7击杀**；平均 **1.239ms**，p95 **2.048ms**，p99 **2.534ms**，max **13.368ms**。包括原NAV、移动、权威姿态、snapshot历史和实际命中查询；这是该自然AI工作负载，不是假定每tick10人全自动连射的压力上界。无GPU/网络FPS主张。
- 所有测试world正常dispose，没有WASM borrow错误。

这是命中体几何/回溯/CPU链验收。当前既有weapon伤害/护甲/后坐力/散布、穿透、完整原AnimState、IK、death graph尚未因此获得原CS:GO等价证明；真实LAN交火、键鼠、画面与release仍由root联合验证。

## 可复现入口

```sh
npx tsx scripts/source-hitbox-fixtures.ts
.tools/source-binary-venv/bin/python scripts/probe-source-hitboxes.py
npx vitest run tests/source-hitboxes.test.ts
npx tsx scripts/source-combat-smoke.ts
npx tsc --noEmit
```

私有证据 `output/tests/source-hitbox-native.json`（原机器码函数SHA、440原射线、合成边界），`output/tests/source-hitbox-verification.json`（源码SHA与结果），`output/tests/source-combat.json`；日志 `output/source-hitbox-native.log`、`output/source-hitbox-provider-first.log`、`output/source-hitbox-provider-green.log`、`output/source-combat-smoke-final.log`。无私有官方资产时相应数值测试明确skip，不伪造原数据。

## 原手枪完整动作层的独立命中提供器（2026-09-09）

新增 `createSourcePistolHitboxes`，显式接收 `sourcePistolPose`，直接使用和四套手枪 renderer 相同的 `sampleSourcePistolCharacterPose(...).body.sourceWorldMatrices`。原 OBB/group 代码提取为带完整 sampler 的共享工厂，AK/M4 仍用原 rifle sampler；原440射线及共享Simulation回归通过。手枪尚未接入武器栏和服务端对战，所以此阶段不称可玩手枪已完成。

新 `scripts/probe-source-pistol-hitboxes.py` 使用独立 Python 全图姿态矩阵，执行同一原 App740 纯 CPU 指令。T/CT×Glock/USP共132姿态、2904射线，其中2640射线包含原 reload/silencer body layers。所有原 hitgroup 与头部判定一致，距离最大误差 **0.8515微米**，2899条原盒编号一致。

其余5条均为上/前臂交界。首次严格盒编号测试失败后，用 `scripts/probe-source-pistol-hitbox-ties.py` 分别执行每个原盒：5对的原 float32 fraction 与 group 全部相等。`output/tests/source-pistol-hitbox-ties-native.json` 逐条保留原程序返回值；只接受这5个已证实边界，不放宽几何epsilon，不将双精度排序称为完全复制SSE盒编号。两专项6项通过，`output/tests/source-pistol-hitbox-validation.json` 保留最终数值和边界。缺少完整pistol pose直接报错，不能静默使用少了reload/silencer层的base pose。
