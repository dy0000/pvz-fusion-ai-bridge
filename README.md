<div align="center">

# PVZ 融合版 AI Bridge

**让你的大肥鱼，亲自去打融合版僵尸。**

植物大战僵尸融合版 4.1 · Windows 一键安装 · 33 个 MCP 工具 · 原生状态与操作

![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)
![PVZ Fusion](https://img.shields.io/badge/PVZ--Fusion-4.1-2E8B57)
![Bridge](https://img.shields.io/badge/Bridge-0.4.0-7437B8)
![License](https://img.shields.io/badge/License-MIT-blue)

[快速开始](#快速开始) · [MCP 接入](#接入你的-ai) · [常见问题](#常见问题) · [开发与测试](#开发与测试) · [许可与致谢](#许可与致谢)

</div>

这是 **《植物大战僵尸融合版》PVZ-Fusion 4.1 的 AI 接入桥接项目**。把它接到支持本机 MCP 工具的 AI 助手后，AI 就能直接读取战场状态、选卡布阵、进行原生植物融合、使用手套和铲子、佩戴装备与施肥，以及游玩小游戏和旅行进化模式。

玩家准备游戏，桥接负责提供工具，AI 负责思考怎么玩。项目使用 Frida 在运行时接入游戏，不修改磁盘上的游戏 EXE/DLL，并在启动前自动隔离独立存档；所有种植与交互均严格遵守原生费用、冷却与放置规则。

## 能做什么

| 能力 | 支持内容 |
| --- | --- |
| 看懂战场 | 阳光、波次、卡牌价格与剩余冷却、植物/僵尸血量与护甲、草地/水面地形与墓碑 |
| 自主操作 | 原生选卡、开战、普通种植、素材叠种原生融合、配方查询、自动拾取阳光、铲除 |
| 进阶机制 | 手套移位、原生拆分（按关卡/旅行词条资格）、铁桶佩戴、施肥、主动技能与炮台瞄准 |
| 小游戏与旅行 | 三消/2048/植物棋/砸罐/扫雷等小游戏及有界输入；旅行进化积分商店与防重放交易回执 |
| 完整流程 | 原生菜单导航、教程、任务、BOSS 实体、弹窗选项、失败重试与奖杯领奖结算 |
| 玩家接管 | 游戏内按 F8/F9 立即停止并锁定 AI；玩家按 F10 重新允许接管 |

AI 的实际水平取决于模型与提示词，项目不提供任何修改阳光、跳过冷却或强制胜利的作弊接口。

## 快速开始

需要 **Windows x64**、Python **3.11+** 和支持本机 stdio MCP 的 AI 客户端。请自行准备《植物大战僵尸融合版 4.1》，本项目不分发游戏本体。

### 1. 安装

克隆或解压本项目源码后，在 PowerShell 中运行：

```powershell
# 指定已有游戏目录（自动复制隔离副本到 ./game 并安装独立 .venv）
.\install.ps1 -GamePath "D:\Games\植物大战僵尸融合版4.1" -RegisterCodex

# 或指定游戏压缩包
.\install.ps1 -GameArchive "C:\Downloads\植物大战僵尸融合版4.1.zip" -RegisterCodex
```

安装器会按 [profile.json](profile.json) 严格校验游戏关键文件哈希，并自动准备 `.venv/` 依赖与 MCP 配置文件（无需 Node.js、编译器或模型 API Key）。省略 `-RegisterCodex` 则仅生成通用配置文件。

### 2. 启动

双击项目根目录的 **`start.cmd`** 启动隔离游戏与桥接宿主（仅监听 `127.0.0.1:47634`，独立存档位于 `runtime/saves/`，绝不触碰原存档）。

> 请勿直接双击 `game/` 里的游戏 EXE，否则不会启用运行时存档隔离。

### 3. 让 AI 开始玩

重新加载 AI 客户端的 MCP，把 **`generated/START_HERE.txt`** 或 [AI_PLAYER_PROMPT.txt](AI_PLAYER_PROMPT.txt) 发给 AI，并说明想玩的关卡或目标。结束时让 AI 交还控制；随时可按 **F8/F9** 停止，玩家按 **F10** 重新允许。

## 接入你的 AI

### Codex

使用 `-RegisterCodex` 时会自动注册独立服务 `pvz_fusion`，等价于：

```powershell
codex mcp add pvz_fusion -- "C:\PATH\pvz-fusion-ai-bridge\.venv\Scripts\python.exe" -X utf8 "C:\PATH\pvz-fusion-ai-bridge\scripts\run_mcp.py"
```

没有 CLI 时，可将 `generated\codex.toml` 中的 `[mcp_servers.pvz_fusion]` 合并到你的 Codex 配置中（注意保留原有其他服务条目）。配置格式参考 [OpenAI MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。

### 其他 MCP 客户端

导入安装生成的 **`generated\mcp.json`**，或手动添加 stdio 服务：

- 类型：**stdio / 本地命令**
- 命令：项目 `.venv\Scripts\python.exe` 的绝对路径
- 参数：`-X`、`utf8`、`scripts\run_mcp.py` 的绝对路径（分别作为数组项）
- 服务名：`pvz_fusion`；工具前缀：`pvzf_`（共 33 个工具）

`mcp.example.json` 仅作结构示例，实际使用时请以 `generated\` 中带本机绝对路径的配置为准。

<details>
<summary><b>展开查看 33 个 MCP 工具清单</b></summary>

| 分类 | 工具 |
| --- | --- |
| 控制与能力 | `pvzf_capabilities`, `pvzf_take_control`, `pvzf_release_control`, `pvzf_stop` |
| 观察与流程 | `pvzf_observe`, `pvzf_menu`, `pvzf_menu_action`, `pvzf_flow`, `pvzf_collect_reward` |
| 选卡与战斗 | `pvzf_choose_card`, `pvzf_start_battle`, `pvzf_plant`, `pvzf_shovel`, `pvzf_collect`, `pvzf_auto_collect`, `pvzf_next_wave` |
| 融合与格检 | `pvzf_fusion_recipe`, `pvzf_inspect_cell`, `pvzf_placement_check` |
| 进阶机制 | `pvzf_mechanisms`, `pvzf_move_plant`, `pvzf_disassemble`, `pvzf_interact`, `pvzf_fire`, `pvzf_cycle_towards` |
| 选项与小游戏 | `pvzf_choices`, `pvzf_choice_action`, `pvzf_minigame_observe`, `pvzf_minigame_action`, `pvzf_minigame_input` |
| 旅行进化 | `pvzf_rogue_observe`, `pvzf_rogue_action`, `pvzf_purchase_receipt` |

</details>

## 停止、更新与卸载

- **暂时停止 AI**：在游戏窗口获得焦点时按 **F8**（停止并打开原生暂停）或 **F9**（交还并锁定控制）；仅玩家按 **F10** 可重新允许接管。正常结束也应让 AI 调用 `pvzf_release_control`。
- **退出游戏与宿主**：双击 **`stop.cmd`** 请求宿主交还并正常关闭隔离游戏。若遇到 `release_blocked`，请等待释放或手动正常关闭游戏，勿强杀宿主或启动第二控制器。
- **更新**：交还并用 `stop.cmd` 正常退出后，备份 `runtime/saves/`，再替换新源码即可。请勿在游戏运行时热替换代码。
- **卸载**：退出游戏后，在 AI 客户端移除 `pvz_fusion` MCP 条目（Codex 可运行 `codex mcp remove pvz_fusion`），再删除项目目录。存档是否保留由玩家自行决定。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 安装提示 `Unsupported Fusion 4.1 build` | 当前适配融合版 4.1 Windows x64 构建，须核对 `profile.json` 中的文件哈希 |
| Frida 下载失败 | 检查到 PyPI 的网络连接，可按需要配置 pip 镜像或代理后重试 |
| AI 看不到工具 | 确认已导入 `generated/mcp.json` 并重启/重载客户端；工具前缀为 `pvzf_` |
| `connection.json` 不存在 | 先双击 `start.cmd` 启动隔离游戏与宿主 |
| 47634 端口被占用 | 已有另一个桥接宿主正在运行，先正常交还并退出后再启动 |
| `playerLocked` / F8、F9 后 AI 不能动 | 玩家在游戏窗口内按 **F10** 解除停止锁，AI 无法自行解除 |
| `rejected_by_game` | 游戏原生拒绝了本次动作，重新观察阳光、冷却、地形和教程状态 |
| 超时或断线后不确定是否生效 | 重新观察现场，结果未知的动作不自动重放，商店交易先查 `pvzf_purchase_receipt` |
| Windows 安全软件提示拦截 | Frida 运行时注入可能触发误报，请核对开源代码后按自身安全策略处理 |

> `runtime/connection.json` 保存本机单次随机通信 token，反馈问题时请勿公开该文件或整份运行目录。

## 开发与测试

```text
pvz-fusion-ai-bridge/
├─ install.cmd / install.ps1     # Windows 一键隔离安装
├─ start.cmd / stop.cmd          # 启动与安全退出
├─ src/                          # 游戏内 Frida 原生桥接与存档隔离 (7 个 JS 模块)
├─ scripts/                      # 独占宿主、MCP 适配、客户端与验收夹具
├─ tests/                        # 离线协议、回执与原生边界测试
├─ AI_PLAYER_PROMPT.txt          # 供接入大模型阅读的原生操作规范
└─ profile.json                  # 已适配游戏构建的 SHA256 清单
```

运行离线单元测试：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_protocol.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_receipts.py -v
node tests/test_native.cjs
node tests/test_input.cjs
node tests/test_interactions.cjs
node tests/test_rogue.cjs
```

打包干净源码发布包（输出在 `dist/`，附逐文件 SHA256 清单）：

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts\package_release.py
```

## 许可与致谢

桥接代码与项目文档采用 [MIT License](LICENSE)。游戏本体、美术、音乐、Unity 与第三方运行库归各自权利人所有，不属于本项目的 MIT 授权范围。

感谢《植物大战僵尸融合版》作者及所有游戏社区创作者。

## 社区

本开源项目已链接并认可 [LINUX DO 社区](https://linux.do)。
