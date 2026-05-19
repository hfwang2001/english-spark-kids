import { writeFile } from "node:fs/promises";
import { words } from "../src/words.js";

const prompts = words.map((word) => ({
  file: `assets/cards/${word.id}.png`,
  model: "image-2",
  prompt: [
    "Use case: scientific-educational",
    "Asset type: square word-card image for a 3-6 year old English learning web game",
    `Primary request: create a joyful, high-polish 3D cartoon image of "${word.english}" (${word.chinese}).`,
    "Style: bright preschool learning game, chunky rounded shapes, tactile toy-like materials, expressive but simple.",
    "Composition: centered subject, full object visible, generous padding, dynamic sparkle accents, no text, no watermark.",
    `Color cue: use ${word.color} as the main accent and ${word.accent} as the secondary accent.`,
    "Background: clean layered scene with soft depth, suitable for a flashy word card."
  ].join("\n")
}));

await writeFile("image-2-card-prompts.json", JSON.stringify(prompts, null, 2));
console.log(`Wrote ${prompts.length} image-2 prompts to image-2-card-prompts.json`);
