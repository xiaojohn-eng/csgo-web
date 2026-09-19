# 皮肤、检视与界面独立审阅

日期：2026-09-08。范围：本轮 `game/skins.ts`、`game/weapon-inspect.ts`、`game/runtime.ts`、`game/scene.ts`、`game/skin-catalog.ts`、`app/page.tsx` 及两个新增 UI 组件；服务器/快照代码只追踪皮肤字段，不扩大旧工程问题。

## 结论

未发现本轮皮肤/检视路径的阻断缺陷。代码及运行时检查支持：涂装确实能命中当前模型材质，克隆不会污染共享原材质，重复应用同一 ID 不重新分配，退出涂装可恢复原件，检视可取消并回到持枪姿态。

独立查看根代理提供的真实浏览器截图 `output/playwright/aurora-skin.png`：M4 枪身和弹匣已呈现青紫色涂装；手套和袖口仍为深色。左侧六张皮肤卡全部显示，极光选中黄框、勾选标记、底部“已装备 极光”与枪械颜色一致。中文主标题和操作清楚，检视按钮完整可见。

该截图支持本地 M4 极光涂装的实际渲染结论；它不能独自证明三把枪全部六种皮肤、远端客户端渲染或跨设备 LAN 均已通过。根代理另报告 `skin=aurora`、`paintedMeshes=5`、`localStorage=aurora`、菜单快照约 56 FPS；这些数值是根代理实测转述，本代理独立读取的是截图与下列源码/运行时证据。

## 已核实证据

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 实际 GLB 材质清单 | 读取 GLB JSON；M4/P12/DMR 分别有 5/4/6 个 primitive 的原材质名命中涂装白名单 | 只读 JSON 未解码完整模型；不代替三把枪逐色截图 |
| Shader 应用 | 6 种皮肤的独立纯运行时检查；非默认色均注入 `diffuseColor.rgb = pigment` | 本地 GPU 编译另由 M4 极光截图支持 |
| 材质隔离 | 用两个共用原材质的实例验证：给 A 涂装，B 的材质指针和人体材质保持原值 | 针对当前克隆路径，未覆盖未来新增外部材质插件 |
| 切换和释放 | 重复同 ID 保持材质指针；`disposeWeaponSkin` 恢复原材质；只 dispose 自有克隆，纹理仍共享 | 未做长时间 GPU 显存压力测试 |
| CPU 更新路径 | `WeakMap` 命中同 ID 立即返回；可见角色每帧调用不会每帧 traverse 或 clone | 快速反复切色仍会创建/销毁材质；正常装备切换开销可控，未声称测得 CPU 时间 |
| 皮肤联机字段 | 服务端只接受 catalog 中 ID；写入当前 client 对应 Player；snapshot 和 RemoteTimeline 的对象展开保留字段 | 代码链条存在，仍需第二客户端实际看见涂装 |
| 重连与持久化 | 席位首次同步/恢复时重发 skin；页面 localStorage 读写有效 ID | 读回数值来自根代理浏览器测量；本代理未操作其浏览器 |
| 检视中断 | 开火、R、1/2、清输入、切枪、换弹/瞄准/死亡路径均取消；运行时检查验证权重衰减恢复 | 只是整体武器/手臂组的观赏转动，未新增每把枪专属 authored inspect clip |
| UI 可读性 | 截图中 6 卡、选中态、装备文本和检视操作完整；主体信息可读 | 7px 英文工艺副标题较小，只作冗余辅助信息；小屏/键盘实玩未在本次截图覆盖 |
| UI 无障碍代码 | 原生 button、`aria-pressed`、live status、focus-visible、减少动态偏好；LAN 输入可全选且复制失败有说明 | 未执行屏幕阅读器测试 |
| 静态检查 | 两个新组件 `oxlint` 无诊断；最新一轮 `tsc` 无两个组件的错误 | 当时全局 tsc 仍有 network_audit 正在收尾的 JSON unknown / networkInterfaces mock 类型错误；不能将其描述为全项目通过 |

## 具体低优先级风险

**P3：武器库可见时的 F 快捷键未排除覆盖其上的模态窗口。** `components/skin-selector.tsx` 的 window keydown 处理器检查输入框、Pointer Lock 和组件是否有布局矩形，但没有检查事件目标是否位于其他 `role="dialog"` / `role="slider"`。在武器库打开设置窗口、焦点落在非输入控件时按 F，仍可能触发背景武器检视。它不影响对战数据或皮肤选择，但快捷键范围应收窄：模态窗口打开期间不触发后台检视，或增加对 dialog/slider 目标的排除。此项为只读代码审阅发现，本轮未改根代理接入逻辑。

## 发布表述与剩余验证

- 当前是 **一套全局皮肤选择应用于所有已缓存武器**，服务器也只有 `Player.skin` 字段。不能表述成已经实现每把枪独立持久化配装；若需要此能力，应明确新增 `skinByWeapon` 合同。
- 当前 shader 提供配色和程序图案，没有实现随机种子、磨损、贴纸、逐个原作皮肤素材。应称本项目的六种涂装，不称完整原作皮肤系统。
- `assetAudit().firstPerson.detail.materialPolicy` 仍沿用旧的 “unchanged embedded PBR; no tint/atlas replacement” 描述。对已应用新皮肤的实例，该描述不再全面；建议在顶层审计字段中明确原始资产保持不变、实例材质已涂装，避免证据措辞互相冲突。
- 最后需要保留：第二客户端涂装可见证据、切回原厂截图、三枪逐色可见性、检视→开火/换弹/切枪/暂停的实玩录像、连续换肤/进出对局的内存趋势。这些是剩余验收，非本轮已验证结果。

## 本代理交付

- `components/skin-selector.tsx` 与 `components/skin-selector.css`：六款配色网格、选中/装备状态、检视按钮与 F。
- `components/lan-addresses.tsx` 与 `components/lan-addresses.css`：同源读取 `/api/server-info`，优先 `lanUrls`、兼容 `urls`，排除 loopback，HTTP LAN 复制回退、手动全选、刷新/空态/错误态。
- [reference-research.md](../../research/reference-research.md) 位于工程父目录的 `research/`，包含官方来源、素材边界、技术路径及分轨验收矩阵。

上述组件由根代理接入公共页面；本代理未修改 `app/page.tsx`、公共样式或根代理的运行时实现，未操作其浏览器。
