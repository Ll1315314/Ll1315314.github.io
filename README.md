# Romy · 个人博客 + 作品集

我的个人网站，中英双语，用 [VitePress](https://vitepress.dev) 搭建、部署在 GitHub Pages。

🌐 **在线地址：[https://ll1315314.github.io](https://ll1315314.github.io)**

一半是**博客**——记录技术实践、踩坑复盘和想清楚的问题；一半是**作品集**——把值得讲的项目讲明白。

---

## 本地预览

需要 [Node.js](https://nodejs.org) 18+。

```bash
npm install     # 首次安装依赖（只需一次）
npm run dev      # 启动本地预览 → http://localhost:5173
```

改任何 `.md` 保存后浏览器会自动刷新。

## 写一篇新文章

1. 在 `docs/blog/` 下新建 `.md` 文件（英文放 `docs/en/blog/`），开头写：
   ```markdown
   ---
   title: 文章标题
   date: 2026-08-01
   ---

   # 文章标题

   正文……
   ```
2. 到 `docs/blog/index.md` 加一行链接。
3.（可选）到 `docs/.vitepress/config.mts` 的 `sidebar` 里加一行，左侧目录就会出现。

## 更新网站

在 IDEA 里改完内容 → **Commit**（⌘K）→ **Push**（⌘⇧K）。
推送后 GitHub Actions 会自动构建部署，1~3 分钟后线上生效。

## 目录结构

```
docs/
├─ index.md          # 中文首页
├─ projects.md       # 作品集
├─ about.md          # 关于
├─ blog/             # 中文博客
├─ en/               # 英文（首页/作品集/关于/博客）
└─ .vitepress/
   ├─ config.mts     # 站点配置（导航、双语、站点名）
   └─ theme/custom.css  # 马卡龙配色
```

## 换配色

配色变量集中在 `docs/.vitepress/theme/custom.css` 顶部，浅色/深色各一组，改 `--vp-c-*` 即可。

---

<sub>Built with VitePress · © Romy</sub>
