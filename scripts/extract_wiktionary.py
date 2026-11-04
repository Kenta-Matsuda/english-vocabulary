"""Extract a small subset of the kaikki.org English Wiktionary dump.

Input : data/raw/_big/kaikki-English.jsonl  (3.2 GB, not committed; download from
        https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl)
Output: data/interim/wiktionary_subset.jsonl.gz  (committed)

Only entries whose headword is in the candidate list (data/interim/candidates.txt)
are kept, and only the fields we need: pos, IPA, inflected forms, glosses,
usage examples (editor-written "example" type, not long quotations), synonyms
and derived terms.
"""
from __future__ import annotations

import gzip
import sys
from pathlib import Path

import orjson

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "_big" / "kaikki-English.jsonl"
CAND = ROOT / "data" / "interim" / "candidates.txt"
OUT = ROOT / "data" / "interim" / "wiktionary_subset.jsonl.gz"


def slim(d: dict) -> dict:
    sounds = [{"ipa": s["ipa"], "tags": s.get("tags", []) + s.get("raw_tags", [])}
              for s in d.get("sounds", []) if "ipa" in s]
    forms = [{"form": f["form"], "tags": f.get("tags", [])} for f in d.get("forms", [])
             if "form" in f]
    senses = []
    for s in d.get("senses", []):
        senses.append({
            "glosses": s.get("glosses", []),
            "tags": s.get("tags", []) + s.get("raw_tags", []),
            "examples": [e["text"] for e in s.get("examples", [])
                         if e.get("type") == "example" and e.get("text")],
            "synonyms": [x["word"] for x in s.get("synonyms", []) if "word" in x],
            "form_of": bool(s.get("form_of") or s.get("alt_of")),
        })
    return {
        "word": d["word"],
        "pos": d.get("pos"),
        "sounds": sounds,
        "forms": forms,
        "senses": senses,
        "synonyms": [x["word"] for x in d.get("synonyms", []) if "word" in x],
        "derived": [x["word"] for x in d.get("derived", []) if "word" in x],
    }


def main() -> None:
    cands = set(CAND.read_text(encoding="utf-8").split())
    n = kept = 0
    with open(SRC, "rb") as f, gzip.open(OUT, "wb", compresslevel=9) as out:
        for line in f:
            n += 1
            d = orjson.loads(line)
            w = d.get("word", "")
            if w.lower() not in cands or d.get("lang_code") != "en":
                continue
            out.write(orjson.dumps(slim(d)) + b"\n")
            kept += 1
            if kept % 5000 == 0:
                print(f"{n} lines, kept {kept}", file=sys.stderr)
    print(f"done: {n} lines, kept {kept} -> {OUT}")


if __name__ == "__main__":
    main()
