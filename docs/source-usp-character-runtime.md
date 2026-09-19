# USP-S 人物与世界枪动作接入

`createSourceUSPPoseDriver(index, id)` 使用 `sourceUSP.action` 的活动、起始时间和代数，采样 App 740 build 12426148 的 T/CT 人物手枪图及 `w_pist_223.mdl` 世界枪图。独立版本为 `csgo-usp-pose-driver-12426148-r1`；Glock driver 和原 `SOURCE_PISTOL_POSE_DRIVER_VERSION` 保持原行为及原值。

图由 `loadServerSourcePistol` 从 `public/source/csgo-12426148/character-{t,ct}-usp/manifest.json` 加载并核对 manifest、pose JSON、帧数据 SHA。运行时从已验证图读取序列及原始事件，不另造动画关键帧。

| 输入活动 | 人物层 | 世界枪层 | 时钟依据 |
| --- | --- | --- | --- |
| 192 开火 | 公共 body pose 的 Pistol shoot 层 | `pistol_fire` / `pistol_fire_crouch` | 世界枪 13 帧、30 fps，即 0.4 秒 |
| 194 换弹 | `Reload_PISTOL` 及原自层 | `pistol_reload` 对应站姿、移动、蹲姿版本 | 人物/世界枪均 78 帧、30 fps，即 77/30 秒 |
| 220 安装消音器 | `Silencer_Attach_Pistol` 及原自层 | `pistol_silencer_ON` 对应站姿、移动、蹲姿版本 | 人物 146 帧、30 fps；世界枪 136 帧、30 fps |
| 221 卸下消音器 | `Silencer_Detach_Pistol` 及原自层 | `pistol_silencer_OFF` 对应站姿、移动、蹲姿版本 | 人物 145/30 秒；世界枪 4.5 秒 |
| 183 / 481 拔枪 | 保留公共 body pose | 无额外世界动作层 | 消音器显示取权威附件状态 |

世界枪没有单独的消音器 `crouch_moving` 序列，蹲行使用原 `crouch` 序列。普通换弹确有 `crouch_moving`。循环速率仍由已有 `sourceSequenceCycleRate` 原图采样器计算，表内帧数供核验，不用第一人称 65/30 秒换弹时长替换第三人称 77/30 秒时长。

`command.silencerAttached` 是权威附件状态，driver 不修改它。动作播放期间，世界模型里的原 `AE_CL_SHOW_SILENCER` / `AE_CL_HIDE_SILENCER` 决定手上零件是否可见：安装在 cycle 0 隐藏、约 0.11111111194 显示；卸下在 cycle 0 显示、约 0.88888889551 隐藏。动作完成及取消后再次拔枪时，显示回到权威附件状态。不能根据 `draw`、`draw_silenced`、`ON`、`OFF` 的字符串推断已经提交了附件切换。

换弹弹匣按原世界枪 `AE_CL_EJECT_MAG` / `AE_CL_EJECT_MAG_UNHIDE` 显隐。它们只影响展示，不补子弹、不执行 44/46/54 权威事件。`uspWorldVisibility` 将这些小型事件记录随 pose 一起序列化；`interpolateSourcePistolPose` 按观察到的动作时钟跨越事件边界，因此两次快照之间也能显示正确。新代动作到达起始时间后离散切换，不把安装动作插值进取消后的拔枪。

接入方应以该 driver 的输出同时供角色渲染及骨骼命中盒采样；仍需把本版本加入 USP simulation identity，设置队伍对应的 USP pose driver，并让共有地面状态选择器采用 USP 的 240 单位速度。此工作树不改 simulation、profiles、server、runtime 或当前 LAN 服务。

验收范围：T/CT 两图 × 五种地面状态 × 开火/换弹/安装/卸下，原帧时长与完整骨矩阵采样；SHOW/HIDE/弹匣边界；权威状态不被展示改写；网络中跨事件与取消后拔枪；错误图/缺失权威状态拒绝；现有 Glock 用例继续通过。

限制：原 `CCSGOPlayerAnimState` 状态转换权重、完整 IK、空中/落地/梯子/死亡状态未恢复；世界枪 `_alt` 开火变体的原生选择尚无独立运行证据，当前使用原普通开火变体。地面状态及整层开关沿用已标明的简化选择器。这次测试确认数据和运行契约，并不构成完整角色视觉复刻或实际双机 LAN 验收。
