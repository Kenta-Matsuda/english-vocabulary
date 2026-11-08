"""Minimal reader for the Princeton WordNet 3.1 database files (data/raw/wordnet)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

WN = Path(__file__).resolve().parent.parent / "data" / "raw" / "wordnet"

POS_FILES = {"n": "noun", "v": "verb", "a": "adj", "r": "adv"}
SS_TYPE_NUM = {"n": "1", "v": "2", "a": "3", "r": "4", "s": "5"}


@dataclass
class Synset:
    offset: str
    pos: str          # n v a r s
    lemmas: list[str]  # surface forms as stored (may contain capitals / underscores)
    pointers: list[tuple[str, str, str, str]]  # (symbol, offset, pos, source/target hex)
    gloss: str
    definition: str = ""
    examples: list[str] = field(default_factory=list)


def _clean_lemma(s: str) -> str:
    s = re.sub(r"\((a|p|ip)\)$", "", s)  # adjective position markers
    return s.replace("_", " ")


def _split_gloss(gloss: str) -> tuple[str, list[str]]:
    examples = re.findall(r'"([^"]+)"', gloss)
    # drop quoted examples together with a trailing attribution ("..."- Liam O'Flaherty)
    definition = re.sub(r'"[^"]*"(\s*-+\s*[^;"]*)?', "", gloss)
    definition = re.sub(r"\s*;\s*(;\s*)*", "; ", definition).strip(" ;")
    return definition, [e.strip() for e in examples if e.strip()]


class WordNet:
    def __init__(self) -> None:
        self.synsets: dict[tuple[str, str], Synset] = {}
        self.index: dict[str, dict[str, list[str]]] = {}  # lemma -> pos -> [offsets in sense order]
        self.tagcount: dict[tuple[str, str], int] = {}  # (lemma, offset) -> tag count
        self.exc: dict[str, set[str]] = {}  # base -> inflected forms
        self.all_lemmas: set[str] = set()
        self._load()

    def _load(self) -> None:
        for p, name in POS_FILES.items():
            with open(WN / f"data.{name}", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.startswith("  "):
                        continue
                    head, _, gloss = line.partition(" | ")
                    t = head.split()
                    off, ss_type = t[0], t[2]
                    wcnt = int(t[3], 16)
                    lemmas = [_clean_lemma(t[4 + 2 * i]) for i in range(wcnt)]
                    i = 4 + 2 * wcnt
                    pcnt = int(t[i]); i += 1
                    ptrs = []
                    for _ in range(pcnt):
                        ptrs.append((t[i], t[i + 1], t[i + 2], t[i + 3]))
                        i += 4
                    d, ex = _split_gloss(gloss.strip())
                    self.synsets[(off, p)] = Synset(off, ss_type, lemmas, ptrs, gloss.strip(), d, ex)
            with open(WN / f"index.{name}", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.startswith("  "):
                        continue
                    t = line.split()
                    lemma = t[0].replace("_", " ")
                    synset_cnt = int(t[2])
                    p_cnt = int(t[3])
                    offs = t[4 + p_cnt + 2:]
                    offs = offs[:synset_cnt]
                    self.index.setdefault(lemma, {})[p] = offs
                    self.all_lemmas.add(lemma)
            with open(WN / f"{name}.exc", encoding="utf-8", errors="replace") as f:
                for line in f:
                    t = line.split()
                    if len(t) >= 2:
                        for base in t[1:]:
                            self.exc.setdefault(base.replace("_", " "), set()).add(t[0].replace("_", " "))
        with open(WN / "index.sense", encoding="utf-8", errors="replace") as f:
            for line in f:
                key, off, _num, cnt = line.split()
                lemma = key.split("%")[0].replace("_", " ")
                self.tagcount[(lemma, off)] = int(cnt)

    def synset(self, off: str, pos: str) -> Synset:
        if pos == "s":
            pos = "a"
        return self.synsets[(off, pos)]

    def senses(self, lemma: str):
        """Yield (pos, rank_in_pos, Synset) for a lemma, in WordNet sense order."""
        for p, offs in self.index.get(lemma.lower(), {}).items():
            for r, off in enumerate(offs):
                yield p, r, self.synsets[(off, p)]

    def derivations(self, lemma: str) -> set[str]:
        """Lemmas derivationally related to `lemma` (WordNet '+' and pertainym pointers)."""
        key = lemma.lower()
        out: set[str] = set()
        for _p, _r, ss in self.senses(key):
            idx = next((i + 1 for i, l in enumerate(ss.lemmas) if l.lower() == key), None)
            for sym, off, p, st in ss.pointers:
                if sym not in ("+", "\\", "=") or int(st[:2], 16) != idx:
                    continue
                tgt = self.synset(off, p)
                j = int(st[2:], 16)
                if 0 < j <= len(tgt.lemmas):
                    out.add(tgt.lemmas[j - 1].lower())
        out.discard(key)
        return out

    def morphy_base(self, word: str) -> str | None:
        """Very small morphy: return a base lemma for an inflected form if known."""
        w = word.lower()
        for base, forms in self.exc.items():
            if w in forms:
                return base
        rules = [("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e"),
                 ("er", ""), ("est", ""), ("er", "e"), ("est", "e")]
        for suf, rep in rules:
            if w.endswith(suf) and len(w) > len(suf) + 2:
                b = w[: -len(suf)] + rep
                if b in self.index:
                    return b
        return None
