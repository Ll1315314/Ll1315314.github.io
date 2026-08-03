# 博客

记录技术实践、踩坑复盘，和想清楚的问题。

## 2026

- **07-31** · [批量发布的难点不是点按钮，是记账——10 账号 × 225 条视频的排期设计](/blog/2026-07-31-batch-publish-scheduling)
  <br><small>一个取模运算解决排期，剩下 450 行都在防「跑得很顺利，然后发了重复内容」。</small>

- **07-28** · [别让 AI 猜「成没成单」——用真实订单做 Ground Truth](/blog/2026-07-28-ground-truth-conversion)
  <br><small>能拿到真值的地方就别让模型猜，AI 只做没有真值的软判断。</small>

- **07-27** · [用一个 O(1) 的感知哈希，把视觉大模型的推理成本降 8 倍](/blog/2026-07-27-dhash-prefilter)
  <br><small>高频截图里绝大多数帧没变化，用 dHash 前置去重挡掉大部分昂贵的模型调用。</small>

- **07-26** · [前台搜索为什么会「卡」——一次下游额度隔离的排查](/blog/2026-07-26-rate-limit-isolation)
  <br><small>想靠加并发解决卡顿，查到最后发现瓶颈根本不在并发度，而在共享的下游 API 额度。</small>

- **07-25** · [让大模型自己写 SQL 又不越权——一个客服数据分析 Agent 的设计](/blog/2026-07-25-safe-sql-agent)
  <br><small>Tool-Use + 受限 SQL + SSE：难点不是让它会查，而是安全地查、别烧钱、别乱编。</small>

- **07-24** · [用公开页 `INITIAL_STATE` 替代付费接口做数据快照](/blog/2026-07-24-public-page-scraping)
  <br><small>把第三方接口成本打到 0 的降本实践，以及为什么正文这条路我最终放弃了。</small>

- **07-24** · [把定时监控从「每分钟 tick」重构成动态 Cron](/blog/2026-07-24-dynamic-cron-scheduler)
  <br><small>前端改完即时生效、不重启，还要在多实例部署下不重复执行。</small>

---

<small>想加新文章？在 <code>docs/blog/</code> 下新建一个 <code>.md</code> 文件，再回到这里加一行链接就行。写法见仓库 README。</small>
