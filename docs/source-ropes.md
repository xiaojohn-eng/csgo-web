# 原作的绳索（Dust2 自己的 142 条）

**现状：端口一条也没画。** 地图用 `move_rope` 与 `keyframe_rope` 挂了 **142 条**绳索（电线／缆绳），端口的转换器是带着 `load_ropes=False` 跑的，所以这些几何从来没进过场景。这不是可有可无的装饰——它是地图自己声明的几何。

读了什么、没读什么，一次说清：**键读完了，两个数（段数、长度）的来路也读完了，下垂还没读**。所以本轮把地图自己那些数与引擎的推导规则一并入库并校验，**仍不据此画线**——十个点怎么在两个端点之间松弛没读，画出来就是编的。

## 地图自己声明了什么

`scripts/probe-source-ropes.py` 从冻结的 BSP 自己的 entity lump（lump 0）读一遍，再与既有的 SourceIO 导出（它把所有键名转小写，故按大小写无关比较）逐条对齐，142 条逐字段相同：

| 项 | 值 |
| --- | --- |
| 条数 | **142**（`keyframe_rope` 109 + `move_rope` 33） |
| 材料 | 全部 142 条都写 `cable/nuke_cable`（**只有一种材料**） |
| `Subdiv` / `Type` / `TextureScale` | 全部是 `2` / `0` / `1` |
| `Dangling` / `Collide` / `Breakable` / `Barbed` / `spawnflags` | 全部 `0` |
| `Width` | 12 种，0.7 ~ 2.0（`1` 最多，66 条） |
| `Slack` | 39 种，25 ~ 147（`111` 最多，32 条） |
| `MoveSpeed` | `64`（141 条）与 `83`（1 条） |
| 链 | 120 条写 `NextKey`：33 个 mover 全部 + 109 段中的 87 段 |
| 命名 | 109 段每一条都有 `targetname`，且**每一条**都被某条绳子的 `NextKey` 指到 |
| 链尾 | 22 段没有 `NextKey` |
| 路径 | 33 个 `move_rope` 都有 `PositionInterpolator` |

注意最后两行的含义：**链尾（22）比发起链的 mover（33）少**，也就是有 11 条绳子的 `NextKey` 与别人重名（8 个值被指 2~3 次）——链不是"每个 mover 一条直线"。哪一头是起点、重名的那些怎么解释，属于**服务器的键规则**，见下。

## 客户端拿这些键变成什么

`DT_RopeKeyframe` 在 64 位客户端里**连 16 个成员**，探针把整张表读出来（成员名 + 客户端存它的偏移 + 传输类型），所以端口知道地图的键在客户端变成哪个字段，而不是自己命名：

| 成员 | 偏移 | 类型 | | 成员 | 偏移 | 类型 |
| --- | --- | --- | --- | --- | --- | --- |
| `m_nSegments` | `0x1298` | 4 | | `m_Slack` | `0x12b0` | 4 |
| `m_hStartPoint` | `0x129c` | 4 | | `m_TextureScale` | `0x12b4` | 4 |
| `m_hEndPoint` | `0x12a0` | 4 | | `m_fLockedPoints` | `0x12b8` | 4 |
| `m_iStartAttachment` | `0x12a4` | 2 | | `m_nChangeCount` | `0x12bc` | 4 |
| `m_iEndAttachment` | `0x12a6` | 2 | | `m_Width` | `0x12c0` | 4 |
| `m_Subdiv` | `0x12a8` | 4 | | `m_bConstrainBetweenEndpoints` | `0x1350` | 1 |
| `m_RopeLength` | `0x12ac` | 4 | | `m_flScrollSpeed` | `0xf9c` | 4 |
| `m_RopeFlags` | `0xfa0` | 4 | | `m_iRopeMaterialModelIndex` | `0xfa4` | 4 |

**服务器的同一批键落在完全不同的偏移上**（`server_client.so`，同一套"每次注册调用之间取三元组"的读法，两种读法一致）：`m_Slack 0x4f0`、`m_Width 0x4f4`、`m_TextureScale 0x4f8`、`m_nSegments 0x4fc`、`m_bConstrainBetweenEndpoints 0x500`（1 字节）、`m_RopeFlags 0x4e0`、`m_iRopeMaterialModelIndex 0x510`、`m_Subdiv 0x514`、`m_nChangeCount 0x518`、`m_RopeLength 0x51c`、`m_fLockedPoints 0x520`、`m_flScrollSpeed 0x528`。这正是"端口只认地图的键、不认任何一边的成员号"的理由。

## 地图的键落到哪个字段（类自己的 datamap）

`server_client.so` 的 `.data`（`0x1c0dd00` 起，每条 `0x68` 字节）里是绳索类自己的**字段表**：字段名、**偏移**、类型码、以及**（若有）能设它的地图键**。偏移是**从表自己的字节里读出来的**，与网络表那条读法互相独立——两处完全一致：

| 字段 | 偏移 | 类型码 | 地图键 |
| --- | --- | --- | --- |
| `m_Slack` | `0x4f0` | `0x00060001` | **`Slack`** |
| `m_Width` | `0x4f4` | `0x00060001` | **`Width`** |
| `m_TextureScale` | `0x4f8` | `0x00060001` | **`TextureScale`** |
| `m_Subdiv` | `0x514` | `0x00060001` | **`Subdiv`** |
| `m_flScrollSpeed` | `0x528` | `0x00060001` | **`ScrollSpeed`** |
| `m_nSegments` | `0x4fc` | `0x00020001` | （无） |
| `m_bConstrainBetweenEndpoints` | `0x500` | `0x00020001` | （无） |
| `m_strRopeMaterialModel` | `0x508` | `0x00020001` | （无） |
| `m_iRopeMaterialModelIndex` | `0x510` | `0x00020001` | （无） |
| `m_RopeLength` | `0x51c` | `0x00020001` | （无） |
| `m_fLockedPoints` | `0x520` | `0x00020001` | （无） |
| `m_bCreatedFromMapFile` | `0x524` | `0x00020001` | （无） |
| `m_bStartPointValid` / `m_bEndPointValid` | `0x530` / `0x531` | `0x00020001` | （无） |
| `m_hStartPoint` / `m_hEndPoint` | `0x534` / `0x538` | `0x00020001` | （无） |
| `m_iStartAttachment` / `m_iEndAttachment` | `0x53c` / `0x53e` | `0x00020001` | （无） |

三条要点：**①** 地图写的四个键（`Slack`／`Width`／`TextureScale`／`Subdiv`）**直接落到**那四个偏移上，没有中间换算；**②** 滚速的键是 **`ScrollSpeed`**，而不是地图写的那 141 条 `MoveSpeed`——所以 `MoveSpeed` 另有处理（还没读）；**③** **`m_nSegments` 与 `m_RopeLength` 一个键都没有**，它们是绳索**自己推导**出来的（还有 `m_bCreatedFromMapFile` 这个"由地图文件创建"的标记、自己的起止点有效性与句柄）。也就是说：**只读地图的端口必须自己把这两个量推导出来**——而推导规则仍未读。

类自己那一段只读数据里还写着：画它的是 `C_RopeKeyframe::DrawModel`（经 `CRopeManager::DrawRenderCache`），端点计算是 `C_RopeKeyframe::CalculateEndPointAttachment`，解算器是 **`CRopePhysics<10>`**（十趟约束）与 `CPhysicsDelegate::ApplyConstraints`，材料链从 `cable/cable` 起、`cable/rope_shadowdepth` 是写深度那一趟、缺材料时用 `missing_rope_material`，材料上还挂 `$no_fullbright`／`$alphatest`／`$nocull` 与 `__DepthWrite01` 这个 proc。

绳索自己的控制台变量，**默认值是从各自的注册处读的**（名字在 `rsi`、默认值在 `rdx`、说明文字在 `r8`，不按变量名的字面猜）：

| 变量 | 默认 | | 变量 | 默认 |
| --- | --- | --- | --- | --- |
| `rope_subdiv` | `2` | | `rope_smooth_maxalphawidth` | `1.75` |
| `rope_smooth` | `1` | | `rope_smooth_maxalpha` | `0.5` |
| `rope_smooth_enlarge` | `1.4` | | `rope_solid_minwidth` | `0.3` |
| `rope_smooth_minwidth` | `0.3` | | `rope_solid_maxwidth` | `1` |
| `rope_smooth_minalpha` | `0.2` | | `rope_wind_dist` | `1000` |
| `rope_collide` | `1` | | `r_rope_holiday_light_scale` | `0.14` |

（其余：`rope_shake 0`、`rope_averagelight 1`、`rope_rendersolid 1`、`rope_solid_minalpha 0.0`、`rope_solid_maxalpha 1`、`r_drawropes 1`、`r_ropetranslucent 1`、`r_queued_ropes 1`、`r_ropes_holiday_lights_type 0`。共 21 个，报告里逐条在册。）

## 地图自己的连接关系（已读出）

地图只写了"链"和"锚点"，而这两样合起来就定下了网络是什么：**一条写了 `NextKey` 的绳子，从它自己的 `origin` 挂到那条绳子（`NextKey` 所指的 `targetname`）的 `origin`；没有任何绳子以它为自己的 `NextKey` 的那一条，就是链的末端。** 顺着 33 个 mover 走一遍得到：

| 项 | 值 |
| --- | --- |
| 说得出下一跳的绳子（即"跨段"） | **120** |
| 没人指到的绳子（即链端） | **22** |
| 链 | **33** 条（每个 mover 一条） |
| 走到的不同绳子 | **142**（全部） |
| 链之间重叠：各链加起来的绳子数 / 走过的跳数 | **181** / **148** |
| 被两条绳子同时指向的 `NextKey` | 8 个值、多出 11 次引用 |
| 最长链 | **9** 条绳子 |
| 一跳的距离 | 2.44 ~ 40.48 m，中位 **18.71 m** |

"链端（22）比 mover（33）少"正是那 11 次重复引用的结果——同一条绳尾被两条链共用，所以链不是"每个 mover 一条直线"。这一段读的是**地图自己的数据**（两个读者逐条对齐），不是引擎的规则；引擎怎么解释这些键仍未读，见下。

## 客户端在哪儿给一条绳索收尾（`0x85d930`）

读完键之后，客户端**建/初始化**一条绳索的那段（`0x85d930`）读出来是这样，四条：

| 它做什么 | 在哪 | 读到了什么 |
| --- | --- | --- |
| 夹段数 | `0x85d98b`~`0x85d9a5` | 读 `m_nSegments`（`0x1298`）→ 与 `10` 比（`0x85d99a` `cmp eax, 10`）→ **写回**（`0x85d9a5` `mov [rbx + m_nSegments], esi`）。所以服务端网上送来的段数**在这两个界内被采用**（界就是 2~10） |
| 建模拟对象 | `0x85d9b2` → `0xaa9340` | 在 `this + 0xfb0` 上构造模拟对象；这段地址是**按 `call` 的目标算出来的**（读 `e8` 后的位移再加 5），不是看字符串 |
| 交给它两个整数盒 | `0x85d9db`~`0x85d9d4` → `0x8d0980` | 传的是**两个整向量**：`(-10, -10, -10)`（`0x85d9db`／`0x85d9e2`／`0x85d9e9`，三个 `c745…c1`，其中 `0x20c1` 就是 −10.0）与 `(10, 10, 10)`（`0x85d9bb`／`0x85d9c6`／`0x85d9d4`，`0x2041` 是 10.0）。**先前记成"两个 10.0 标量"是错的**，这里是六个浮点 |
| 重力 | `0x85da03` | `[vtable + 0x528]`（`ff9028050000`）拿 `0x19358c0` 上的 **−1293.0**，同一调用也从 `0x86427f` 发出 |
| 材料从哪来 | `0x85d958` | 走接口取 **`Other textures`** 那一组，存 `this + 0x12d8`，旗标在 `0x12e0`；第一次取不到时走的那条路（`0x85da38`~`0x85da78`）取的是 **`cable/rope_shadowdepth`** |

要紧的是最后一行：**绳索的材料来自"服务端把地图的 `RopeMaterial` 解析成的那个模型"**，客户端自己不去读 `.vmt` 名字。而这一段**给不出端口需要的推导**——客户端是**从网上拿到段数与长度**的（所以它只能"夹一下"再写回），所以"长度 → 段数"这条规则仍要从服务端那边读。

## 两个数是怎么来的（段数与长度）

上一节说"`m_nSegments` 与 `m_RopeLength` 没有键、是推导出来的"。推导读出来了。

**先解决"这是不是绳索的代码"这件事。** 跨类对偏移号什么都证明不了（本仓库里就有一个类跟绳索共用 0x4f0/0x4fc/0x500 这些号）。所以这一轮换了锚：**虚表**。虚表的每一项都是一条重定位，而表头前面那一格指向类的类型信息，类型信息里存着类名字符串——**按名字找到绳索那张表（`0x1a8d3e8`，203 项），再看某个函数在不在里面**，就成了"它属于这个类"的证明。探针同时读了 `.eh_frame`（二进制自带的函数边界表，**60284 个函数**），所以下面提到的都是一个完整函数的地址，而不是"某函数中间某处"。

### 段数：由地图的 `Type` 键定，不是由长度算

`0x9d16d0` 是这个类处理地图键的那段，它认的键一共八个（探针逐个断言：`Breakable`／`Collide`／`Barbed`／`UseWind`／`Dangling`／`Type`／`RopeShader`／`RopeMaterial`）。其中 `Type` 那条：

| `Type` | `m_nSegments` | 在哪 |
| --- | --- | --- |
| `0` | **10** | `0x9d1b9a`（`mov dword [r13+0x4fc], 0xa`） |
| `1` | **4** | `0x9d1db7` |
| 其余 | **2** | `0x9d1c97` |

这就解释了 datamap 为什么给 `m_nSegments` 一个键都没有：**它不是"某个键直接落到的字段"，而是被代码从 `Type` 推出来的**。而地图的 142 条绳索**全部写 `Type 0`**，所以它们的模拟点数都是 **10**——正好落在客户端那个 2~10 的夹取区间内。

类自己在生成时（虚表里的 `0x9d2520`）会把点数**两头夹住**：`<=1` 抬到 **2**（`0x9d280e` `mov r12d, 2`），`>10` 压到 **10**（`0x9d26ae` `mov r12d, 10`），写回 `0x9d26da`；同一条路还把 `m_TextureScale` 夹在 **[0.1, 10]**（`0.1` 与 `10.0` 两个常量在 `0x139fc30`／`0x139fc5c`），越界时打印的句子是 **`move_rope has TextureScale less than 0.1 at (%2.2f, %2.2f, %2.2f)`**——这句自带 `move_rope` 字样，是"这一段确实是地图绳索的代码"的直接证据。

### 长度：两个端点之间的直线距离

`0x9cfda0`：解析 `m_hStartPoint`（`0x534`）与 `m_hEndPoint`（`0x538`）两个句柄拿到两个实体，取各自原点（`+0x278`），算三点差的平方和再开方（`0x9cfe83`~`0x9cfed4`），**截断成整数**（`0x9cfed8` `cvttss2si ebx, xmm0`）后写进 `m_RopeLength`（`0x9cff0b`）；端点无效时写 0（`0x9cfe1a`）。它在 `0x9d2520` 里被调用（`0x9d2543`）。

**另一条可达到的路**（同一个类的另一个虚函数 `0x9d2c00`，它会自增 `m_nChangeCount` 并做字段变更记账）算的是同一个距离，但**把 `m_Slack` 加进去**：`0x9d2dc9` `add ebx, [r12 + 0x4f0]`，再写回 `0x9d2e09`。

**两条路都读到了、都可达到，而"静态地图绳索最后落在哪一条"没有读到**——所以端口不挑一条。而且这里有个**没有解开的分歧**：渲染器的纹理坐标把 `m_Slack` 与 `m_RopeLength` **加在一起**当总长（`(m_Slack + m_RopeLength - 100) / m_TextureScale`），读起来像"两段各自独立"，与"把 slack 折进长度"正好相反。这个分歧照实写进报告与 `SOURCE_ROPE_LIMITATIONS`，不假装解决了。`Slack` 到底是长度还是百分比，也没读到；只读到"它被加到距离上"。

### 运行时造一条绳索的路

`0x9cf500`（`CreateRope`）在全文件里**只有一个调用者**：`0x6ab080`，而它是 **`CRopeAnchor` 那张虚表**里的一项（表头 `0x19f2660`）。它交给 `CreateRope` 的长度是**锚点与它所附实体之间的竖直距离**（`0x6ab19b` `subss xmm0, [rbx+0x280]`，取绝对值后 `cvttss2si`），没有父实体时用 **384**（`0x6ab099` `mov edx, 0x180`）；建的类名是 `keyframe_rope`、材料 `cable/cable.vmt`。这与地图绳索不是同一条路（地图那些走引擎的实体装载），所以端口不拿它当规则。

### 一条"看着对、但没人调用"的代码（负结论）

`0x9ce1a0` 是个完整函数：解析两个端点、算距离、把长度与 slack 分别写进 `0x51c` 与 `0x4f0`——**看着正是要找的规则**。但探针把"谁指向它"查了三遍：**不在任何虚表里、全文件没有一条 `call`/`jmp` 指向它、没有任何重定位把它的地址放进表**。也就是说它是**留在构建里、谁也到不了的代码**，不能当作游戏实际走的规则。这是本仓库第二次撞到这件事（上一次是 `0x72a820`），所以"负结论"也一并入库。

## 没有读到的（因此不能据此画）

| 项 | 为什么不能猜 |
| --- | --- |
| 静态地图绳索的长度落在哪条公式上 | 两条都读到了也都可达到：`0x9cfda0` 写"距离"、`0x9d2c00` 写"距离 + `m_Slack`"。哪一条是静态绳索的最终值没读；渲染器的纹理坐标又把两者**相加**当总长，与"折进长度"相反，这个分歧没解开 |
| `Slack` 是长度还是百分比 | 只读到它被**加到**那个距离上（`0x9d2dc9`）；量纲没读。地图的值是 25~147（单位/百分比都可能） |
| 重力与阻尼**各自**是谁 | 位置已经看到——`0x19358c0` 的 **−1293.0** 交给 `[vtable+0x528]`（从 `0x85da03`、`0x86427f` 传入），另有 **两个整向量 `(−10,−10,−10)` 与 `(10,10,10)`** 交给 `0x8d0980`（从 `0x85d9db`~`0x85d9d4`；先前记成"两个 `10.0` 标量"已更正）——但**各自扮演什么没读出**（那个设置函数只是比较两个 vec3 再存下来，说不清它们是什么），所以下垂量算不出来 |
| 顶点围绕中心线的偏移、下垂怎么解 | 只读出**数量**（每个中心线点 3 个顶点、每模拟段 `m_Subdiv+1` 个点）与**点数**（`Type 0` → 10，客户端/服务端都夹在 2~10）：网格怎么摆、十个点怎么在两个端点之间松弛没读 |
| 写深度那一趟 | `cable/rope_shadowdepth` 与 `__DepthWrite01` 只读到名字 |

`game/source-ropes.ts` 里这三条以 `SOURCE_ROPE_LIMITATIONS` 交给运行时可查，单测钉住条数与内容；装载器会**顺着 `NextKey` 走一遍**（走不到全部 142 条就拒绝装载），并把这些计数报进审计，但**不推导任何几何**。

## 下一步的锚点（已定位）

| 要找的 | 在哪儿 | 已经看到什么 |
| --- | --- | --- |
| 客户端的绳子键处理与初始化 | **已读**：建/初始化那一段是 `0x85d930`（夹 `m_nSegments` 进 2~10、建 `this+0xfb0` 的模拟对象、两个整数盒、−1293.0、`Other textures` 取材料）；`m_Slack` 写在 `0x85d655`／`0x85d795`，`m_RopeLength` 写在 `0x85d789` | 这一段**给不出推导**：客户端是**从网上收到**段数与长度的（它只能夹一下写回）；真正的"长度 → 段数"要在**服务端**那侧读 |
| 绳索渲染器 | `0x8609c0`~`0x861150`：`m_Subdiv` 在 `0x860fb5`、`m_Width` 在 `0x860fee`、`m_TextureScale` 在 `0x860fd4`；沿长度的纹理用 `(m_Slack + m_RopeLength − 100) / m_TextureScale`（`0x8610b6`~`0x8610e7`） | 顶点/索引数按 `3×(m_Subdiv+1)` 与 `6×(m_Subdiv+1)` 累加（`0x860c4f`~`0x860c5b`） |
| 物理 | `CPhysicsDelegate::ApplyConstraints` `0x85fae1`；setup `0x8d0980`；`[vtable+0x528](−1293.0)` `0x85d9fb`／`0x86427f` | 重力和阻尼的角色 |
| 服务器的键规则 | **已读**：键处理是 `0x9d16d0`（八个键 + `Type`→点数 + `RopeMaterial`/`RopeShader` 选材料）；长度是 `0x9cfda0`（距离）／`0x9d2c00`（距离 + slack）；生成时的夹取在 `0x9d2520`；成员注册段在 `0x9cbe80`~`0x9cc1a0` | `RopeMaterial` 拼 `.vmt` 存入 `this+0x508`；`RopeShader` 缺省 `cable/cable.vmt`，按值选 `cable/rope.vmt`／`cable/chain.vmt` |
| 下垂（还没读） | 客户端 `CRopePhysics<10>`／`CPhysicsDelegate::ApplyConstraints` `0x85fae1`；setup `0x8d0980`；`[vtable+0x528](−1293.0)` `0x85da03`／`0x86427f`；服务端把两个端点交给求解的那一处 | 点数（10）、子分数（2）、宽度（地图）、总长（距离，可能 + slack）都已知；缺的是**十个点怎么排、怎么松弛**，以及 −1293.0 与那两个整向量各自是什么 |
| `0x72a820` 是什么（已否掉） | `server_client.so` `0x72a820`~`0x72a88e`；它的地址在那条 `.data` 记录 `0x1bab8a0`~`0x1bab8c4` 里（与 `InputFadeIn`／`FadeIn` 同一条；紧邻的 `0x72a890` 在同形状的记录 `0x1bab908`~`0x1bab92c` 里，与 `InputFadeOut`／`FadeOut` 同一条） | 写 `[rdi+0x4fc]`（`25600/(5n)`，`n` 夹 100）与 `[rdi+0x500]`（清 0）；**不是绳索的代理**（绳索 `m_nSegments` 的注册在 `0x9cbfc0`~`0x9cbff2` 推的是空代理）。**这一整片 `0x72a7xx`~`0x72b6xx` 是那个「有 FadeIn/FadeOut 输入」的类的，不是地图绳索的**（绳索自己的键处理在 `0x9d16d0`）；同一片里那个更新函数 `0x72ab60` 没有任何表指向它，所以它的归属也不该从偏移号去推 |
| 建绳索与存档/恢复 | `0x863f00`~`0x863f8f`（写 `m_hEndPoint`／`m_iStart/EndAttachment`／`m_Width`，把 `m_nSegments` 夹进 2~10）；`0x863fb0`~`0x8640fe`（按名字读 `NumSegments`／`TextureScale`，把 `m_Slack` 置 0） | 这两处是**客户端**的建/恢复路径（`NumSegments` 是它自己的存档名）；`m_RopeFlags` 在 `0xfa0`、另有一个字段在 `0x1354` |

## 入库件与复现

- `scripts/probe-source-ropes.py` → `research/source-ropes.json`（含 142 条逐字段清单、连接关系与跳距、16 个成员、21 个控制台变量、材料与方法名、渲染器的顶点/索引算式与纹理映射、物理那几个数、**两个数的推导**（虚表锚、`Type`→点数表、长度两条公式、运行时创建路径、一条死代码），以及 `boundary`；探针把这一路上每一条指令的**字节**按地址断言下来，读错位置会失败）
- `scripts/stage-source-ropes.py` → `game/source-ropes-data.ts`（运行时读的表，含报告 SHA 与 BSP/客户端 SHA 回执）
- `game/source-ropes.ts`：装载即校验（格式、只允许那一种材料、每条绳子的数与向量、mover 不带名字而段必带名字、`NextKey` 必须指向地图自己声明过的段、hammerId 唯一、链端少于 mover、**顺着 `NextKey` 必须走到全部 142 条**）
- `tests/source-ropes.test.ts`：7 条（表与报告逐字段比较、连接关系与跳距、类与控制台变量、渲染器/物理/client-init/推导那几组数、11 种自相矛盾的表装载即拒绝、链路走不到全部即拒绝、`limitations` 条数）

复现：`PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-ropes.py`（该 venv 自己的解释器在本机起不来，用系统 python3 直接跑）。
