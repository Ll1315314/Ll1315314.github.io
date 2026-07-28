---
title: 把定时监控从「每分钟 tick」重构成动态 Cron
date: 2026-07-24
---

# 把定时监控从「每分钟 tick」重构成动态 Cron

> 让运营在前端改完调度频率就即时生效、不用重启，还要在多实例部署下不重复执行。

## 旧实现的问题

最初的调度器是这样的：一个固定「每分钟醒一次」的定时任务，每次醒来读一下开关和间隔配置，判断到没到点。看起来能用，但有几个硬伤：

- **频率表达能力弱**：只能表达「每 N 分钟」，做不到业务真正想要的「每天 04:00」「每天两次」这种；
- **每分钟空转**：大多数 tick 什么都不干；
- **改频率的语义模糊**，前端配置和实际行为对不上。

## 重构：动态 Cron

核心换成 `ThreadPoolTaskScheduler` + `CronTrigger`，把 cron 表达式存进数据库：

```java
// 前端改了 cron → 后端重新调度
public synchronized void reschedule(String cron) {
    if (future != null) {
        future.cancel(false);            // 取消旧的调度
    }
    if (cron == null || cron.isBlank()) {
        return;                          // 空 = 关闭，不设 trigger
    }
    future = taskScheduler.schedule(
        this::runTask,
        new CronTrigger(cron)            // 用新的 cron 重新排
    );
}
```

于是：

- 前端改完 cron，后端 `cancel` 掉旧的 `ScheduledFuture`、`reschedule` 一个新的，**即时生效、不重启**；
- 接口语义也从 `{enabled}` 演进成 `{cron}`（关闭就是不设 trigger），前端从「开关 + 两个频率输入框」统一成一个 cron 下拉。

## 多实例下不重复执行

一旦多实例部署，同一个 cron 到点时每个实例都会触发，任务就会被重复执行。这里用 **Redisson 分布式锁**收口：

```java
private void runTask() {
    RLock lock = redisson.getLock("monitor:task-lock");
    // tryLock(等待0, 租约由 watchdog 自动续期)
    if (!lock.tryLock(0, -1, TimeUnit.SECONDS)) {
        return;                          // 没抢到锁 = 别的实例在跑，直接退出
    }
    try {
        doMonitor();
    } finally {
        lock.unlock();
    }
}
```

选 Redisson 而不是自己 `SETNX` 的关键原因是它的 **watchdog 自动续期**：只要持锁线程还活着，锁的 TTL 会被周期性延长，避免「任务没跑完锁先过期、另一个实例又进来」；而如果持锁进程整个挂了，watchdog 停止续期，锁在 TTL 到期后自动释放，不会死锁。

## 顺手做的加固

重构时把之前埋的几个坑一起清了：

- **去掉定时任务里的大事务**，让锁的边界和事务边界都干净；
- **手动触发也走同一把 Redis 锁**，避免和定时任务叠加；
- 用 `AtomicBoolean` 做进程内去重，防止同一实例内叠加触发。

## 小结

这次重构的价值不在于「换了个调度 API」，而在于把三件事分清楚了：

1. **调度表达**（Cron）——业务想要的频率能被准确表达；
2. **生效方式**（cancel + reschedule）——配置改动即时生效，运维零介入；
3. **并发正确性**（分布式锁 + watchdog）——多实例下不重复、不死锁。

这三层各管一件事，合起来才是一个能长期高频跑、又不用天天盯着的调度系统。
