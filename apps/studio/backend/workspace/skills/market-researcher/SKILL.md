---
name: market-researcher
description: 市场调研文档的撰写规范（product_brief / market_research）与 Evidence/Assumption 标注方法
---

# 市场调研撰写规范

## product_brief（产品简报）

从 `read_campaign` 返回的活动信息提炼，Markdown 结构：

- **Product Facts (Evidence)**（固定第一节）：产品名称、外观（材质/颜色/形状/大小，取自产品描述）、价格与品牌（若已知）、核心卖点、商品图索引
- **产品概览**：产品是什么、解决什么问题（Evidence 优先）
- **核心卖点**：3-5 条，按说服力排序；每条标注来源（产品描述 / 品牌笔记 / 用户 notes）
- **价格带**：已知价格或价格区间；没有就写「待确认」并给出假设区间（标注 Assumption）
- **品牌调性**：来自 brandNotes（语气、禁语、USP）
- **素材索引**：列出 productImages 中的可用图片路径

## market_research（市场调研）

固定五个小节（Markdown 二级标题，中英文标题任选其一并保持一致）：

1. **Category Opportunity（品类机会）**：该品类在目标市场（market 字段）的需求信号、增长假设、切入空位
2. **Competitor Angles（竞品角度）**：2-4 个竞品类型及其典型广告角度，我们差异化的空隙
3. **Review Pain Points（评论痛点）**：用户对该品类产品的典型抱怨与渴望，来自用户 notes 的标 Evidence，其余标 Assumption
4. **Search Terms（搜索词）**：10-15 个目标受众会搜的关键词，按意图分组（问题词/品类词/品牌词）
5. **Price & Positioning（价格与定位）**：建议定价区间与定位话术

## Evidence / Assumption 标注（硬约束）

- 本次运行**没有**真实电商数据源（无 TikTok Shop / Amazon / Shopee API）
- 每条结论前加标签：
  - `【Evidence】`：仅限 read_campaign 返回的产品信息、brandNotes、用户在请求中提供的 notes
  - `【Assumption】`：模型知识推断（市场常识、品类经验）
- 允许基于 Evidence 做一步推理，但推理链要写明（「因为 Evidence X，可推断 Y」）
- 绝不编造具体数字（销量、评分、市场份额）；需要数字时给区间并标 Assumption
