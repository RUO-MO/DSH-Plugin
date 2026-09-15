# DSH-Plugin · DeepSeek Harness 插件仓库

本仓库面向 **DeepSeek Harness（DSH）** 的插件开发，当前包含一个可独立安装的官方协议插件：

- **[plugin/dsh-deepseek-web](./plugin/dsh-deepseek-web)** —— 在 DSH 侧边栏内嵌网页版 DeepSeek 聊天
  （chat.deepseek.com），无需切窗口、不消耗 Harness 会话 token。

## 快速使用（克隆即用）

克隆本仓库后，插件源码是**自包含**的，内部不含任何绝对路径或机器专属配置，无需改动即可安装：

```sh
# 进入到插件目录并安装唯一依赖 @deepseek-ai/schemastery
cd plugin/dsh-deepseek-web
npm install

# 方式一：dsh web（浏览器形态，拷贝安装）
pnpm dsh plugin --profile web add <本插件仓库绝对路径> && pnpm dsh web

# 方式二：已打包桌面版 → DSH++ 面板 → 插件管理 → 导入本插件目录
```

面板默认进入站点根路径 `/`（DeepSeek 首页/登录），登录后无需再额外配置；如需直接打开某个共享会话，
可在补丁行 `config: startPath` 里指定你的 `/a/chat/s/<share-id>`。详见插件内 README。

## 仓库结构

```
DSH-Plugin/
├── README.md              # 本文件（仓库导读）
├── LICENSE                # MIT
├── .gitignore
└── plugin/
    └── dsh-deepseek-web/  # 可安装的 DSH 插件包（含 host 半 + client 半 + 冒烟测试）
        ├── lib/index.js          # host 半：本地回环反向代理
        ├── lib/client.js         # client 半：Slots 注入侧边栏入口与 iframe 面板
        ├── cordis.patch.yml      # bundle 补丁行
        └── scripts/              # 冒烟测试 / 边界测试 / dev 注入脚本
```

> `cordis/`（上游 Cordis 框架源码）与 `docs/`（开发提示词模板）是本地参考资料，**不入版本管理**。

## 插件说明

内嵌受限于上游 `Content-Security-Policy: frame-ancestors 'none'` 与静态 CDN 的来源校验，本插件在
Harness 宿主进程内启动一个仅绑定 `127.0.0.1` 的本地反向代理：剥掉框架拒绝头、将静态域改写为代理相对
路径、改写 Cookie 与重定向，从而让 DeepSeek 网页安全地生活在 Harness 的 iframe 面板中。

- 部署与配置表、已知限制、验证命令，见 **[plugin/dsh-deepseek-web/README.zh.md](./plugin/dsh-deepseek-web/README.zh.md)**
- License：MIT，见 **[LICENSE](./LICENSE)**