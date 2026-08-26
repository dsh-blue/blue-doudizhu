# @dsh-blue/blue-doudizhu

Blue 斗地主：在 Blue 的 dock 面板用字符绘制牌局，Bot 复用本地配置的模型，支持积分与排行榜、记牌器、暂停/收起面板。

## 命令
- `/poker new` 开局（可带叫分 `/poker new 2`）
- `/poker <编码>` 出牌（`0`=10、`jqka2`=JQKA2、`sx`=王炸、`p`=不出）
- `/poker score` 记分；`/poker end` 结束比赛看排行榜
- `/poker memo` 开关记牌器
- `/poker pause` 暂停并收起面板；`/poker resume` 恢复并展开
- `/poker bot` 切模型Bot / `/poker heuristic` 切规则AI

## 安装

### 方式一：npm（发布后）
```sh
dsh plugin --profile blue add @dsh-blue/blue-doudizhu
```

### 方式二：GitHub 源
```sh
dsh plugin --profile blue add github:dsh-blue/blue-doudizhu
```
也可以直接用 git URL：
```sh
dsh plugin --profile blue add git+https://github.com/dsh-blue/blue-doudizhu.git
```

安装后重启 Blue（`dsh --profile blue`），即可使用 `/poker` 命令。
