# Volcengine Coding Plan Key 轮换代理

面向内网部署的 OpenAI Responses API 透明代理。OpenCode 只连接此服务；服务以轮询方式选择火山方舟 Key，并在 `401/402/403/429` 时自动冷却当前 Key、切换到下一个 Key。支持 SSE 流式响应。对于 `AccountQuotaExceeded`，代理会从响应中解析月度配额重置时间，将 Key 冷却到该时间，而不是按普通限流短暂冷却。

## 启动

要求 Node.js 20 或更新版本：

```bash
npm install
npm start
```

打开 `http://localhost:8787` 添加 Key。数据保存在 `data/keys.json`，文件权限为 `0600`。

管理页会根据当前访问地址生成完整的 `opencode.json`，包含官方文档当前列出的全部模型；下拉框只控制默认模型，不会删减模型列表。配置可一键复制。已有 OpenCode 配置时，应合并生成内容中的 `provider`，不要覆盖其他 Provider。

也可使用 Docker：

```bash
docker compose up -d --build
```

完整的镜像归档和部署步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## OpenCode 配置

将原配置中的 `baseURL` 改为代理地址：

```json
{
  "volcengine-plan": {
    "npm": "@ai-sdk/openai",
    "name": "Volcano Engine (Responses API via proxy)",
    "options": {
      "baseURL": "http://你的内网服务器:8787/api/coding/v3",
      "apiKey": "proxy-managed"
    }
  }
}
```

`apiKey` 可填写任意非空占位值，代理会覆盖 `Authorization` 请求头。

## 环境变量

- `PORT` / `HOST`：默认 `8787` / `0.0.0.0`
- `UPSTREAM_BASE_URL`：默认火山北京 Coding API 地址
- `VOLCENGINE_API_KEYS`：逗号分隔的首次导入 Key
- `KEY_COOLDOWN_SECONDS`：限额 Key 冷却秒数，默认 300
- `HEALTHCHECK_MODEL`：管理页手动探针使用的 Seed 模型，默认 `doubao-seed-2.0-lite`
- `ROTATE_INTERVAL_SECONDS`：sticky 轮换检测间隔（秒），默认 30，设为 `0` 可禁用

管理页分别展示每个 Key 的鉴权状态和当前调用状态，并展示冷却/配额重置时间、额度周期、累计请求和失败次数。打开管理页时会自动检测一次，也可点击“检查所有 Key”重检。服务使用 `doubao-seed-2.0-lite` 执行极短输入、最多 16 token 输出的最小生成，从而验证 Key、模型权限和当前额度。Coding Plan 兼容接口不提供精确剩余额度，页面不展示该字段。

服务端会按 `ROTATE_INTERVAL_SECONDS` 定时扫描 sticky Key 之外的其他可用 Key（排除名称含 `%我的%` 的 Key），对候选执行最小探针，探针通过后将 sticky 切换到该 Key，避免始终粘滞在同一个 Key 上。

OpenCode 请求会正常触发 Key 自动轮换。当所有 Key 均无额度、处于限流状态或不可使用时，代理返回 HTTP 429，并在错误正文中提供 `proxy_all_keys_quota_exhausted` 或 `proxy_all_keys_unavailable` 类型、各类 Key 数量及最早预计恢复时间。

## 安全提示

本项目按需求不包含登录鉴权。请仅监听可信内网，并使用防火墙限制 `8787` 端口来源。管理接口可查看状态、添加及删除 Key，但永远不会把完整 Key 返回前端。
