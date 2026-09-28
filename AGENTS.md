# AGENTS.md

## 范围与目标

本文件适用于整个仓库。

项目是供可信内网使用的火山方舟 Coding Plan Key 轮换代理。OpenCode 通过 OpenAI 兼容接口连接本服务；服务管理 Key、转发流式响应，并在鉴权、订阅、限流或配额错误时自动切换 Key。管理页面按需求不设登录，禁止暴露到公网，也不得扩展为通用 API 网关。

## 官方事实来源

Coding Plan 的协议、额度、工具和模型以官方文档及当前账号控制台为准：

- [火山方舟 Coding Plan 套餐概览](https://docs.volcengine.com/docs/82379/1925114?lang=zh)

修改上游接口、模型清单、错误解释或探针前必须重新核对官方文档，不得根据 OpenAI API 习惯猜测。官方页面截至 2026-09-15 说明：

- OpenAI 兼容地址为 `https://ark.cn-beijing.volces.com/api/coding/v3`。
- Anthropic 兼容地址为 `https://ark.cn-beijing.volces.com/api/coding`，本项目不代理该接口。
- Coding Plan 只能用于官方支持的 AI 编程工具；使用其他地址或用途可能不抵扣套餐并产生额外费用或账号风险。
- 套餐额度在工具间共享，可能包含 5 小时、周和订阅月周期；精确可用次数取决于模型、上下文和思考模式。
- 客户端模型标识必须原样转发，不得静默替换。

当前配置页面提供以下文档模型快照，不作为代理白名单：

- `auto`、`ark-code-latest`
- `doubao-seed-2.1-turbo`、`doubao-seed-evolving`、`doubao-seed-2.0-lite`
- `minimax-m3`
- `kimi-k2.7-code`、`kimi-k3`
- `glm-5.3`、`glm-5.3-flash`
- `deepseek-v4-flash`、`deepseek-v4-pro`

## 当前行为

- 代理入口：`/api/coding/v3`。
- Key 存储于 Git 忽略的 `data/keys.json`，采用原子写入和 `0600` 权限。
- 客户端 `Authorization` 必须被当前 Key 覆盖，完整 Key 不得返回前端或写入日志。
- 正常响应和 SSE 流直接透传；响应开始后不得换 Key 重试。
- `401/402/403/429`、`AccountQuotaExceeded` 和 `InvalidSubscription` 会更新状态并切换 Key。
- `AccountQuotaExceeded` 优先使用上游返回的重置时间，否则采用配置的临时冷却时间。
- 管理页打开时执行一次最小 Seed 模型探针，也允许手动重检；服务端可定时扫描并验证 sticky 之外的恢复 Key（见下）。
- 服务端按 `ROTATE_INTERVAL_SECONDS`（默认 30，0 禁用）定时扫描非 sticky、非 `%我的%` 名称且冷却已结束的 Key，对候选执行最小探针，通过后将 sticky 切到该 Key，避免长期粘滞同一 Key。轮换仅切换 sticky 优先顺序，不影响透传与失败自动切换语义。
- 上游未提供精确剩余额度时不展示或推测该数据。

## 实现约定

- 使用 Node.js 20+、ES Modules、Fastify 和平台内置 API；没有明确收益时不增加依赖或框架。
- 保留请求方法、查询参数、请求体、必要请求头、状态码和流式语义。
- 错误解析必须容错，并使用脱敏样例测试关键契约。
- 前端无需构建，保持窄屏可用；模型清单只维护一份。
- 不保留已被替代的兼容层、旧字段、预留接口或未使用配置。
- 修改行为时同步更新 `README.md`、`.env.example` 和测试。

## 安全

- 禁止提交 `.env`、`data/keys.json`、真实 Key、鉴权头或生产请求正文。
- 测试只能使用虚构 Key 和模拟响应，不得访问真实火山服务。
- 不添加遥测，不向第三方发送 Key 或其元数据。
- 删除或重写持久化数据必须目标明确并尽可能可恢复。

## 验证与运行

交付前运行：

```bash
npm test
node --check src/server.js
node --check src/proxy.js
node --check src/monitor.js
node --check src/rotator.js
node --check public/app.js
```

本地启动：`npm start`。容器启动：`docker compose up -d --build`。
