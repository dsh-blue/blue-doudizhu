# @dsh-blue/blue-doudizhu

![Blue 斗地主牌面](https://raw.githubusercontent.com/dsh-blue/blue-doudizhu/main/doudizhu.png)

Blue 斗地主：核心牌面以 **overlay** 常驻显示——牌面不抢键盘焦点，你可以**看着牌直接输入 `/poker <编码>` 出牌**，牌面随每次出牌实时刷新。`/poker hide` 临时收起（不打断牌局）、`/poker show` 恢复，`/poker stop` 才真正停止。Bot 复用本地配置的模型，支持积分与排行榜、记牌器。

本项目基于 [Blue](https://github.com/dsh-blue/blue) 构建：Blue 是 DeepSeek Harness 的终端 UI，插件以 Cordis 插件包 + Cordis 补丁的形式挂载。更多资料见 [Blue 文档](https://dsh-blue.dev/)。

`0.3.0` 已迁移到 Blue canonical plugin manifest v1：`commands`（仅 `/poker`）和 `overlays` 是必需能力，`notifications.publish` 是可选能力。通知 owner 暂时不可用时牌局仍可运行；本地模型服务不存在或重载时，Bot 自动回退到规则 AI。

## 命令
- `/poker new` 开局（可带叫分 `/poker new 2`），自动弹出牌面 overlay
- `/poker <编码>` 出牌（`0`=10、`jqka2`=JQKA2、`sx`=王炸、`p`=不出）——**牌面保持可见，直接输入即可**
- `/poker hide` 临时收起牌面（牌局继续）；`/poker show` 重新展开
- `/poker stop` 真正停止当前牌局（不计分、收起牌面）
- `/poker pause` 暂停 Bot 出牌（牌面保持可见）；`/poker resume` 恢复并展开牌面
- `/poker score` 记分；`/poker end` 结束比赛看排行榜
- `/poker memo` 开关记牌器
- `/poker bot` 切模型Bot / `/poker heuristic` 切规则AI

## 前置条件：先安装 Blue

本插件是一个 **Blue 功能**（`cordis.patch.yml` + `bluePluginHost` 插件包），依赖 Blue 终端 UI 与 `bluePluginHost` 能力。**安装本插件前，你必须先装好 Blue**（`>=0.1.1-rc.2`）：

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@0.1.1-rc.2
```

> 🔔 必须先有 `blue` profile 且已安装 `@dsh-blue/blue`，再执行下面的步骤；否则会提示 `bluePluginHost` 能力缺失 / `@dsh-blue/blue` 解析失败。Blue 的安装与首次配置参见 [Blue 仓库](https://github.com/dsh-blue/blue) 与 [Blue 文档](https://dsh-blue.dev/en/guide/)。

## 安装

以下命令均已实测可用（`dsh plugin --profile blue add` 系列）。

### 方式一：npm（推荐）
```sh
dsh plugin --profile blue add @dsh-blue/blue-doudizhu@0.3.0
```
也可以省略版本号装最新版：`dsh plugin --profile blue add @dsh-blue/blue-doudizhu`

### 方式二：GitHub 源
```sh
dsh plugin --profile blue add github:dsh-blue/blue-doudizhu
```
也可以直接用 git URL：
```sh
dsh plugin --profile blue add git+https://github.com/dsh-blue/blue-doudizhu.git
```

安装后重启 Blue（`dsh --profile blue`），即可使用 `/poker` 命令。

## 运行边界

- 规则、牌局动作和 heuristic Bot 是纯 domain 代码，不依赖 Blue 或终端 renderer。
- 牌面只消费当前 domain 派生的 readonly projection，并通过 `@dsh-blue/blue-ui` 构造公开 wire nodes。
- Harness 的 `llm` / `agentDefaultModel` 由独立 Cordis 子 Fiber 适配；provider unload、插件 unload 或新牌局都会 abort 旧 stream 并拒绝 late result。
- 插件 Fiber 卸载时会停止 driver、关闭 overlay 并清除全部 owner-scoped 状态；没有进程级可变单例。

开发验证：

```sh
npm install --ignore-scripts
npm test
npm run test:coverage
```

## 相关链接
- Blue 仓库：https://github.com/dsh-blue/blue
- Blue 文档：https://dsh-blue.dev/
