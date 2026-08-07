import { defineConfig } from 'vitepress'

// ────────────────────────────────────────────────────────────────
// 上线前需要改的地方，全部集中在这里 3 个常量：
//   NAME    —— 网站显示的名字（首页大标题、标签页、页脚都会用它）
//   GITHUB  —— 你的 GitHub 用户名（用于右上角图标 + 页脚链接）
//   BASE    —— 部署路径，见下方说明
// ────────────────────────────────────────────────────────────────
const NAME = 'Romy'                          // 👈 改成你的名字 / 昵称
const GITHUB = 'Ll1315314'                   // 👈 改成你的 GitHub 用户名

// BASE 说明：
//  · 如果仓库名叫 <用户名>.github.io（用户主页站）→ 用 '/'
//  · 如果是普通项目仓库（比如叫 blog）→ 用 '/仓库名/'，例如 '/blog/'
//  · 如果绑了自定义域名（如 blog.你的域名.com）→ 用 '/'
const BASE = '/'                             // 👈 按上面说明改

export default defineConfig({
  base: BASE,
  lang: 'zh-CN',
  title: NAME,
  description: `${NAME} 的个人博客与作品集 · Personal blog & portfolio`,
  cleanUrls: true,
  lastUpdated: false,
  head: [
    ['meta', { name: 'author', content: NAME }],
    ['meta', { name: 'theme-color', content: '#1f6f6b' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: NAME }]
  ],

  themeConfig: {
    logo: undefined,
    socialLinks: [
      { icon: 'github', link: `https://github.com/${GITHUB}` }
    ],
    search: { provider: 'local' }
  },

  // ── 中英双语 ──────────────────────────────────────────────────
  locales: {
    // 中文为默认语言，网址在根路径 /
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '作品集', link: '/projects' },
          { text: '博客', link: '/blog/' },
          { text: '关于', link: '/about' }
        ],
        sidebar: {
          '/blog/': [
            {
              text: '文章',
              items: [
                { text: '全部文章', link: '/blog/' },
                { text: '把 1500 行自动化删掉：像素阈值的隐式依赖', link: '/blog/2026-08-06-deleting-screen-automation' },
                { text: '批量发布的难点是记账：排期设计', link: '/blog/2026-07-31-batch-publish-scheduling' },
                { text: '用真实订单做 Ground Truth', link: '/blog/2026-07-28-ground-truth-conversion' },
                { text: 'dHash 前置去重降本 8 倍', link: '/blog/2026-07-27-dhash-prefilter' },
                { text: '前台搜索为什么会卡：下游额度隔离', link: '/blog/2026-07-26-rate-limit-isolation' },
                { text: '让大模型自己写 SQL 又不越权', link: '/blog/2026-07-25-safe-sql-agent' },
                { text: '用公开页替代付费接口做数据快照', link: '/blog/2026-07-24-public-page-scraping' },
                { text: '把定时监控重构成动态 Cron', link: '/blog/2026-07-24-dynamic-cron-scheduler' }
              ]
            }
          ]
        },
        outline: { label: '本页目录', level: [2, 3] },
        docFooter: { prev: '上一篇', next: '下一篇' },
        lastUpdatedText: '最后更新',
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '深浅色',
        footer: {
          message: '用 VitePress 构建 · 内容以 CC BY 4.0 授权',
          copyright: `© ${new Date().getFullYear()} ${NAME}`
        }
      }
    },

    // 英文在 /en/ 路径下
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Projects', link: '/en/projects' },
          { text: 'Blog', link: '/en/blog/' },
          { text: 'About', link: '/en/about' }
        ],
        sidebar: {
          '/en/blog/': [
            {
              text: 'Posts',
              items: [
                { text: 'All posts', link: '/en/blog/' },
                { text: 'Deleting the automation: a screen in the threshold', link: '/en/blog/2026-08-06-deleting-screen-automation' },
                { text: 'Batch publishing is a bookkeeping problem', link: '/en/blog/2026-07-31-batch-publish-scheduling' },
                { text: 'Real orders as conversion ground truth', link: '/en/blog/2026-07-28-ground-truth-conversion' },
                { text: 'An O(1) perceptual hash cuts vision cost 8×', link: '/en/blog/2026-07-27-dhash-prefilter' },
                { text: 'Why front-end search stalls: quota isolation', link: '/en/blog/2026-07-26-rate-limit-isolation' },
                { text: 'Letting the model write SQL, safely', link: '/en/blog/2026-07-25-safe-sql-agent' },
                { text: 'Public-page INITIAL_STATE instead of a paid API', link: '/en/blog/2026-07-24-public-page-scraping' },
                { text: 'Per-minute tick scheduler → dynamic cron', link: '/en/blog/2026-07-24-dynamic-cron-scheduler' },
                { text: 'Hello — about this site', link: '/en/blog/2026-07-hello' }
              ]
            }
          ]
        },
        outline: { label: 'On this page', level: [2, 3] },
        footer: {
          message: 'Built with VitePress · Content under CC BY 4.0',
          copyright: `© ${new Date().getFullYear()} ${NAME}`
        }
      }
    }
  }
})
