# 开发与提交约定

本仓库是非官方的 RustDesk Web 客户端，代码以 GNU AGPL-3.0-only 发布。不要把上游 `rustdesk/rustdesk` 的提交历史复制、摘取或重放进来。

## 环境

- Node.js 24（见 `.nvmrc`）
- Yarn 1.22.22
- 安装：`yarn install --frozen-lockfile`
- 联合启动：`yarn dev`
- 检查：`yarn typecheck` 与 `yarn lint`（两者都做类型检查）
- 测试：`yarn test`
- 构建：`yarn build`
- 本地容器：见 `README.zh-CN.md` 的 Docker 部署说明，使用根目录 `Dockerfile` 和 `docker-compose.yml`。生产模式必须设置 `RUSTDESK_GATEWAY_TOKEN`。不要推送镜像或打发布标签。

不要提交 `.env`、密钥、`node_modules` 或构建产物。`docs/migration/` 留在仓库外，已被忽略。

## 提交

作者和提交者都是 `suijiafeng <suijiafeng@hotmail.com>`。

提交说明只用一行英文 Conventional Commits，不写正文，不加 `Co-authored-by` 或其他 trailer。一行要写清这次提交增加或修好了什么。

按功能步骤拆分提交，每一步保持可以安装、检查和测试。不要按文件类型把互不相关的改动捆在一起。

示例：

```text
feat(gateway): serve a tested /api/health endpoint
fix(web): show the gateway status after a failed health request
```
