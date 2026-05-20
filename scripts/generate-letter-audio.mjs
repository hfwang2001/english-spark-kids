import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
loadLocalEnv();

const dashscopeKey = process.env.DASHSCOPE_API_KEY;
const dashscopeBaseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com";
const outDir = join(root, "public", "audio", "letters");
const letters = "abcdefghijklmnopqrstuvwxyz".split("");

if (!dashscopeKey) {
  console.error("Missing DASHSCOPE_API_KEY. Put it in .env before generating letter audio.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const manifest = { letters: {} };

for (const letter of letters) {
  const fileName = `${letter}.mp3`;
  const filePath = join(outDir, fileName);
  console.log(`Generating ${fileName}...`);

  const response = await fetch(`${dashscopeBaseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${dashscopeKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen3-tts-flash",
      input: {
        text: letter.toUpperCase(),
        voice: "Serena",
        language_type: "English"
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  const audioUrl = payload?.output?.audio?.url || payload?.output?.audio_url || payload?.output?.url;
  if (!response.ok || !audioUrl) {
    console.error(`Failed to generate ${letter}:`, JSON.stringify(payload));
    process.exit(1);
  }

  const audio = await fetch(audioUrl);
  if (!audio.ok) {
    console.error(`Failed to download ${letter}: ${audio.status}`);
    process.exit(1);
  }

  await writeFile(filePath, Buffer.from(await audio.arrayBuffer()));
  manifest.letters[letter] = `/audio/letters/${fileName}`;
}

writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Saved ${letters.length} letter audios to ${outDir}`);

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
