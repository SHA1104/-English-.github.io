# 识拉丁 · 手机网页正式版

架构：

- 前端：HTML + CSS + JavaScript
- 托管：GitHub Pages
- 登录/云数据：Supabase Auth + Postgres
- AI：Supabase Edge Function（可选，DeepSeek Key 放服务器端）
- 手机/电脑：同一个账号自动同步学习记录

## 1. 建 Supabase

进入 Supabase 项目 → SQL Editor，把 `supabase.sql` 全部执行。

然后在 Project Settings → API 找到：

- Project URL
- Publishable key / anon key

把它们填入 `config.js`。

**不要**把 `service_role` key 放进 `config.js`。

## 2. GitHub Pages

把整个文件夹上传到 GitHub 仓库，例如：

`index.html`
`app.js`
`style.css`
`config.js`
`words.js`
`supabase.sql`

GitHub → Settings → Pages → Deploy from branch → `main` / root。

网页地址类似：

`https://你的用户名.github.io/仓库名/`

## 3. 登录

第一次打开网页：

1. 注册邮箱和密码
2. 登录
3. 学习记录写入 Supabase
4. 手机打开同一个网址并登录同一个账号，即可看到同一套记录

## 4. 当前版本保留的核心功能

- 现有 CORE_100 词库
- 新词 / 已学习状态
- SRS 复习
- “我认识 / 还不认识”
- 中文释义测试
- 词形训练
- 错题 / 错词形记录
- 手机响应式界面
- Supabase 云端同步
- GitHub Pages 静态部署

## 5. AI 新词

不要把 DeepSeek API Key 放进前端。

推荐下一步部署 Supabase Edge Function：

`supabase/functions/latin-ai/index.ts`

然后在 Supabase Secrets 设置：

`DEEPSEEK_API_KEY=你的Key`

前端通过 Edge Function 请求 AI。

这样 GitHub Pages 上公开的 JS 不包含你的 DeepSeek Key。
