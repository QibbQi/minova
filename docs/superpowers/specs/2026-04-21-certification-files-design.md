# 认证文件支持设计方案

> **Date:** 2026-04-21
> **Topic:** 在报价业务中增加产品认证文件支持，提高报价页可扩展性

---

## 1. 需求概述

在报价业务中增加产品认证文件支持，采用混合模式：
- **公司级认证**：工厂 ISO 认证文件、UN38.3/MSDS 等运输文件，统一在公司信息面板管理
- **产品级认证**：TUV、IEC 认证、产品规格书，挂在具体产品档案上

报价生成时可灵活勾选附上哪些文件，PDF 中以链接列表形式展示。

---

## 2. 数据模型

### 2.1 公司级认证（新增节点）

在 `state.json` 的 `data` 下新增 `companyCerts` 节点：

```json
{
  "data": {
    "companyCerts": {
      "isoCerts": [
        {
          "id": "uuid",
          "name": "ISO9001-2023.pdf",
          "path": "minova-data/certifications/iso/ISO9001-2023.pdf",
          "uploadedAt": "2026-04-21T10:00:00Z"
        }
      ],
      "transportCerts": [
        {
          "id": "uuid",
          "name": "UN38.3_Test_Report.pdf",
          "path": "minova-data/certifications/transport/UN38.3_Test_Report.pdf",
          "uploadedAt": "2026-04-21T10:00:00Z"
        },
        {
          "id": "uuid",
          "name": "MSDS_Li-ion.pdf",
          "path": "minova-data/certifications/transport/MSDS_Li-ion.pdf",
          "uploadedAt": "2026-04-21T10:00:00Z"
        }
      ]
    }
  }
}
```

### 2.2 产品级认证（扩展 products 字段）

每个产品对象新增 `certifications` 字段：

```json
{
  "id": "P001",
  "name": "Solar Panel 400W",
  "vendor": "Trina",
  "category": "Solar Panel",
  "certifications": {
    "tuvCerts": [
      {
        "id": "uuid",
        "name": "TUV_IEC61215_400W.pdf",
        "path": "minova-data/certifications/products/P001/tuv/TUV_IEC61215_400W.pdf",
        "uploadedAt": "2026-04-21T10:00:00Z"
      }
    ],
    "specSheets": [
      {
        "id": "uuid",
        "name": "400W_Datasheet.pdf",
        "path": "minova-data/certifications/products/P001/specs/400W_Datasheet.pdf",
        "uploadedAt": "2026-04-21T10:00:00Z"
      }
    ]
  }
}
```

---

## 3. 存储结构

文件上传到 GitHub 仓库的 `minova-data/certifications/` 目录：

```
minova-data/
├── state.json
└── certifications/
    ├── iso/                          # 工厂ISO认证
    │   └── ISO9001-2023.pdf
    ├── transport/                    # 运输文件
    │   ├── UN38.3_Test_Report.pdf
    │   └── MSDS_Li-ion.pdf
    └── products/                     # 产品级认证
        └── {productId}/
            ├── tuv/                 # TUV/IEC认证
            │   └── TUV_IEC61215.pdf
            └── specs/               # 规格书
                └── 400W_Datasheet.pdf
```

---

## 4. UI 变更

### 4.1 产品清单页 - 公司信息面板（新增）

位置：产品清单页（database tab）顶部，在现有产品列表上方

功能：
- 显示公司名称（可编辑）
- 两个子区块：**工厂ISO认证** 和 **运输文件**
- 每个区块：文件列表（名称 + 上传时间）+ 上传按钮 + 删除按钮
- 点击文件名 → 新窗口预览

交互：
- 上传：点击上传按钮 → 选择文件 → Base64 编码 → 通过 GitHub API 提交到 `minova-data/certifications/` 目录
- 删除：点击删除 → 确认 → 从 GitHub 删除文件 + 更新 `state.json`
- 预览：点击文件名 → 拼接 GitHub Pages URL → `window.open()` 新窗口打开

### 4.2 产品编辑弹窗 - 认证文件区块（新增）

位置：现有产品编辑弹窗底部，在其他字段区域之下

功能：
- 两个子区块：**TUV/IEC认证** 和 **产品规格书**
- 每个区块：文件列表（名称 + 上传时间）+ 上传按钮 + 删除按钮 + 预览链接

交互：同上，上传到 `minova-data/certifications/products/{productId}/` 目录

### 4.3 报价生成 - 文件附选弹窗（新增）

时机：点击"生成报价（PDF）"按钮后，PDF 生成前

功能：
- 弹窗列出所有可选认证文件：
  - **公司级**（默认折叠，可展开）：
    - 工厂ISO认证（多选 checkbox）
    - 运输文件（多选 checkbox）
  - **产品级**（按本次报价选中的产品，自动列出有认证文件的产品）：
    - 每个产品展开其 TUV/IEC 认证 + 规格书（多选）
- 文件按类别分组，每类可选全选/全不选
- 底部显示已选文件数量汇总
- 确认后：勾选的文件链接以列表形式附加到 PDF 末尾

PDF 呈现：
```
附件：
公司级认证：
  □ ISO9001-2023.pdf
  □ UN38.3_Test_Report.pdf

产品级认证（P001 - Solar Panel 400W）：
  □ TUV_IEC61215_400W.pdf
  □ 400W_Datasheet.pdf
```

实际生成时只列出**打勾的**文件，每个文件显示为可点击的链接（GitHub Pages URL）。

---

## 5. 文件上传流程

### 5.1 前端 → GitHub 直传

利用已有的 `github-sync` 模块能力：

1. 用户选择文件，FileReader 读取为 Base64
2. 构造目标路径：`minova-data/certifications/{category}/{filename}`
3. 调用 GitHub API（通过 repoStore）检查文件是否存在（SHA）
4. 存在则更新，不存在则创建
5. 更新 `state.json` 中对应的 `companyCerts` 或 `product.certifications` 节点
6. 触发 snapshot enqueue

### 5.2 预览 URL 构造

GitHub Pages URL 格式：
```
https://{owner}.github.io/{repo}/{path}
```

示例：`https://QibbQi.github.io/minova/minova-data/certifications/iso/ISO9001-2023.pdf`

---

## 6. 报价可扩展性设计

认证文件是第一个可扩展附件类型。后续可类似扩展：
- 报价模板（不同格式的报价单样式）
- 合同附件
- 案例图片

数据结构设计为通用附件格式（id, name, path, uploadedAt），未来新增类型只需扩展节点即可，无需改动核心结构。

---

## 7. 状态管理

- `companyCerts` 作为独立节点存在 `data` 下，加载时合并到全局 `state.data`
- 产品 `certifications` 字段随产品一起保存和加载
- 上传/删除后立即调用 `saveToLocal()` 并 `enqueueSnapshot('cert update')`

---

## 8. 错误处理

- 文件上传失败：弹窗提示"上传失败，请重试"，不修改 state
- GitHub 文件删除失败：提示错误，保留文件记录
- 文件不存在（404）：显示"文件已丢失"标记，允许删除记录
- 预览打开失败：新窗口打开失败时，复制 URL 到剪贴板

---

## 9. 实现优先级

1. **Phase 1（核心）**：公司级认证 + 产品级认证的文件上传/删除/预览基础功能
2. **Phase 2（报价集成）**：报价生成时文件附选弹窗 + PDF 链接附加
3. **Phase 3（体验优化）**：拖拽上传、批量上传、文件大小限制提示
