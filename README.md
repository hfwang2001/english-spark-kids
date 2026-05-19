# English Spark Kids

一个给 3-6 岁小朋友玩的英语词卡网页游戏原型。

## 功能

- 20 张生活高频词卡：图片、英文、中文、炫酷配色。
- 背单词页：词卡高速旋转，逐张展示并自动朗读英文、中文、跟读提示、拼写、英文、中文。
- 听读闯关页：隐藏英文，识别小朋友读音，读对进入奖励动画。
- 奖励页：当前单词拟人化动画，并用英文自我介绍。
- 总结页：展示全部词卡，并朗读 today we learn about ...

## 运行

```bash
npm install
npm run dev
```

然后打开 Vite 输出的本地地址。

## Qwen TTS / ASR

前端默认优先调用本地 `/api/tts` 的 Qwen 代理；如果没有启动代理或没有配置 key，会自动降级到浏览器内置 `speechSynthesis`，方便无配置演示。生产环境必须把 Qwen TTS/ASR 放在后端代理里，避免把 API key 暴露到浏览器。

```bash
cp .env.example .env
# 把 DASHSCOPE_API_KEY 放进 .env 或 shell 环境变量
PORT=4173 DASHSCOPE_API_KEY=你的key npm run server
```

当前 `/api/tts` 使用 `qwen3-tts-flash`。ASR 建议同样做成后端上传音频代理，浏览器端先保留无 key 的实时演示版本。

## image-2 词卡图片

生成 20 张 image-2 词卡图片提示词：

```bash
npm run generate:image-prompts
```

脚本会生成 `image-2-card-prompts.json`。把生成得到的图片保存到 `assets/cards/<word-id>.png` 后，可把 `src/app.js` 里的 `cardImage()` 从 emoji 占位换成图片路径。
