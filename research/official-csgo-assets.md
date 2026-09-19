# 官方 CS:GO 资源可取得性与本机复刻路线

核验日期：2026-09-08。研究执行人：reference_research。最初阶段仅只读查询公开网页、Steam Store API 和安装器 HTTP HEAD；随后主任务取得官方 SteamCMD 元数据和官方 Workbench ZIP，本研究独立读取相应日志及 ZIP 清单。未登录私人账号；后续获授权的项目内 SourceIO 加载验证见 [smoke 回执](sourceio-smoke.md)，未全局安装插件。随后完整 App 740 匿名安装和 validate 已成功；本研究已独立读取 ACF 终态及真实 AK47/手臂资源。详见 [真实武器审计](source-weapon-audit.md)。

## 可立即使用的结论

1. **官方 SteamCMD 当前匿名会话已成功读取 App 740 元数据。** `freetodownload=1`，public BuildID **12426148**，两个 depot 合计 **34,705,746,562 字节落盘 / 14,706,250,528 字节传输**，约 **32.32 GiB / 13.70 GiB**。本机最初没有 Steam 目录，不能据此推断原作素材无法取得。当前完整安装也已确认：官方日志 `Success! App '740' fully installed.`，ACF `StateFlags=4`、`UpdateResult=0`、字节下载/解包数相等。[本机官方客户端回执](../output/steamcmd-app740-tcp.log)
2. **当前还有独立 CS:GO App 4465480。** Valve 官方商店明确显示开发/发行者 Valve、免费游玩、未列入商店搜索。公开 API 当前标记 Windows/Linux 支持、macOS 不支持。App 730 当前名称是 Counter-Strike 2。不要继续把“旧版只能依靠 730 的旧 beta”当作现状。[官方 CS:GO 商店](https://store.steampowered.com/app/4465480/CounterStrikeGlobal_Offensive/)、[官方 App 4465480 API](https://store.steampowered.com/api/appdetails?appids=4465480&l=english)、[官方 App 730 API](https://store.steampowered.com/api/appdetails?appids=730&l=english)
3. **官方小规模武器包已到本机并完成清点。** 当前 Workshop Resources 页面列出旧 Workbench materials 和明确标为 CS2 的另一包；已取得的旧包含 **34 OBJ + 34 UV TGA + 8 参数 TXT**，没有骨骼、动画、VMT/VTF 或 MTL。它是几何/UV基准，不能当完整原作武器资产。[Valve Workshop Resources](https://www.counter-strike.net/workshop/workshopresources)、[本机清单](workbench-inventory.json)
4. **公开取得与跨引擎使用授权是两件事。** Steam 的个人使用、开发工具、专服和内容使用条款有各自范围；本轮未查到一项允许把所有 CS:GO 资产普遍移植并重新分发的开放许可证。官方安装原作/专服作本机对照有直接产品路径；不能把“免费匿名下载”表述成“Valve 原作资产已开源”。[Steam Subscriber Agreement，§2A/2C/2E/2G](https://store.steampowered.com/subscriber_agreement/)

## 证据等级与版本选择

App 740 的 BuildID、depot、精确字节量现已由 **官方 SteamCMD 当前匿名会话**直接确认；App 4465480 的官方商店身份已直接读取，其 BuildID/depot/字节量仍来自明确标注的 **SteamDB 第三方元数据镜像**。未从 SteamDB 下载任何游戏资源。

| 路线 | 当前观察 | 版本/规模 | 尚未验证 |
| --- | --- | --- | --- |
| App 740，CS:GO Dedicated Server | 官方匿名会话成功，元数据 Tool、Windows/Linux、freetodownload=1 | public BuildID **12426148**；构建 2023-10-12 17:08:03 UTC，发布切换 2023-10-13 01:45:07 UTC；两 depot 总计 **32.32 GiB / 13.70 GiB** | 匿名 app_update validate 已成功；完整内容覆盖及原作客户端行为尚待逐项验收 |
| App 4465480，独立 CS:GO | 官方免费、未列出搜索；Windows/Linux | 镜像 public BuildID **22100934**，构建 2026-02-26 00:30:45 UTC；镜像全 OS/语言合计 **32.72 GiB / 13.94 GiB** | 是否匿名可装；客户端能否本机运行；相对 2023 legacy 的逻辑/内容差异 |
| App 730，CS2 | 官方 API 名称已是 Counter-Strike 2 | 官方商店 PC/Linux最低存储要求 **85 GB**，这不是精确下载量 | 旧 csgo_legacy 分支当前是否仍可用；此轮不依赖这条旧命令 |

来源：[App 740 depots](https://steamdb.info/app/740/depots/)、[App 4465480 depots](https://steamdb.info/app/4465480/depots/)、[App 730 官方 API](https://store.steampowered.com/api/appdetails?appids=730&l=english)。4465480 商店沿用的 2012-08-21 发行日期和 15 GB 最低要求，不能用来推导当前 BuildID 日期或完整安装体积。残留 Mac depot 也不等于当前官方支持 macOS。

App 740 官方分项：Depot **731：manifest 1224088799001669801，size 32,722,411,363，download 13,644,292,112 字节**；Depot **740：manifest 6998097922547485721，size 1,983,335,199，download 1,061,958,416 字节**。[官方客户端原始元数据](../output/steamcmd-app740-tcp.log)

740 depot 的镜像文件列表有 `srcds.exe`、`srcds_linux`、`srcds_run`、DLL/SO，以及 13 个 VPK、约 1.25 GiB。这说明所引用内容并非空工具壳，但不能据此逐项保证 Common 中每个地图、皮肤、模型或音效齐全。[Depot 740 文件列表镜像](https://steamdb.info/depot/740/)

**同 depot 不同应用引用版本的陷阱：** 直接打开 Depot 731 默认页，当前展示的是 App 730 的新 public 内容：manifest **2451774155290977500**，2026-09-07，仅 `game/bin/content_built_from_cl.txt` **8 字节**。App 740 官方元数据则明确引用上述 **1224088799001669801**、30.48 GiB 内容。应保存 **AppID + branch + BuildID + 每个 manifest ID**，不能只保存“731 最新”。[Depot 731 默认文件页镜像](https://steamdb.info/depot/731/)

本机执行状态：研究开始时默认 Steam 目录不存在；主任务启动官方 SteamCMD 后创建了 `~/Library/Application Support/Steam/logs`，这只表示客户端初始化。客户端实际版本 **1788292693**；首试到 `Waiting for user info...ERROR! (Timed out)`，第二次带 `-tcp` 参数的试验匿名/user info 成功并输出完整 App 740 元数据。尚未对比实际传输通道，因此**不能归因于 `-tcp` 修复了问题**。元数据成功本身不等于游戏下载完成；本轮后续另有 [完整安装日志](../output/steamcmd-download740.log) 和 [ACF终态](../.reference-assets/csgo-legacy/steamapps/appmanifest_740.acf) 证实安装成功。[首试日志](../output/steamcmd-app740.log)、[成功元数据日志](../output/steamcmd-app740-tcp.log)

可对照版本的优先次序：先固定 App 740 public 所指向的 2023-10 内容，作为专服和资产基线；若需完整原作客户端实机对照，评估当前官方 App 4465480，并比较共同 VPK/地图文件的哈希。其 2026 BuildID 不能自动证明游戏机制有更新，也不能自动证明它与 2023 构建完全相同。

## 官方 SteamCMD 路径

Valve 官方 Steamworks 文档明确说明：发行者把专服应用加入 dedicated server package 后，会进入匿名 SteamCMD 包 **17906**；同时提供 SteamCMD 匿名安装模式的背景。该官方规则结合公开包列表，为 App 740 匿名路径提供较强证据；实际下载仍以官方客户端结果为准。[Distributing Your Dedicated Game Server](https://partner.steamgames.com/doc/sdk/uploading/distributing_gs)

macOS 安装器可直接使用 Valve 域名：

- [media.steampowered.com 官方安装器](https://media.steampowered.com/client/installer/steamcmd_osx.tar.gz)
- [Steam CDN 同名安装器](https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz)

本轮最初分别 HEAD 实测均 HTTP 200、`Content-Length: 2523751`、`Last-Modified: Thu, 02 Apr 2020 20:21:43 GMT`、ETag `"5e864957-268267"`。HEAD 只验证 URL 和头部一致；主任务随后下载并运行官方包，见前述独立日志。官方 Steamworks 的 **SteamCmd on macOS** 段确认 `builder_osx`、`bash ./steamcmd.sh` 和首次启动自动更新，但该页面没有列独立 tarball URL。[Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading)

供后续执行者参考的分阶段命令（本研究未执行）：

```sh
# 在隔离的项目工具目录解包官方 SteamCMD 后，先让其初始化并读取元数据。
./steamcmd.sh +login anonymous +app_info_update 1 +app_info_print 740 +quit

# Mac 上明确请求 Linux 专服内容；force_install_dir 须填独立、非 public 的绝对路径。
./steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /ABSOLUTE/PRIVATE/csgo-740 +login anonymous +app_update 740 validate +quit
```

收到 `No subscription`、`Invalid platform`、`Missing configuration` 或仅下载极小占位内容时，保存原始日志并检查当前 AppID、分支、depot/manifest 和平台映射；这些错误的含义不同。App 4465480 免费不等于匿名拥有许可证，此轮未授权/未尝试私人账号登录。

磁盘预算：32.32 GiB 是官方元数据及本机 ACF 确认的安装内容量；下载压缩包、Steam 临时文件、解包、无损中间模型/贴图和浏览器产物会额外占用空间。建议为第一轮完整专服及转换保留 **80–120 GiB**，这是工程预算而非官方要求。SteamPipe 以压缩分块交付，更新可能并列构建新旧 pack 文件，所以传输量与峰值落盘不同。[SteamPipe 内容结构说明](https://partner.steamgames.com/doc/sdk/uploading)

## 更小的官方武器资源包

从 Valve Workshop Resources 当前 HTML 直接读取到：

- 旧 Workbench 包：[workbench_materials.zip?v=103](https://media.steampowered.com/apps/csgo/workshop/workbench_materials.zip?v=103)
- 页面明确标记的 CS2 包：[cs2_weapon_model_geometry.zip](https://media.steampowered.com/apps/csgo/images/workshop/workshop/cs2_weapon_model_geometry.zip)

主任务随后取得旧 Workbench ZIP，本研究只读清点：ZIP **12,675,411 字节**，SHA-256 **b6dfe90aca83ea32f1a4e3c5f488a6b1f3034440c52de65159a8c5c7aa05873e**；76 文件，合计解压 **87,559,000 字节**。`m4a4.obj` 有 9,570 个 `v`、18,154 个 `f`；`m4a1_s.obj` 有 12,521 个 `v`、17,705 个 `f`，不是自动等于三角形数；两者文件头标 2013-10-16，无 `mtllib/usemtl`。不能把 UV 线框图当武器原始表面贴图，也不能把 CS2 新几何混入 CS:GO 而不标注。[本机清单](workbench-inventory.json)、[官方资源页面](https://www.counter-strike.net/workshop/workshopresources)

## 下载后必须做的资产清点与转换

以下是基于 Source 原始公开结构的**工程提案**，并非本轮已证实 App 740 的完整文件清单。Valve 的 Source SDK 2013 公共代码可查 BSP、Studio 模型、VTF 结构，但不是完整 CS:GO 源码，也不是 CS:GO 美术资产开放许可；实际解析器必须检查所下载二进制版本、分支差异和边界。[Valve Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013)

| 内容 | 下载后先核验 | 浏览器路线与损失边界 |
| --- | --- | --- |
| 地图 | `maps/*.bsp`、依赖 VPK、静态道具、材质、实体、碰撞、光照数据 | BSP render mesh、displacement、static props 转可绘制网格；lightmap 保持 UV；brush/碰撞另转 Rapier。可见网格不等于玩法碰撞。先做 Dust II 一个完整区域。 |
| 角色/武器 | `.mdl` 及其 `.vvd/.vtx/.phy/.ani` 等实际伴随文件、bones、attachments、sequences、hitboxes | 保留 bind pose、骨名、权重、动画时长后转 glTF；先无损验证，再压缩。编译模型的 clips 不等于 Source 动画状态机，瞄准、移动、上下半身叠加仍需实机对照。 |
| 材质/皮肤 | VMT 参数、VTF mip/格式、base/detail/normal/masks/cubemaps、paint-kit 配置 | VTF 解码后保持色彩空间和法线约定；VMT 到 Three shader 参数映射。Phong、环境反射、磨损复合并非 glTF PBR 一键等价。 |
| 特效/声音 | 实际 PCF/声音事件脚本、WAV/MP3、枪口/弹壳 attachments | 建事件时间轴和 Three 粒子复现；来源文件不自动带来正确触发、空间衰减、遮挡或游戏逻辑。 |
| 玩法参数 | 实际武器脚本、地图实体、导航与游戏模式配置 | 保存原值并记录单位；移动、弹道、后坐力、动画选择和网络预测仍须用原作运行结果验证。不能从资产完整推导规则完全一致。 |

结构原始来源：[Valve BSP header](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspfile.h)、[Valve Studio header](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/studio.h)、[Valve VTF interface](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/vtf/vtf.h)。坐标轴、单位和骨骼朝向必须用实际模型尺寸/地图已知距离校准，避免把默认转换比例当成证据。

官方武器皮肤指南说明纹理和 finish definition 的复合、UV/三平面映射、随机偏移/旋转及磨损，而非简单替换一张颜色贴图。**当前网页已有 CS2 Workshop Item Editor 和 PBR 新段落**，保留 legacy/CS2 版本标签；其共同概念可参考，不能把现页所有细节都作为 2023 CS:GO 着色实现的精确规格。[Valve Weapon Finishes Guide](https://www.counter-strike.net/workshop/workshopfinishes)

## 第一轮验收矩阵

| 关口 | 可复核产物 | 通过条件 |
| --- | --- | --- |
| 匿名取得 | 官方 SteamCMD 日志、appmanifest、depot manifests | anonymous 会话成功、App 740 安装完成；记录完整 BuildID/manifest，而非只看进度百分比 |
| 资产存在 | VPK 索引与文件哈希清单 | 至少找到指定地图、M4、指定角色及全部直接材质/动画依赖；区分缺失、共享依赖和无需下载的内容 |
| 转换保真 | 原文件→转换文件映射、比例/骨链/UV/动画采样对照 | 无丢骨/丢材质/丢依赖；绑定和动画可重复；透明/法线/磨损等差异逐项记录 |
| 原作可对照 | 同版本客户端或可验证的原作录制，固定 FOV/pose/光照/时间 | 记录参考版本、视角和场景；不能拿不同版本截图主观判定完全一致 |
| 浏览器实际效果 | 真实 GPU 截图、动作/射击视频、LAN 两端状态、性能采样 | 资源实际加载且动作运行；玩法/渲染/联机分别验收，CPU 数值通过不代替视觉和操作验收 |

建议下一步：**官方 App 740 匿名取得 → 文件清点 → 一把 M4、一个角色、Dust II 一个区域**。在这条路线是否成立得到实物证据后，再决定原作资源与现有原创替代资产的覆盖范围；现有 C02/M4 原创替代的完成度不代表原作还原度。

## 本轮事实边界

- 已确认：Valve 商店/API 应用身份；官方匿名专服分发机制；macOS 官方 SteamCMD 初始化和匿名 App 740 元数据，含精确 manifests/字节量；官方 Workbench ZIP 实物清单；4465480 depot/构建信息仍为镜像证据。
- 后续已补实物回执：App 740 完整匿名下载/validate；原 VPK 中 AK47 的 MDL/VVD/VTX/ANI/VMT/VTF 与 Dust2 原T手臂；4段原FPS绝对动作、双蒙皮GLB及独立Three读回。见 [真实武器审计](source-weapon-audit.md)。原作客户端启动仍未验证，Source材质等价仍未完成。
- 未确认：全部原作素材覆盖、4465480 匿名 entitlement、Mac 原作游戏实际运行能力、跨引擎资产使用的普遍授权。
- 官方 Valve Developer Community 的 SteamCMD/CS:GO 专服/CS2 专服页面本轮返回 403；旧 Steam Support legacy FAQ 只得到动态外壳。没有把未读到的内容当作当前已核验事实。Steam Store API 对 App 740 返回 success=false 也不代表 SteamCMD 专服不可取得。

同目录 [official-csgo-assets-evidence.json](official-csgo-assets-evidence.json) 保存本轮无账号官方 Store API 摘要和安装器 HEAD 回执；正文 SteamDB 数据是明确标注的元数据镜像，不能误称官方 API 回执。
