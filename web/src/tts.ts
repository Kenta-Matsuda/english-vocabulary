import { getState } from "./store";

/**
 * Pronunciation via the browser's built-in speech synthesis (no network, plays immediately).
 * Microsoft Edge is recommended: it ships natural-sounding neural English voices.
 */

export const isEdge = () => /\bEdg\//.test(navigator.userAgent);

export async function speak(text: string): Promise<void> {
  const { ttsAccent, browserVoice } = getState().settings;
  if (!("speechSynthesis" in window)) throw new Error("This browser cannot speak. Please use Microsoft Edge.");
  const voice = await pickVoice(ttsAccent, browserVoice);
  if (!voice) throw new Error("No English voice found. Please use Microsoft Edge, or add an English voice in your OS settings.");
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  synth.speak(u);
}

export function stop(): void {
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

async function pickVoice(accent: "us" | "uk", preferred: string): Promise<SpeechSynthesisVoice | undefined> {
  const voices = await englishVoices();
  return voices.find((v) => v.name === preferred) ?? [...voices].sort((a, b) => voiceScore(b, accent) - voiceScore(a, accent))[0];
}
