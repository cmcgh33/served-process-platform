import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!;
const KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY!;
if (!BASE || !KEY) throw new Error("Missing OPENAI integration env vars");

const SCENES: Array<{ key: string; text: string }> = [
  {
    key: "open",
    text: "Process serving in Nevada has been stuck in the past for too long. SERVED. is the modern way for Nevada attorneys to get papers served — fast, transparent, and built for your practice.",
  },
  {
    key: "postJob",
    text: "Posting a job takes about a minute. Add the recipient, choose from nineteen Nevada-curated document types, and pick how the server gets your papers — pickup or print at the office. Done.",
  },
  {
    key: "pricing",
    text: "Our pricing is transparent — no surprise fees, ever. Solo, at ninety-nine a month, gives you sixty-five-dollar standard serves and pays for itself in just ten serves. Firm — our most popular plan — drops standard serves to sixty dollars and rush serves to seventy-nine, for one ninety-nine a month. And Firm Pro, at two ninety-nine, brings standard serves down to fifty-five dollars with priority support.",
  },
  {
    key: "tracking",
    text: "Once a server picks up your job, you'll see live GPS tracking — every attempt, every photo, every note, in real time on a map you can share with your client.",
  },
  {
    key: "vault",
    text: "All your served documents and signed affidavits live in your Cloud Vault — searchable by case number or matter, with up to a hundred gigabytes included.",
  },
  {
    key: "close",
    text: "SERVED. — built in Nevada, for Nevada attorneys. Book a thirty-minute walkthrough at calendly dot com slash servedapp dash info slash thirty min, or reach us anytime at info at servedapp dot co.",
  },
];

const OUT_DIR = "/tmp/served-vo";
mkdirSync(OUT_DIR, { recursive: true });

async function tts(text: string, idx: number): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: "gpt-audio",
      modalities: ["text", "audio"],
      audio: { voice: "nova", format: "mp3" },
      messages: [
        {
          role: "system",
          content:
            "You are a warm, confident product narrator for a B2B legal-tech demo. Speak conversationally at a brisk pace (~165 wpm). Read the user's text VERBATIM with natural emphasis. Do not add any commentary or sound effects.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`tts ${idx} failed: ${res.status} ${await res.text()}`);
  const json: any = await res.json();
  const b64 = json.choices?.[0]?.message?.audio?.data;
  if (!b64) throw new Error(`tts ${idx} returned no audio: ${JSON.stringify(json).slice(0, 300)}`);
  const path = join(OUT_DIR, `scene-${idx}.mp3`);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

const paths: string[] = [];
for (let i = 0; i < SCENES.length; i++) {
  console.log(`Generating scene ${i} (${SCENES[i].key})...`);
  paths.push(await tts(SCENES[i].text, i));
}

const concatList = paths.map((p) => `file '${p}'`).join("\n");
writeFileSync(join(OUT_DIR, "list.txt"), concatList);

const finalPath = "/home/runner/workspace/artifacts/attorney-demo/public/voiceover.mp3";
const ff = spawnSync(
  "ffmpeg",
  ["-y", "-f", "concat", "-safe", "0", "-i", join(OUT_DIR, "list.txt"), "-c:a", "libmp3lame", "-b:a", "128k", finalPath],
  { stdio: "inherit" },
);
if (ff.status !== 0) throw new Error("ffmpeg concat failed");

const durations: Record<string, number> = {};
let cumulative = 0;
for (let i = 0; i < SCENES.length; i++) {
  const p = paths[i];
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p],
    { encoding: "utf8" },
  );
  const dur = parseFloat(probe.stdout.trim());
  const padMs = i === SCENES.length - 1 ? 800 : 400;
  const ms = Math.round(dur * 1000) + padMs;
  durations[SCENES[i].key] = ms;
  cumulative += ms;
  console.log(`  ${SCENES[i].key}: ${dur.toFixed(2)}s -> ${ms}ms (cumulative ${cumulative}ms)`);
}

console.log("\nSCENE_DURATIONS =", JSON.stringify(durations, null, 2));
console.log(`Total: ${cumulative}ms`);
