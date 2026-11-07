import { getState } from "./store";

/**
 * Pronunciation via the Gemini API (bring your own key). Audio is not cached:
 * every click makes a new request. Without a key, the browser's built-in
 * speech synthesis is used as a fallback.
 */

let current: AudioBufferSourceNode | null = null;
let ctx: AudioContext | null = null;

export async function speak(text: string): Promise<void> {
  const { geminiApiKey, ttsModel, ttsVoice, ttsAccent, browserVoice } = getState().settings;
  stop();
  if (!geminiApiKey) {
    await speakBrowser(text, ttsAccent, browserVoice);
    return;
  }
  const accent = ttsAccent === "uk" ? "a British (Received Pronunciation)" : "an American";
  const prompt = `Say clearly, in ${accent} English accent, at a natural pace: ${text}`;
  const bytes = await requestAudio(geminiApiKey, ttsModel, ttsVoice, prompt);
  await play(bytes);
}

export function stop(): void {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
  window.speechSynthesis?.cancel();
}

/** English voices offered by the browser/OS. The list may load asynchronously. */
export async function englishVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return [];
  const synth = window.speechSynthesis;
  let all = synth.getVoices();
  if (!all.length) {
    all = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const done = () => resolve(synth.getVoices());
      synth.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 1500);
    });
  }
  return all.filter((v) => /^en([-_]|$)/i.test(v.lang));
}

/** Rank voices: requested accent first, then natural/neural/online voices over the robotic local ones. */
function voiceScore(v: SpeechSynthesisVoice, accent: "us" | "uk"): number {
  const lang = v.lang.replace("_", "-").toLowerCase();
  let s = 0;
  if (lang === (accent === "uk" ? "en-gb" : "en-us")) s += 100;
  if (/natural|neural/i.test(v.name)) s += 40;
  if (/online|google/i.test(v.name)) s += 20;
  if (!v.localService) s += 5;
  return s;
}

async function speakBrowser(text: string, accent: "us" | "uk", preferred: string) {
  if (!("speechSynthesis" in window)) throw new Error("No Gemini API key set and speech synthesis is unavailable.");
  const voices = await englishVoices();
  const voice =
    voices.find((v) => v.name === preferred) ??
    [...voices].sort((a, b) => voiceScore(b, accent) - voiceScore(a, accent))[0];
  if (!voice) throw new Error("No English voice is installed. Add an English speech voice in your OS settings, or set a Gemini API key.");
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  window.speechSynthesis.speak(u);
}

async function requestAudio(key: string, model: string, voice: string, text: string): Promise<Uint8Array> {
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  // 1) Interactions API (current docs)
  let res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (!res.ok && res.status !== 401 && res.status !== 403) {
    // 2) fall back to the classic generateContent endpoint
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini TTS error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const b64 = findAudio(json);
  if (!b64) throw new Error("Gemini TTS: no audio in response");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Find the first base64 audio payload anywhere in the response. */
function findAudio(o: unknown): string | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const mime = (r.mime_type ?? r.mimeType) as string | undefined;
  if (typeof r.data === "string" && (!mime || mime.startsWith("audio"))) return r.data;
  for (const v of Object.values(r)) {
    const f = findAudio(v);
    if (f) return f;
  }
  return null;
}

async function play(bytes: Uint8Array) {
  ctx ??= new AudioContext();
  let buffer: AudioBuffer;
  const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // "RIFF"
  if (isWav) {
    buffer = await ctx.decodeAudioData(bytes.slice().buffer);
  } else {
    // raw 16-bit little-endian mono PCM, 24 kHz
    const n = Math.floor(bytes.length / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    buffer = ctx.createBuffer(1, n, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  current = src;
  src.start();
}
