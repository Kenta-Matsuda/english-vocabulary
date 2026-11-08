"""Decide which senses of a word are worth learning.

WordNet has clean, non-circular definitions and synonym sets, but it lists every sense it knows
(Malayan daggers, historical coins, British "long scale" numbers ...) and its only frequency
information is the tiny SemCor tag count, which is zero for most senses. Wiktionary has the two
signals WordNet lacks:

  * how many languages each sense has been translated into: editors translate the senses people
    actually use, so this is a good proxy for how common a sense is
    (broadcaster: "radio/TV presenter" 41 languages, "fertilizer spreader" 1);
  * register labels (historical, archaic, dated, slang, humorous ...).

So each WordNet sense is aligned with the most similar Wiktionary sense of the same part of speech
(word overlap of definitions, examples, synonyms and hypernyms) and takes over its translation count
and labels.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

STOP = set("""
a an the of to in on at by for with from as or and but not no nor so than that this these those
which who whom whose what when where how why it its is are was were be been being has have had do
does did done can could may might must shall should will would one's someone something somebody
any some all each every other another such very more most much many few less least own same also
especially usually often etc used use using e g i ie eg something person thing things
""".split())

_NUMS = {str(i): w for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty".split())}
_SUFFIXES = [("ically", ""), ("ation", ""), ("ness", ""), ("ment", ""), ("ing", ""), ("ies", "y"),
             ("ied", "y"), ("ed", ""), ("es", ""), ("ly", ""), ("er", ""), ("s", "")]


def stem(t: str) -> str:
    for suf, rep in _SUFFIXES:
        if t.endswith(suf) and len(t) - len(suf) >= 3:
            return t[: -len(suf)] + rep
    return t


def tokens(text: str, skip: set[str] = frozenset()) -> set[str]:
    out = set()
    for t in re.findall(r"[a-z0-9]+", text.lower()):
        t = _NUMS.get(t, t)
        if len(t) < 3 or t in STOP or t in skip:
            continue
        out.add(stem(t))
    return out


@dataclass(eq=False)  # compared / hashed by identity
class WkSense:
    pos: str             # short tag (n v adj adv num ...)
    gloss: str
    tags: set[str]
    examples: list[str]
    synonyms: list[str]
    tr: int              # languages it is translated into
    bad: bool            # register label we do not teach (archaic, slang ...) or a form-of entry
    toks: set[str] = field(default_factory=set)
    heads: set[str] = field(default_factory=set)  # one-word glosses: "To boast; to talk ..." -> {"boast"}


class IDF:
    def __init__(self, docs: list[set[str]]):
        df: dict[str, int] = {}
        for d in docs:
            for t in d:
                df[t] = df.get(t, 0) + 1
        self.n = len(docs)
        self.df = df

    def __call__(self, t: str) -> float:
        return math.log((self.n + 1) / (self.df.get(t, 0) + 1)) + 1

    def sim(self, a: set[str], b: set[str]) -> float:
        if not a or not b:
            return 0.0
        shared = sum(self(t) for t in a & b)
        return shared / math.sqrt(sum(map(self, a)) * sum(map(self, b)))


def gloss_heads(gloss: str) -> set[str]:
    out = set()
    for seg in re.split(r"[;,.]", gloss):
        seg = re.sub(r"^\s*(to|a|an|the)\s+", "", seg.strip(), flags=re.I).lower()
        if seg and len(seg.split()) <= 2 and not re.search(r"[()]", seg):
            out.add(seg)
    return out


def wk_text(s: dict) -> str:
    return " ".join(s["glosses"] + s["examples"] + [x for x in s["synonyms"] if len(x.split()) <= 2])


def wiktionary_senses(entries: list[dict], key: str, pos_map: dict, bad_tags: set[str],
                      idf: IDF | None, skip: set[str]) -> list[WkSense]:
    out = []
    for d in entries:
        if d["word"].lower() != key:
            continue
        pos = pos_map.get(d["pos"], d["pos"])
        group = []
        for s in d["senses"]:
            if not s["glosses"]:
                continue
            syns = [x for x in s["synonyms"] if len(x.split()) <= 2]  # not "give someone what for"
            ws = WkSense(pos, s["glosses"][-1], set(s["tags"]), s["examples"], syns,
                         s.get("tr", 0), bool(s["form_of"] or set(s["tags"]) & bad_tags))
            ws.toks = tokens(wk_text(s), skip)
            ws.heads = gloss_heads(ws.gloss)
            group.append(ws)
        # translation tables the dump could not attach to a sense: give them to the sense whose
        # gloss best matches the table's label ("structure" -> the monument sense of 'memorial')
        for label, n in d.get("tr_tables", {}).items():
            good = [w for w in group if not w.bad]
            if not good:
                continue
            lt = tokens(label, skip)
            best = max(good, key=lambda w: (idf.sim(lt, w.toks) if idf else len(lt & w.toks)))
            if not lt & best.toks:
                best = good[0]
            best.tr += n
        out += group
    return out


def pos_compatible(wn_tag: str, wk_tag: str) -> bool:
    return wn_tag == wk_tag or (wk_tag == "num" and wn_tag in ("n", "adj"))
