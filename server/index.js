import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd());
loadLocalEnv();
const port = Number(process.env.PORT || 4173);
const dashscopeKey = process.env.DASHSCOPE_API_KEY;
const dashscopeBaseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com";
const dashscopeCompatBaseUrl = process.env.DASHSCOPE_COMPAT_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/tts") {
      await handleTts(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/asr") {
      await handleAsr(request, response);
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolveStaticPath(path);
    if (!filePath.startsWith(root)) {
      send(response, 403, "Forbidden");
      return;
    }
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch (error) {
    send(response, 404, "Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`English Spark Kids running at http://127.0.0.1:${port}`);
});

async function handleTts(request, response) {
  if (!dashscopeKey) {
    sendJson(response, 501, { error: "DASHSCOPE_API_KEY is not configured." });
    return;
  }

  const { text, lang, style } = await readJson(request);
  if (!text || typeof text !== "string") {
    sendJson(response, 400, { error: "Missing text." });
    return;
  }

  const languageType = resolveLanguageType(text, lang);
  const voice = resolveVoice(languageType);
  const instructions = buildTtsInstructions(text, languageType, style);

  const dashscopeResponse = await fetch(`${dashscopeBaseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${dashscopeKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen3-tts-instruct-flash",
      input: {
        text,
        voice,
        language_type: languageType
      },
      instructions,
      optimize_instructions: true
    })
  });

  const payload = await dashscopeResponse.json().catch(() => ({}));
  const audioUrl = payload?.output?.audio?.url || payload?.output?.audio_url || payload?.output?.url;
  if (!dashscopeResponse.ok || !audioUrl) {
    sendJson(response, 502, { error: "Qwen TTS request failed.", detail: payload });
    return;
  }

  const audio = await fetch(audioUrl);
  response.writeHead(audio.status, { "Content-Type": audio.headers.get("content-type") || "audio/mpeg" });
  response.end(Buffer.from(await audio.arrayBuffer()));
}

async function handleAsr(request, response) {
  if (!dashscopeKey) {
    sendJson(response, 501, { error: "DASHSCOPE_API_KEY is not configured." });
    return;
  }

  const contentType = request.headers["content-type"] || "audio/webm";
  const audio = await readBuffer(request, 10 * 1024 * 1024);
  if (!audio.length) {
    sendJson(response, 400, { error: "Missing audio." });
    return;
  }

  const dataUrl = `data:${contentType};base64,${audio.toString("base64")}`;
  const dashscopeResponse = await fetch(`${dashscopeCompatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${dashscopeKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen3-asr-flash",
      messages: [
        {
          role: "system",
          content: [
            {
              text: "Recognize short English words spoken by preschool children. The vocabulary includes: apple, banana, cat, dog, ball, car, sun, moon, star, fish, bird, flower, tree, book, chair, milk, water, shoes, hat, teddy bear."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: dataUrl
              }
            }
          ]
        }
      ],
      stream: false,
      asr_options: {
        language: "en",
        enable_itn: false
      }
    })
  });

  const payload = await dashscopeResponse.json().catch(() => ({}));
  const text = payload?.choices?.[0]?.message?.content || payload?.output?.choices?.[0]?.message?.content?.[0]?.text || "";
  if (!dashscopeResponse.ok || !text) {
    sendJson(response, 502, { error: "Qwen ASR request failed.", detail: payload });
    return;
  }

  sendJson(response, 200, { text, detail: payload?.choices?.[0]?.message?.annotations || [] });
}

function readJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolveJson(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readBuffer(request, maxBytes) {
  return new Promise((resolveBuffer, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.destroy();
        reject(new Error("Payload too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function resolveLanguageType(text, lang) {
  if (lang === "auto") return "Auto";
  if (containsChinese(text) && /[a-z]/i.test(text)) return "Auto";
  if (lang === "zh-CN") return "Chinese";
  if (lang === "en-US") return "English";
  return containsChinese(text) ? "Chinese" : "English";
}

function resolveVoice(languageType) {
  return languageType === "English" ? "Serena" : "Cherry";
}

function buildTtsInstructions(text, languageType, style = "default") {
  if (style === "learn-bilingual") {
    return "Use a warm, lively female preschool teacher voice. Read the English word clearly first, make a brief natural pause, then read the Chinese translation smoothly. Keep the whole phrase short, connected, and encouraging.";
  }

  if (style === "read-after-me") {
    return "Use a warm, friendly female teacher voice for preschool children. Say the Chinese part naturally, and speak the English phrase read after me clearly with a light emphasis. Keep it playful and encouraging.";
  }

  if (style === "reward") {
    return "Use a cheerful, playful female voice for preschool children. Sound excited, encouraging, and full of positive energy.";
  }

  if (style === "summary") {
    return "Use a warm, patient female teacher voice. Speak clearly and naturally, with a gentle classroom rhythm suitable for preschool children.";
  }

  if (languageType === "Auto") {
    return "Use a natural, friendly female voice. Handle mixed Chinese and English smoothly, with clear pronunciation and gentle, connected pauses.";
  }

  if (languageType === "English") {
    return "Use a clear, friendly female voice. Pronounce English naturally and clearly, with a smooth and connected rhythm.";
  }

  if (containsChinese(text)) {
    return "Use a warm, clear female voice. Speak naturally in Chinese with smooth pacing and a gentle, friendly tone.";
  }

  return "Use a natural, clear female voice with smooth pacing.";
}

function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}

function resolveStaticPath(path) {
  const directPath = join(root, path);
  if (existsSync(directPath)) return directPath;
  return join(root, "public", path);
}

function loadLocalEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
