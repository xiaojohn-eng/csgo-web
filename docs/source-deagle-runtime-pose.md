# 原沙漠之鹰权威姿态与命中盒

`createSourceDeaglePoseDriver(index, id)` 与 `SourcePoseDriver` 接口兼容。`index` 是 `loadSourceDeagleCharacter` / 服务端等价加载器返回的 `poseIndex`，`id` 是包含原人物资产身份及 `SOURCE_DEAGLE_POSE_DRIVER_VERSION` 的运行时版本。`advance` 保留实际 `weapon='deagle'`，按原最大速度 230 Source units/s 计算现有地面选择器的步行阈值；临时选择标记不回写玩家。

`pistolPose(player, now)` 要求匹配的 T/CT、武器、当前 `sourcePoseVersion`、`sourcePose` 和 `sourceDeagle.command`。动作来自 `sourceDeagle.action={activity,time,generation}`。输出沿用 `sourcePistolPose` 结构，并增加可 JSON 序列化的 `deagleWorldVisibility.events`。命令类型通过局部结构兼容，没有修改公共 Player 类型。

| 原活动 | 原人物层 | 原世界枪层 | 原持续时间 |
| --- | --- | --- | --- |
| 183 draw | 无附加层 | 无附加层 | 未虚构 draw clip |
| 192 fire / 195 最后一发 | 原状态的 `*_Shoot_Pistol` | `pistol_fire` / `pistol_fire_crouch` | 世界枪 13 帧/30 fps，即 0.4 秒 |
| 194 reload | `Reload_PISTOL` | 四个站立/蹲下/移动 reload 变体 | T/CT 人物与世界枪均 78 帧/30 fps，即 77/30 秒 |

第一人称原 reload 为 67 帧/30 fps，即 2.2 秒；不能用这个时长缩短人物或世界枪动作。世界枪没有单独的 `shoot_empty`，活动 195 只在第一人称选择该原 clip。世界枪 reload 原 `AE_CL_EJECT_MAG` / `AE_CL_EJECT_MAG_UNHIDE` cycle 分别为 `0.07792207598686218` / `0.19480518996715546`。

远端渲染与命中回溯必须调用 `interpolateSourceDeaglePose(a,b,t,span)`。它复用公共身体/动作时钟插值，再按新时刻重算原弹匣事件，保留换代边界和 draw 取消。旧的通用手枪插值不识别 Deagle 弹匣元数据。

`createSourceDeagleHitboxes(index,id)` 位于 `game/source-deagle-hitboxes.ts`。它将渲染使用的完整 Deagle 身体层结果交给现有原旋转 OBB 实现；只命中人物，不命中世界枪。缺失完整姿态、过期版本、错误团队或武器身份都会拒绝。

验证：`tests/source-deagle-runtime-pose.test.ts` 和 `tests/source-deagle-hitboxes.test.ts` 共 10 项通过，类型检查通过。覆盖 T/CT 五种地面状态、四种动作、各 45 个原世界枪瞄准角点、独立原时长、JSON 弹匣事件跨界、195 连发换代、draw 取消、230 速度阈值和身份拒绝。命中盒测试先证明 Deagle 与已执行原生 CPU 语料对应的人物原骨骼/序列/帧 SHA/命中盒字节相同，再重放适用的原生射线；距离误差小于 1e-6 米，命中组一致，原生等 fraction 的重叠手臂边界保留原限制。

仍未声称完整 `CCSGOPlayerAnimState` 状态转移、IK、GPU 实机或完整游戏验收；这里沿用已有显式地面选择器和其原序列采样规则。
