# Docker 部署说明

## 交付内容

可直接上传 `volcengine-key-rotation-proxy-1.0.0.zip`。解压后进入项目目录，再按照本文启动服务。

部署目录需要包含以下文件：

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `package.json`
- `package-lock.json`
- `src/`
- `public/`
- `data/.gitkeep`

不要复制 `data/keys.json`、`.env` 或任何包含真实 Key 的文件。

## 使用 Docker Compose 启动

在部署主机执行：

```bash
mkdir -p data
chmod 700 data
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f volcengine-proxy
```

验证服务：

```bash
curl http://127.0.0.1:8787/health
```

浏览器打开 `http://部署主机地址:8787/`，在管理页面添加 Coding Plan Key。Key 会保存到部署主机的 `data/keys.json`，请限制该目录权限：

```bash
chmod 700 data
chmod 600 data/keys.json
```

## 生成并转移 Docker 镜像

在具备 Docker 引擎的构建主机执行：

```bash
docker build -t volcengine-key-rotation-proxy:1.0.0 .
docker save volcengine-key-rotation-proxy:1.0.0 | gzip > volcengine-key-rotation-proxy-1.0.0.tar.gz
```

将 `volcengine-key-rotation-proxy-1.0.0.tar.gz` 和 `docker-compose.yml` 复制到部署主机，再执行：

```bash
gunzip -c volcengine-key-rotation-proxy-1.0.0.tar.gz | docker load
mkdir -p data
chmod 700 data
docker compose up -d
```

如果使用镜像归档启动，需要把 `docker-compose.yml` 中的 `build: .` 改为：

```yaml
image: volcengine-key-rotation-proxy:1.0.0
```

## 配置项

`docker-compose.yml` 已提供适合内网运行的默认值：

- 容器端口 `8787`，映射为主机端口 `8787`
- `KEY_COOLDOWN_SECONDS=300`
- `HEALTHCHECK_MODEL=doubao-seed-2.0-lite`
- 数据目录挂载到 `./data`

需要修改端口时，调整 `ports` 左侧端口，例如 `18080:8787`。需要修改上游地址或冷却时间时，在 `environment` 中增加对应配置。首次启动也可以通过 `VOLCENGINE_API_KEYS` 导入逗号分隔的 Key；导入完成后应从环境配置中删除该变量。

## 更新与停止

```bash
docker compose build
docker compose up -d
```

使用镜像归档时，加载新归档后执行：

```bash
docker compose up -d
```

停止服务并保留 Key 数据：

```bash
docker compose down
```

删除 `data/` 会删除持久化 Key，请先确认已经完成备份或迁移。

## OpenCode 配置

将 `baseURL` 设置为：

```text
http://部署主机地址:8787/api/coding/v3
```

`apiKey` 可以填写任意非空占位值，代理会使用管理页面中保存的 Key 请求火山方舟。

## 内网安全边界

本项目不提供登录鉴权。只允许可信内网访问 `8787` 端口，并在防火墙中限制来源。不要将端口映射到公网，也不要把 `data/keys.json` 纳入代码仓库或镜像归档。
