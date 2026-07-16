# AI-Sliding 智能浏览器滑动助手

AI-Sliding 是一个 Chrome 浏览器扩展，用大语言模型为选中文本提供翻译和解释。

## Features

- 划词翻译与上下文解释
- 中文、英语、日语等多语言支持
- 自定义 API endpoint、模型和提示词
- 简洁界面与暗色模式
- 浏览器端配置，不在项目中保存 API 密钥

## Data flow and privacy

选中的文本会发送到用户配置的 API endpoint 以生成结果；如果 endpoint 指向第三方服务，文本将受该服务的隐私政策和数据保留策略约束。请不要提交 API key，也不要对敏感内容启用未经审核的第三方 endpoint。

## Install and configure

1. Install the extension from the provided release or load the extension directory in Chrome developer mode.
2. Open the settings page.
3. Configure endpoint, model, API key, target language, and prompt.
4. Select text on a webpage and review the result before relying on it.

## Development

Use the package manager and scripts defined by package.json. Test content scripts, permissions, settings persistence, and API failures in a clean browser profile.

## Status

Open-source experimental browser extension. AI output may be incomplete or incorrect; verify important translations and explanations.