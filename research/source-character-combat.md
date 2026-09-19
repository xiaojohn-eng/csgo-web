# 原版 Dust2 T / AK 动作数据与受限混合采样

实际 App740 build 12426148 中，已解码 AK 相关 28 个序列所引用的 92 个动作描述、1,427 个源帧。完成 3,240 组私有姿态采样，但这不是 CS:GO 客户端完整动画系统验收：运行时 cvar 覆盖、IK 和角色材质仍有明确未完成项。安装的官方 Linux64 server 二进制已独立确认 anim_3wayblend 编译默认值为 1。

## 交付文件

- `scripts/import-source-character.py -- --sample-combat`：完成安装门禁、VPK/模型元数据、24B layer 读取，再调用独立采样器。
- `scripts/source-character-animation.py`：当前 FRAMEANIM 解码与公开 Source1 算法的有界采样器，不修改 SourceIO。
- `.reference-assets/source-exports/character-t/combat-audit.json`：源文件 SHA、每块字段/字节检查和采样摘要。
- `character-t/combat/source-animation-metadata.json`：28 个完整 sequence 元数据、92 个 descriptors、原 pose keys、骨权重、活动和事件。
- `character-t/combat/decoded-frames.npz`：按 animation-MDL 自身71骨顺序保存原局部 position/quaternion；非原作生成动作。
- `character-t/combat/sampled-poses.json`：采样指标及 40 份映射回主模型71骨的世界矩阵快照。

## 骨表和格式核验

主模型为 Dust2 配置首项 `models/player/tm_leet_varianta.mdl`；动作来自 `models/player/t_animations.mdl/.ani`。两骨表都为71条，但只有69个同名骨且父骨名字一致。主模型独有 weapon_hand_L/R，动画模型独有 ValveBiped.ValveBiped/Proxy_clip。解码先用动画模型自身骨表，再按名字映射；主模型独有辅助骨保留原局部 rest、跟随各自手骨。

原 include `taunt_animations.mdl` 缺失，只限制那条分支；上述常规移动/AK分支的 MDL/ANI 已成功读取。ANI 5,446,980 bytes、VPK CRC32 5ee2ec28，原文件 SHA 见 combat-audit.dependencies。

Pinned SourceIO 有两个已由实际数据揭示的问题，本脚本只做进程内/读取适配：

- AutoLayer 应为 int16 sequence、int16 pose、int32 flags、4float，共24B。旧读取28B会将第二层错位；真实 Reload_AK 曾读出 float 位模式作为 flags。现按原 sequence offset 重读，验证所有 layer target 都指向真实序列。
- FRAMEANIM 允许 constant 与 per-frame 通道同时存在。采样器逐帧检查耗用字节等于 frame_length；绝对动作缺省本动画MDL的 rest，delta 缺省零位移与单位四元数。所有1,427帧有限且四元数模长在可接受编码范围。

## 原参数和实际活动映射

| pose 参数 | 原范围 | loop |
| --- | --- | --- |
| move_yaw | -180 … 180 | 360 |
| body_pitch | -90 … 90 | 360 |
| body_yaw | -90 … 90 | 360 |
| move_y | -1 … 1 | 0 |
| move_x | -1 … 1 | 0 |

移动9way的参数顺序是 move_y、move_x；不是按变量名字推断矩阵方向。move_y keys=[-1,0,1]，move_x keys=[1,0,-1]，第二轴反向。瞄准9way顺序为 body_yaw、body_pitch；keys分别[-60,0,60]与[-70,0,70]。采样只覆盖有效原范围，不补造游戏角度限制。

| 下身序列 | 原 activity_name | numeric activity | AK 上身/开火 |
| --- | --- | ---: | --- |
| Idle_lower | ACT_IDLE | -1 | Idle_Upper_AK / Idle_Shoot_AK |
| walk_lower | ACT_WALK | -1 | Walk_Upper_AK / Walk_Shoot_AK |
| Run_lower | ACT_RUN | -1 | Run_Upper_AK / Run_Shoot_AK |
| Crouch_Idle_Lower | ACT_CROUCHIDLE | -1 | Crouch_Idle_Upper_AK / Crouch_Idle_Shoot_AK |
| Crouch_walk_lower | ACT_RUN_CROUCH | -1 | Crouch_Walk_Upper_AK / Crouch_Walk_Shoot_AK |

文件中的 numeric activity 为 -1，保留原 activity_name，不把未运行时解析的数字猜成引擎枚举。AK Upper 依次自动叠加 Aim（delta/post）和 HandPos（按骨遮罩覆盖）；Shoot 为 delta/post（flags20）。Aim/HandPos/Shoot 没有单独 activity_name，不能用名字推测它们独立驱动整个角色。

Run_lower 的 lfoot/rfoot 周期为 .80/.35；walk_lower 为 .78125/.3125；Crouch_walk_lower 为 .7083333/.2083333。保留原 event ID/options，不把 metadata 直接当已接入脚步声音。Reload_AK 的 AE_CL_EJECT_MAG/.21917808 与 AE_CL_EJECT_MAG_UNHIDE/.32876712 同样仅记录。

## 混合算法依据及不能越过的边界

使用固定 Valve SDK2013 commit 的 [bone_setup.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bone_setup.cpp) 中 Studio_LocalPoseParameter、CalcPoseSingle、BlendBones、SlerpBones 与 AddSequenceLayers 作为公开合成参考；数学操作依据同 commit mathlib_base.cpp。本地只读源文件和 SHA 位于 character-t/sdk-reference/manifest.json。公开 SDK 不包含这里全部 CS:GO FRAMEANIM 私有实现，因此帧字节解码与公开合成算法是两层不同证据。

同序列插值遵循归一化线性四元数；序列累积用球面插值与原骨权重；delta/post 右乘增量四元数并叠加局部位移。只接受当前真实 layer flags=0，按原顺序处理默认周期 ramp。未支持的 world/local/realtime/特殊layer会明确拒绝，不悄悄忽略。

公开 SDK 的 CalcPoseSingle 在内部网格存在 anim_3wayblend 两分支（公开默认1），而 Studio_SeqAnims 返回的四个权重仅适用于其对应用途，不能直接替代最终姿态合成。这里同时保留3way与bilinear；当前安装构建的运行 cvar 尚未验证。

新增二进制证据：`scripts/inspect-source-animation-cvar.py` 只读检查官方 `csgo/bin/linux64/server_client.so`（SHA256 `5dc259006b3251e48c39cf30a86aae149da36c975fda054d0314907b7391845c`）。ELF `.init_array` 包含初始化函数 `0x5ea230`；调用 `0x5ea25a` 的 RSI 指向 `anim_3wayblend`，RDX 指向原字符串 `1`，ECX 为 `0x2000`，R8 指向对应帮助文字。继续跟进构造/创建路径，确认 RDX 进入保留默认字符串、复制字符串与数值转换路径。脚本断言精确指令和地址，另存 llvm-objdump 指令窗口，排除了仅凭相邻 strings 猜默认值。输出 `combat/anim-3wayblend-default.json` 与 `anim-3wayblend-disassembly.txt`。这确认该服务端构建的编译默认值，不宣称已运行原客户端或观察运行时覆盖。

## 实际数值采样

- 5状态 × 9方向 × 3瞄准 × 4相位 × 3开火权重 × 2分支 = 3,240 组。
- 576 个网格角点直接对照已解码原帧：位置误差 0.0，四元数 dot 误差 4.44e-16。
- 全部输出有限；四元数模长最大误差 2.22e-16。开火权重0恢复误差0，开火骨遮罩外所有骨变化0。
- 3way/bilinear 最大共同骨局部位移差 1.246199 原单位，旋转差 0.295766 rad；映射后主骨世界位置最大差 9.442500 原单位。
- 最坏样本 `{'state': 'Run', 'parameters': {'move_x': 0.707, 'move_y': -0.707, 'body_yaw': 0, 'body_pitch': 0}, 'cycle': 0.97, 'bone': 'ValveBiped.Bip01_R_Toe0', 'sourceUnits': 9.442500350854633}`。这是算法选择会影响画面的实际证据，不能视作可随意替换的实现细节。

这些是离散覆盖和源数据转换证据，不是连续域证明或原客户端比对。原 locomotion descriptors 带 IK rules（多处4条）和 movement records，本轮没有求解 IK、提取运动、实现 client transitions、procedural bones 或游戏命中体积。

## 材质和 GPU 状态

根任务实拍两测试片段的浏览器截图并完成71骨/11,320面回读；我实际看图并对照原纹理。几何和测试姿态形态正常，上衣与裤装却严重发白，与原深褐上衣/蓝灰牛仔明显不符。`character-t/visual-review.json` 明确 materialPassed=false，数值通过不能替代这项失败。下一轮接入应使用原三套 VMT/九张纹理，避免沿用当前 SourceIO 通用PBR材质。

原字段：basetexture、bumpmap、phongexponenttexture；上/下身 $phongboost25、$phongfresnelranges [0 .1 1]、$rimlight1/$rimmask1；头部$rimlight0。原通道不等价于通用 metallic/roughness 数据，需依 root 已审阅的 Source Phong 实现复核。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-character.py -- --sample-combat
```

当前没有修改 game/public，也没有触碰源 MDL/VTF/ANI 或 SourceIO 仓库。
