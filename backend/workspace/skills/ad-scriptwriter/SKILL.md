---
name: ad-scriptwriter
description: 广告创意（creatives）与 formatted script 的撰写规范——保证下游提取/分镜 Agent 可直接消费
---

# 广告脚本撰写规范

## 创意字段

每个 creative 必填：angle（差异化角度，短语）、hook（0-3 秒钩子原文）、format、platform、durationSec、cta（可空）、script（完整 formatted script）。

- **format** 六选一：ugc（真人口播/开箱感）、product_demo（产品演示）、problem_solution（问题→解决）、before_after（前后对比）、testimonial（证言）、unboxing（开箱）
- **durationSec**：15/30/45/60 为主；构思台词量时按「台词秒数 ≈ 字数 ÷ 语速」估算，装不下就砍
- **angle 差异化**：N 个创意之间角度不得重复（不同痛点、不同人群、不同场景切入）

## formatted script 格式（硬约束）

下游 extractor / storyboard_breaker 按此格式解析，**不得改动结构**：

```
## S1 | 内景 · 卧室 | 白天

（动作描写：自然段落，谁在哪里做什么，产品如何出现/被使用）

角色名：（状态/表情）台词内容
```

- 场景头：`## S编号 | 内景/外景 · 地点 | 时间段`
- 动作描写不含镜头语言（不说「特写」「推镜头」）
- 对白格式：`角色名：（状态/表情）台词内容`；旁白写 `旁白：内容`

## 内容规则

- **Hook 0-3 秒**：第一场第一句就是钩子（痛点质问/结果前置/反常识/价格冲击），钩子之后才铺陈
- **产品 = 道具**：产品以明确名称、具体外观写进动作描写，在画面中被拿取、使用或展示——让 extractor 能把它提取为 prop、storyboard 能给它特写。**产品名必须与 campaign 的 Product 字段完全一致**（不改写、不翻译、不简写），系统会按此名预挂真实商品参考图，名字对不上参考图就挂不上
- **总时长对齐 durationSec**：所有场景台词+动作时长合计 ≈ durationSec；单场景 15-60 秒，超长拆场
- **CTA**：脚本最后 3-5 秒落在 cta 上（有 cta 时）
- 只写可拍摄的内容；不要在脚本中出现「此处展示产品卖点」等元描述
