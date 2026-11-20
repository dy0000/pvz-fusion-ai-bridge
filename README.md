# PVZ-Fusion AI Bridge

> 为《植物大战僵尸融合版 4.1》（Windows x64 / Unity IL2CPP）打造的原生桥接与 MCP 控制框架。

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](#)
[![MCP Tools](https://img.shields.io/badge/MCP%20Tools-33-00b894.svg)](#mcp-工具一览)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0984e3.svg)](#快速开始)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

提供原生游戏桥接与 33 个标准 `pvzf_*` MCP 工具。接入任意支持 MCP 的大模型后，即可让模型读取游戏实时状态，按游戏原生规则自主选卡、种植、融合与通关。

---

## 核心特性

- **原生直连，不抢键鼠**：直接读取阳光、冷却、波次、地形与植物/僵尸实时状态并调用原生逻辑，默认实时运行，不占用桌面键鼠。
- **33 个标准 MCP 工具**：完整覆盖选卡、种植、融合配方查询、自动收阳光、手套移位、铁桶/肥料交互、炮台瞄准、小游戏与旅行进化商店。
- **独立存档隔离**：游戏进程恢复前自动隔离存档与 `PlayerPrefs` 至 `runtime/saves/`，绝不触碰你的原版存档，也不修改磁盘上的 EXE/DLL。
- **零作弊边界**：严格保留阳光费用、卡牌冷却、关卡解锁与放置规则，不提供任何修改数值或强制胜利的接口。
- **随时夺回控制**：独占单控制器模式，断线自动释放；游戏内按 `F8` 暂停、`F9` 交还并锁定控制。

---

## 快速开始

### 环境要求
- Windows x64 + Python **3.11+**（无需 Node.js、编译器或模型 API Key）
- 自行准备正版/原版《植物大战僵尸融合版 4.1》（安装器会按 [profile.json](profile.json) 核验关键文件 SHA256，本仓库不分发游戏本体）

### 1. 克隆并一键隔离安装

```powershell
git clone https://github.com/dy0000/pvz-fusion-ai-bridge.git
cd pvz-fusion-ai-bridge

# 方式 A：指定已有游戏目录（自动复制隔离副本到 ./game 并创建 .venv）
.\install.ps1 -GamePath "D:\Games\植物大战僵尸融合版4.1" -RegisterCodex

# 方式 B：指定游戏压缩包
.\install.ps1 -GameArchive "C:\Downloads\植物大战僵尸融合版4.1.zip" -RegisterCodex
```

> 省略 `-RegisterCodex` 时，仍会在 `generated/mcp.json` 与 `generated/codex.toml` 生成通用 MCP 配置，可直接导入其他 MCP 客户端。

### 2. 启动游戏与桥接

双击根目录的 **`start.cmd`** 启动隔离游戏与桥接宿主（服务名 `pvz_fusion`，仅监听 `127.0.0.1:47634`）。

> 请勿直接双击 `game/` 内的 EXE，否则不会启用运行时存档隔离。

### 3. 接入大模型开玩

在你的 MCP 客户端中加载 `generated/mcp.json`（参考 [mcp.example.json](mcp.example.json)），并将 [AI_PLAYER_PROMPT.txt](AI_PLAYER_PROMPT.txt) 作为提示词发给模型，即可使用全部 `pvzf_*` 工具。

---

## MCP 工具一览

共提供 **33 个** `pvzf_*` 工具（行列坐标均从 **1** 开始，战斗动作需携带最新 `battle_id`）：

| 分类 | 工具列表 | 说明 |
| --- | --- | --- |
| **会话与控制** | `pvzf_capabilities`, `pvzf_take_control`, `pvzf_release_control`, `pvzf_stop` | 查询版本/能力、独占接管、安全交还与停止 |
| **观察与菜单** | `pvzf_observe`, `pvzf_menu`, `pvzf_menu_action`, `pvzf_flow`, `pvzf_collect_reward` | 读取实时战场快照、原生菜单、教程/结算与领奖 |
| **基础战斗** | `pvzf_choose_card`, `pvzf_start_battle`, `pvzf_plant`, `pvzf_shovel`, `pvzf_collect`, `pvzf_auto_collect`, `pvzf_next_wave` | 选卡开战、普通种植与原生融合、铲除、拾取阳光与提前下一波 |
| **融合与格检** | `pvzf_fusion_recipe`, `pvzf_inspect_cell`, `pvzf_placement_check` | 原生配方查询、地形/坑墓/承载物及分层放置检查 |
| **进阶机制** | `pvzf_mechanisms`, `pvzf_move_plant`, `pvzf_disassemble`, `pvzf_interact`, `pvzf_fire`, `pvzf_cycle_towards` | 手套移动、原生拆分、铁桶佩戴/施肥/主动技能、炮台瞄准与方向切换 |
| **选项与小游戏** | `pvzf_choices`, `pvzf_choice_action`, `pvzf_minigame_observe`, `pvzf_minigame_action`, `pvzf_minigame_input` | 原生弹窗选项、小游戏专用动作及有界游戏内输入 |
| **旅行进化** | `pvzf_rogue_observe`, `pvzf_rogue_action`, `pvzf_purchase_receipt` | 积分商店、合成、装备/消耗品操作与防重放交易回执 |

<details>
<summary><b>展开查看原生规则与协议边界说明</b></summary>

- **动作确认**：种植、融合、铲除与佩戴装备以回包 `status=Committed` 及实际战场状态变化为准；结果未知或断线时绝不自动重放。
- **拆分资格**：普通冒险无法仅凭 500 阳光拆分，以 `observe.disassembly` 返回的原生资格（如旅行“拆分”词条或指定关卡）为准。
- **掉落物交互**：`observe.equipment_drops` 导出当前铁器与肥料 `item_id`，通过 `pvzf_interact` 同时携带 `item_id` 与目标植物 `entity_id` 执行原生拾取与作用。
- **有界输入**：小游戏输入限 `frames=1..120`（最长约 3.5 秒，至多 32 点世界坐标轨迹），未揭开的地雷与罐子隐藏内容不导出。
- **交易防重放**：`pvzf_rogue_action` 必须携带唯一 `transaction_id` 与预算上限（`max_spend` / `max_health_cost`），交易先落盘再调用原生，断线后先查 `pvzf_purchase_receipt`。

</details>

---

## 快捷键与安全停止

| 操作 | 作用 |
| --- | --- |
| `F8`（游戏窗口内） | 立即停止接管并打开游戏原生暂停 |
| `F9`（游戏窗口内） | 交还并锁定控制，禁止 AI 重新接管 |
| `F10`（游戏窗口内） | 由玩家手动解除锁定，重新允许接管 |
| 双击 `stop.cmd` | 确认完整释放后正常退出隔离游戏 |

> `runtime/connection.json` 保存本机随机通信 token，切勿公开分享。

---

## 目录结构与测试

```text
├── src/                  # 原生 IL2CPP 桥接、存档隔离与扩展机制 (7 个 JS 模块)
├── scripts/
│   ├── run_bridge.py     # 独占本地桥接宿主 (127.0.0.1:47634)
│   ├── run_mcp.py        # 标准 stdio MCP 服务适配器
│   ├── client.py         # Python 协议客户端
│   ├── receipts.py       # 旅行商店防重放交易回执
│   ├── observe_game.py   # 只读观察工具
│   ├── install.py        # 隔离安装与配置生成器
│   └── verify_*.py       # MCP / 实机基础接口验证夹具
├── tests/                # 离线协议、回执与原生边界单元测试
├── install.ps1 / .cmd    # Windows 一键安装入口
└── start.cmd / stop.cmd  # 启停脚本
```

运行全部离线单元测试：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_protocol.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_receipts.py -v
node tests/test_native.cjs
node tests/test_input.cjs
node tests/test_interactions.cjs
node tests/test_rogue.cjs
```

---

## 开源协议

本项目桥接代码采用 [MIT License](LICENSE) 开源。游戏本体、美术、音乐、Unity 与第三方运行库归各自权利人所有，不随本仓库分发。
