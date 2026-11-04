import { useEffect, useState } from "preact/hooks";

export function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
  window.scrollTo(0, 0);
}

export function useRoute(): { parts: string[]; query: URLSearchParams } {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const [path, qs] = hash.replace(/^#\/?/, "").split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs ?? "") };
}
