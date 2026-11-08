"""Build the vocabulary dataset used by the web app.

Usage:
  python scripts/build_dataset.py candidates   # step 1: write data/interim/candidates.txt
  python scripts/extract_wiktionary.py          # step 2: (needs the 3.2GB kaikki dump)
  python scripts/build_dataset.py build        # step 3: write web/public/data/words.json
                                                #         and data/dist/vocabulary.csv

Source priority (most trusted first):
  definitions : WordNet 3.1, filtered and ordered with Wiktionary's translation counts and usage
                labels (see senses.py / choose_senses)  >  Wiktionary (when WordNet lacks a common sense)
  synonyms    : WordNet synset members only  >  Wiktionary
                (adjective "similar to" neighbours are not synonyms: admirable -> pleasing)
  examples    : WordNet gloss examples  >  Wiktionary usage examples
  IPA         : Wiktionary (GA / RP)  >  ipa-dict en_US (CMUdict based)
  CEFR level  : CEFR-J > Octanove > Oxford 5000 > EFLLex > Kelly (first source that lists the word;
                within one source the lowest level across parts of speech)
"""
from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import orjson
from wordfreq import zipf_frequency

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources as S  # noqa: E402
from senses import IDF, WkSense, pos_compatible, tokens, wiktionary_senses, wk_text  # noqa: E402
from wordnet import WordNet  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
INTERIM = ROOT / "data" / "interim"
OUT_JSON = ROOT / "web" / "public" / "data" / "words.json"
OUT_CSV = ROOT / "data" / "dist" / "vocabulary.csv"

MAX_SENSES = 5
MAX_SYNONYMS = 10
MAX_EXAMPLES = 4
MAX_COLLOCATIONS = 6
# words below this Zipf frequency (in every inflected form) are not drilled even if a list gives them a
# level: about once per 100 million words. Catches coinages and rare derivatives (glocal, gracefulness)
MIN_ZIPF = 2.0

BAD_TAGS = {"obsolete", "archaic", "dated", "rare", "slang", "vulgar", "offensive", "derogatory",
            "nonstandard", "dialectal", "historical", "Internet", "humorous", "euphemistic",
            "nonce-word", "misspelling", "pejorative", "uncommon", "poetic", "colloquial",
            "informal", "obsolete-form"}

POS_MAP = {
    # CEFR-J / Octanove pos -> short tag
    "noun": "n", "verb": "v", "adjective": "adj", "adverb": "adv", "preposition": "prep",
    "conjunction": "conj", "pronoun": "pron", "determiner": "det", "interjection": "intj",
    "number": "num", "modal verb": "v", "be-verb": "v", "do-verb": "v", "have-verb": "v",
    "infinitive-to": "prep",
    # WordNet
    "n": "n", "v": "v", "a": "adj", "s": "adj", "r": "adv",
    # Wiktionary
    "adj": "adj", "adv": "adv", "prep": "prep", "conj": "conj", "det": "det", "intj": "intj",
    "pron": "pron", "num": "num", "article": "det", "particle": "part",
}


# ============================================================ morphology / masking

def regular_forms(w: str) -> set[str]:
    f = {w}
    if re.search(r"(s|x|z|ch|sh)$", w):
        f.add(w + "es")
    elif re.search(r"[^aeiou]y$", w):
        f.add(w[:-1] + "ies")
    else:
        f.add(w + "s")
    if w.endswith("e"):
        f |= {w + "d", w[:-1] + "ing", w + "r", w + "st"}
    elif re.search(r"[^aeiou]y$", w):
        f |= {w[:-1] + "ied", w + "ing", w[:-1] + "ier", w[:-1] + "iest"}
    else:
        f |= {w + "ed", w + "ing", w + "er", w + "est"}
    if re.search(r"(^|[^aeiou])[aeiou][bdgklmnprt]$", w):
        c = w[-1]
        f |= {w + c + "ed", w + c + "ing", w + c + "er", w + c + "est"}
    if w.endswith("ic"):
        f |= {w + "ked", w + "king"}
    return f


def stem_of(w: str) -> str | None:
    # only for long words; short stems over-mask (detect -> "dete" would hit "determine")
    return w[: max(6, len(w) - 3)] if len(w) >= 8 else None


class Masker:
    """Marks occurrences of a headword (and its inflections) as [[...]]."""

    def __init__(self, word: str, forms: set[str], related: set[str] = frozenset()):
        self.word = word
        self.forms = {f.lower() for f in forms if f}
        self.stem = stem_of(word)
        # derivationally related words (decide -> decision) and their inflections
        self.related = set()
        for r in related:
            if " " not in r:
                self.related |= regular_forms(r)
        self.related -= self.forms
        alts = sorted(self.forms, key=len, reverse=True)
        self.rx_forms = re.compile(r"(?<![A-Za-z])(" + "|".join(map(re.escape, alts)) + r")(?![A-Za-z])", re.I)
        # used for definitions: also catch derivations
        pat = "|".join(map(re.escape, sorted(self.forms | self.related, key=len, reverse=True)))
        if self.stem:
            pat += "|" + re.escape(self.stem) + r"[A-Za-z]*"
        self.rx_loose = re.compile(r"(?<![A-Za-z])(" + pat + r")(?![A-Za-z])", re.I)

    def contains(self, text: str) -> bool:
        return bool(self.rx_forms.search(text))

    def mark(self, text: str) -> str:
        return self.rx_forms.sub(lambda m: f"[[{m.group(1)}]]", text)

    def mark_loose(self, text: str) -> str:
        return self.rx_loose.sub(lambda m: f"[[{m.group(1)}]]", text)

    def leaks(self, phrase: str) -> bool:
        """True if a synonym candidate contains the answer (or a derivation of it)."""
        p = phrase.lower()
        if self.word in p:
            return True
        for tok in re.split(r"[\s\-/']+", p):
            if not tok:
                continue
            if tok in self.forms or tok in self.related or (self.stem and tok.startswith(self.stem)):
                return True
        return False


# ============================================================ spelling variants

_VARIANT_RULES = [
    (r"isation", "ization"), (r"([a-z]{3,})is(e|ed|es|ing)$", r"\1iz\2"), (r"ys(e|ed|es|ing)$", r"yz\1"),
    (r"([^aeiou])our(s|ed|ing|able|ably|ite|ites|ful|hood|less)?$", r"\1or\2"),
    (r"([^aeiou])tre(s)?$", r"\1ter\2"), (r"ogue(s)?$", r"og\1"),
    (r"ph", "f"), (r"ae", "e"), (r"oe", "e"),
    # travelled/traveled, skilful/skillful, fulfil/fulfill
    (r"ll(ed|ing|er|ers|ous|ful|fully|ment)$", r"l\1"), (r"([aeiou])ll$", r"\1l"),
]


def spelling_key(w: str) -> str:
    """Canonical key so that British/American variants compare equal (colour = color).

    Only used to compare words that BOTH exist, so over-normalising is harmless."""
    k = w.lower()
    for pat, rep in _VARIANT_RULES:
        k = re.sub(pat, rep, k)
    return k


def merge_spelling_variants(words: dict[str, dict]) -> int:
    """Merge British-spelling headwords into the more frequent (usually US) spelling."""
    groups: dict[str, list[str]] = defaultdict(list)
    for k in words:
        if len(k) >= 5:
            groups[spelling_key(k)].append(k)
    merged = 0
    for ks in groups.values():
        if len(ks) < 2:
            continue
        ks.sort(key=lambda k: zipf_frequency(k, "en"), reverse=True)
        keep = words[ks[0]]
        for k in ks[1:]:
            other = words.pop(k)
            for src, lvl in other["levels"].items():
                old = keep["levels"].get(src)
                keep["levels"][src] = lvl if old is None else lowest([old, lvl], S.CEFR_ORDER)
            keep["pos"] += [p for p in other["pos"] if p not in keep["pos"]]
            merged += 1
    return merged


# ============================================================ collect

def lowest(values, order):
    vals = [v for v in values if v in order]
    return min(vals, key=order.index) if vals else None


# CEFR sources, most trusted first. A word takes its level from the first source that lists it.
LEVEL_SOURCES = [
    ("cefrj", "CEFR-J Wordlist 1.5 (A1-B2)"),
    ("octanove", "Octanove Vocabulary Profile C1/C2"),
    ("oxford", "Oxford 5000 (A1-C1)"),
    ("efllex", "EFLLex, CEFR-graded textbooks (A1-C1)"),
    ("kelly", "Kelly list (A1-C2)"),
]
# sources whose labels are derived from corpus frequency rather than curated by hand:
# their extra words must be real dictionary lemmas (not names, inflections, numerals, abbreviations)
DERIVED_SOURCES = {"efllex", "kelly"}
_NUMERAL = re.compile(r"^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-|^(fif|six|seven|eigh|nine|ten)ties$")


def _source_iter(name):
    if name in ("cefrj", "octanove"):
        for w, pos, lvl in S.read_cefr():
            if (lvl in ("C1", "C2")) == (name == "octanove"):
                yield w, pos, lvl
    else:
        yield from {"oxford": S.read_oxford5000, "efllex": S.read_efllex, "kelly": S.read_kelly}[name]()


def collect(wn: WordNet) -> dict[str, dict]:
    words: dict[str, dict] = defaultdict(lambda: {"levels": {}, "pos": [], "display": None})

    def acceptable_derived(k: str) -> bool:
        if len(k) < 3 or _NUMERAL.search(k) or k not in wn.index or _wn_is_proper(wn, k):
            return False
        if zipf(k) < 2.5:  # very rare words (photomontage, sandblast) are not worth drilling
            return False
        base = wn.morphy_base(k)
        if base and base != k and base in words:  # e.g. "required", "talking" when the base is listed
            return False
        return True

    for name, _label in LEVEL_SOURCES:
        for raw, pos, lvl in _source_iter(name):
            k = S.normalize_headword(raw)
            if not k:
                continue
            if name in DERIVED_SOURCES and k not in words and not acceptable_derived(k):
                continue
            e = words[k]
            old = e["levels"].get(name)
            e["levels"][name] = lvl if old is None else lowest([old, lvl], S.CEFR_ORDER)
            disp = S.clean_html(raw).strip()
            if disp[:1].isupper() and disp[1:].islower() and e["display"] is None and _wn_is_proper(wn, k):
                e["display"] = disp
            if name != "efllex":
                p = POS_MAP.get(pos.strip().lower())
                if p and p not in e["pos"]:
                    e["pos"].append(p)
    merge_spelling_variants(words)
    for e in words.values():
        src = next(n for n, _ in LEVEL_SOURCES if n in e["levels"])
        e["cefr"], e["cefr_src"] = e["levels"][src], src
    return words


def _wn_is_proper(wn: WordNet, k: str) -> bool:
    for _p, _r, ss in wn.senses(k):
        for l in ss.lemmas:
            if l.lower() == k:
                return l[:1].isupper()
    return False


# ============================================================ wiktionary subset

def load_wiktionary() -> dict[str, list[dict]]:
    path = INTERIM / "wiktionary_subset.jsonl.gz"
    out: dict[str, list[dict]] = defaultdict(list)
    if not path.exists():
        print("WARNING: wiktionary subset missing; IPA/examples will be limited", file=sys.stderr)
        return out
    with gzip.open(path, "rb") as f:
        for line in f:
            d = orjson.loads(line)
            # keep the lowercase entry when both 'March' and 'march' exist
            out[d["word"].lower()].append(d)
    return out


def load_ipadict() -> dict[str, str]:
    out = {}
    with open(S.RAW / "ipa" / "en_US.txt", encoding="utf-8") as f:
        for line in f:
            w, _, ipa = line.rstrip("\n").partition("\t")
            out.setdefault(w.lower(), ipa.split(",")[0].strip())
    return out


def pick_ipa(entries: list[dict], key: str, ipadict: dict[str, str]) -> dict:
    us = uk = None
    for d in entries:
        if d["word"] != key and any(e["word"] == key for e in entries):
            continue
        for s in d["sounds"]:
            ipa = s["ipa"]
            if not ipa.startswith("/"):
                continue  # skip narrow [phonetic] transcriptions
            tags = set(s["tags"])
            if us is None and tags & {"General-American", "US", "GenAm"}:
                us = ipa
            if uk is None and tags & {"Received-Pronunciation", "UK", "RP", "British"}:
                uk = ipa
            if us is None and uk is None and not tags:
                us = ipa
        if us and uk:
            break
    if us is None and key in ipadict:
        us = ipadict[key]
    r = {}
    if us:
        r["us"] = us
    if uk:
        r["uk"] = uk
    return r


# ============================================================ per-word build

def dedupe_variants(answer: str, syns: list[str]) -> list[str]:
    seen = {spelling_key(answer)}
    out = []
    for x in syns:
        k = spelling_key(x)
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def zipf(w: str) -> float:
    return zipf_frequency(w, "en")


def n_tokens(s: str) -> int:
    return len(re.findall(r"[A-Za-z']+", s))


_ATTRIBUTION = re.compile(r"(?<=[.!?\"”])\s*[—–-]+\s*[A-Z][A-Za-z.' ]*[A-Za-z]$")  # "... aim. —George Santayana"


def clean_text(t: str) -> str:
    """Normalise WordNet/Wiktionary text for display."""
    t = re.sub(r"`([^`']*)'", r"‘\1’", t)  # WordNet `quote' -> ‘quote’
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)  # leftover wiki links [[a|b]] -> b
    t = _ATTRIBUTION.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


def clean_definition(t: str) -> str:
    t = clean_text(t)
    t = re.sub(r";\s*‘[^’]+’ (?:is|are) [^;]*$", "", t)  # "...; ‘crisp’ is archaic" (about another lemma)
    return t.rstrip(" :;,")


def good_synonym(x: str) -> bool:
    # numerals and codes ("8" for eight, "atomic number 6", "a/c") give the answer away or are not words
    return not re.search(r"[0-9/]", x)


# ============================================================ sense selection (see senses.py)

ALIGN_MIN = 0.12   # similarity above which a WordNet and a Wiktionary sense are taken as the same sense
MIN_TR = 5         # a part of speech "has translation data" when its top Wiktionary sense has this many
KEEP_REL = 0.25    # keep a WordNet sense if its translations >= 25% of the top sense of that POS
ADD_REL = 0.5      # add a Wiktionary sense WordNet lacks if it has >= 50% of the top translations
BAND = 0.66        # Wiktionary senses this close to the best match also lend their translation count:
                   # the dump sometimes hangs a translation table on the neighbouring sense
WORD_CLASSES = {"n", "v", "adj", "adv", "prep", "conj", "pron", "det", "intj", "num", "part"}  # not "name"
# WordNet usage labels we do not teach (brag adj. "exceptionally good" is a colloquialism)
WN_BAD_USAGE = {"colloquialism", "slang", "archaism", "disparagement", "obscenity", "ethnic slur",
                "trade name", "trademark"}


DEBUG = False


@dataclass
class Choice:
    tag: str
    wn: object = None                 # WordNet Synset, or None for a Wiktionary-only sense
    wk: WkSense | None = None         # aligned Wiktionary sense (the Wiktionary sense itself if wn is None)
    sim: float = 0.0
    tc: int = 0
    rank: int = 0
    toks: set = field(default_factory=set)
    hard_bad: bool = False            # register we do not teach
    soft_bad: bool = False            # regional sense ("one quintillion in Great Britain")
    mine: list = field(default_factory=list)  # WordNet usage / region labels that apply to the word
    tr: int = 0                       # translation count of the matching Wiktionary sense(s)
    rel: float = 0.0                  # tr relative to the top sense of the same POS
    band: list = field(default_factory=list)        # Wiktionary senses that match this one
    related_wk: list = field(default_factory=list)  # Wiktionary senses whose examples belong here
    extra_wn: list = field(default_factory=list)    # dropped near-duplicate synsets whose examples belong here


def _synset_tokens(wn: WordNet, ss, key: str, skip) -> set[str]:
    # only the commonest synonyms: a long tail of rare ones (gasconade, swash) dilutes the similarity
    syns = sorted((l for l in ss.lemmas if l.lower() != key),
                  key=lambda l: (wn.tagcount.get((l.lower(), ss.offset), 0), zipf(l)), reverse=True)[:5]
    words = [ss.definition, *ss.examples, *syns]
    for sym, off, p, _ in ss.pointers:
        if sym in ("@", "@i"):  # hypernyms: memorial -> "structure", broadcaster -> "communicator"
            words += wn.synset(off, p).lemmas[:2]
    return tokens(" ".join(words), skip)


def choose_senses(key: str, info: dict, wn: WordNet, wks: list[WkSense], masker, idf: IDF, skip) -> list[Choice]:
    wks = [w for w in wks if w.pos in WORD_CLASSES]
    display_upper = (info["display"] or "")[:1].isupper()

    cands: list[Choice] = []
    for p, rank, ss in wn.senses(key):
        lemma_here = next((l for l in ss.lemmas if l.lower() == key), key)
        if lemma_here[:1].isupper() and not display_upper:
            continue  # proper-noun sense (e.g. 'March' for 'march')
        c = Choice(POS_MAP[ss.pos], wn=ss, tc=wn.tagcount.get((key, ss.offset), 0), rank=rank)
        c.toks = _synset_tokens(wn, ss, key, skip)
        syn_set = {l.lower() for l in ss.lemmas if l.lower() != key}
        # a WordNet synonym used as the Wiktionary gloss ("To boast; ...") is as strong a match as any
        sims = [(max(idf.sim(c.toks, w.toks), 0.3 if syn_set & w.heads else 0.0), w)
                for w in wks if pos_compatible(c.tag, w.pos)]
        if sims:
            c.sim, c.wk = max(sims, key=lambda t: t[0])
        if c.sim < ALIGN_MIN:
            c.wk, c.sim = None, 0.0
        else:
            c.band = [w for s, w in sorted(sims, key=lambda t: -t[0])
                      if s >= max(ALIGN_MIN, BAND * c.sim) and not w.bad]
            c.tr = max((w.tr for w in c.band), default=0)
            if c.wk.bad and c.band:
                # a labelled sense matches best, but a plain one nearly as well
                # (dishonest: obsolete "dishonorable" / "not honest"): follow the plain one
                c.wk = c.band[0]
        idx = next((i + 1 for i, l in enumerate(ss.lemmas) if l.lower() == key), 0)
        # usage / region labels: semantic ones (0000) cover the synset, lexical ones only one lemma
        # (crease's synset is not archaic, only its member 'crisp' is)
        mine = [(sym, o, pp) for sym, o, pp, st in ss.pointers
                if sym in (";u", ";r") and (st == "0000" or int(st[:2], 16) == idx)]
        c.mine = mine
        usage = {wn.synset(o, pp).lemmas[0] for sym, o, pp in mine if sym == ";u"}
        if re.search(r"[`‘][^'’]+['’] (?:is|are) (?:archaic|obsolete|slang|colloquial)", ss.gloss):
            usage = set()  # the label is about another member ("make wrinkles ...; `crisp' is archaic")
        first = ss.lemmas[0].lower()
        c.hard_bad = bool(
            # a labelled Wiktionary match; but WordNet's first sense that SemCor saw in use is not
            # archaic, whatever it happens to resemble (dishonest ~ obsolete "dishonorable")
            (c.wk and c.wk.bad and not (c.rank == 0 and c.tc >= 1))
            or usage & WN_BAD_USAGE
            # the word is only a clipping of a compound here: acute = "acute accent"
            or (first != key and key in first.split()))
        cands.append(c)
    for c in cands:
        # regional, unless Wiktionary shows it is common: trillion = 10^12 is labelled "US" in WordNet
        t = max((w.tr for w in wks if not w.bad and pos_compatible(c.tag, w.pos)), default=0)
        c.soft_bad = any(sym == ";r" for sym, *_ in c.mine) and not (t >= MIN_TR and c.tr >= KEEP_REL * t)
    if DEBUG:
        for c in cands:
            print(f"  WN {c.tag} r{c.rank} tc{c.tc} sim{c.sim:.2f} tr{c.tr} hard{c.hard_bad:d} soft{c.soft_bad:d} "
                  f"{c.wn.definition[:45]!r} -> {c.wk.gloss[:40] if c.wk else None!r}")

    pool = ([c for c in cands if not c.hard_bad and not c.soft_bad]
            or [c for c in cands if not c.hard_bad] or cands)
    good_wk = [w for w in wks if not w.bad]

    def top_tr(tag: str) -> int:
        return max((w.tr for w in good_wk if pos_compatible(tag, w.pos)), default=0)

    # several WordNet senses can match one Wiktionary sense (crease: "make wrinkles" / "make wrinkled"):
    # keep only the most used / closest one, the rest are near-duplicates for a learner
    closest: dict[int, Choice] = {}
    for c in pool:
        if c.wk and (id(c.wk) not in closest or (closest[id(c.wk)].tc, closest[id(c.wk)].sim) < (c.tc, c.sim)):
            closest[id(c.wk)] = c
    pool = [c for c in pool if not c.wk or closest[id(c.wk)] is c]
    for c in pool:
        t = top_tr(c.tag)
        c.rel = c.tr / t if t else 0.0
    # order by importance within the part of speech (verbs get fewer translation tables than nouns)
    pool.sort(key=lambda c: (-c.rel, -c.tc, c.rank))

    word_top = max((w.tr for w in good_wk), default=0)
    # "one who broadcasts", "not honest" (dishonest): the gloss gives the answer away
    base = re.sub(r"^(dis|un|in|im|il|ir|non|mis)(?=[a-z]{4})", "", key)
    neg = re.compile(r"\b(not|lacking|without)\s+(\w+\s+)?" + re.escape(base[:max(4, len(base) - 2)]), re.I)

    def circular(gloss: str) -> bool:
        return "[[" in masker.mark_loose(gloss) or (base != key and bool(neg.search(gloss)))

    in_pool = [w for c in pool for w in [c.wk, *c.band] if w]

    def addable(w: WkSense, against: list[WkSense], wn_senses: list[Choice]) -> bool:
        """A common Wiktionary sense that none of the given WordNet senses expresses."""
        tops = max((x.tr for x in good_wk if x.pos == w.pos), default=0)
        return not (
            tops < MIN_TR or w.tr < ADD_REL * tops or any(x is w for x in against)
            or w.gloss.startswith("...") or circular(w.gloss)
            or any(pos_compatible(c.tag, w.pos) and idf.sim(c.toks, w.toks) >= ALIGN_MIN for c in wn_senses)
            # Wiktionary often splits one sense in two (acute: "sudden onset" / "short-lived condition")
            or any(x.pos == w.pos and idf.sim(x.toks, w.toks) >= 0.3 for x in against))

    unmatched_top = {w.pos for w in good_wk if addable(w, in_pool, pool)}

    chosen: list[Choice] = []
    for c in pool:
        t = top_tr(c.tag)
        if t < MIN_TR:
            if word_top >= 4 * MIN_TR and c.tag not in info["pos"]:
                continue  # a minor part of speech of a well-documented word (eagle v. "shoot two under par")
            chosen.append(c)  # no translation data for this POS: WordNet's order is all we have
            continue
        if c.wk is None and c.rank == 0:
            # WordNet's first sense, but Wiktionary has no sense like it: suspicious when Wiktionary's
            # main sense is matched by another WordNet sense (startle "to stimulate to action"), or is
            # not in WordNet at all and SemCor never saw this one (up-and-coming "working hard")
            has_unmatched = any(pos_compatible(c.tag, p) for p in unmatched_top)
            if (not has_unmatched and any(o is not c and o.tag == c.tag and o.wk and o.rel >= ADD_REL for o in pool))                     or (c.tc == 0 and has_unmatched):
                continue
        # translation counts are reliable when high, but a missing table proves nothing (retard
        # "slow down", embassy "building" have none), so a sense is dropped only when every signal
        # says it is minor: few translations, not WordNet's first sense, (almost) unseen in SemCor
        if c.rel < KEEP_REL and c.rank > 0 and c.tc < 2:
            continue
        chosen.append(c)

    # common Wiktionary senses WordNet lacks or defines badly (up-and-coming "beginning to attract
    # attention"), unless a WordNet sense we could not match may already say the same thing
    matched = [w for c in chosen for w in [c.wk, *c.band] if w]
    for w in good_wk:
        if addable(w, matched, [c for c in chosen if c.wn]) and                 not any(c.wn and c.wk is None and pos_compatible(c.tag, w.pos) for c in chosen):
            tops = max(x.tr for x in good_wk if x.pos == w.pos)
            chosen.append(Choice(w.pos, wk=w, sim=1.0, tr=w.tr, rel=w.tr / tops))
            matched.append(w)

    def importance(c: Choice) -> float:
        if c.wn is None:
            return 0.55 * c.rel  # a supplement: after WordNet's own first sense
        # translation tables are sometimes hung on the wrong sense (tide: 53 on an archaic one),
        # so WordNet's own order is a floor
        return max(c.rel, 0.6 if c.rank == 0 else 0.0, min(c.tc, 10) / 20)
    chosen.sort(key=lambda c: (-importance(c), -c.tc, c.rank))

    # every part of speech the CEFR lists give keeps at least its best sense (brag n. "a boast")
    for tag in [t for t in info["pos"] if t in ("n", "v", "adj", "adv")]:
        if not any(c.tag == tag for c in chosen):
            alt = next((c for c in pool if c.tag == tag), None)
            if alt:
                chosen.append(alt)

    if not chosen:  # no WordNet entry: first good Wiktionary senses
        chosen = [Choice(w.pos, wk=w) for w in good_wk if not w.gloss.startswith("...")][:3]
    capped = chosen[MAX_SENSES:]
    chosen = chosen[:MAX_SENSES]

    # Examples. A dropped WordNet sense still lends its examples when it was dropped only as a
    # near-duplicate / for space / is close to a shown sense; not when it is a distinct rare or
    # labelled sense ("his brag cornfield", "the Roman eagle", "I got an eagle in the third hole").
    shown = {id(w) for c in chosen for w in [c.wk, *c.band] if w}
    def near_shown(c: Choice) -> Choice | None:
        if c.hard_bad or c.soft_bad:
            return None
        same = [o for o in chosen if o.wn is not None and o.tag == c.tag]
        if c in capped or (c.wk is not None and id(c.wk) in shown):
            return same[0] if same else None
        return next((o for o in same if idf.sim(o.toks, c.toks) >= ALIGN_MIN), None)

    dropped = set()
    for c in cands:
        if c in chosen:
            continue
        host = near_shown(c)
        if host is not None:
            host.extra_wn.append(c.wn)
        else:
            dropped |= {id(w) for w in [c.wk, *c.band] if w}
    dropped -= shown
    for c in chosen:
        t = top_tr(c.tag)
        if c.wn is None and c.sim == 0.0:  # Wiktionary-only word: its other common senses are fine
            pass
        elif c.wn is None:
            c.related_wk = [c.wk]
            continue
        c.related_wk = [w for w in good_wk if pos_compatible(c.tag, w.pos) and id(w) not in dropped and (
            id(w) in shown or (c.toks and idf.sim(c.toks, w.toks) >= ALIGN_MIN) or t < MIN_TR or w.tr >= KEEP_REL * t)]
    return chosen


def build_entry(key: str, info: dict, wn: WordNet, wk: list[dict], ipadict, ngsl_forms, idf: IDF) -> dict:
    # ---- forms for masking
    forms = regular_forms(key) | wn.exc.get(key, set()) | set(ngsl_forms.get(key, []))
    for d in wk:
        if d["word"].lower() != key:
            continue
        for f in d["forms"]:
            tags = set(f["tags"])
            if tags & {"obsolete", "archaic", "alternative", "dialectal", "nonstandard", "table-tags",
                       "inflection-template", "romanization"}:
                continue
            if re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", f["form"]):
                forms.add(f["form"].lower())
    masker = Masker(key, forms, wn.derivations(key))

    skip = masker.forms  # (derivations stay: "penalty" is what matches penalize's two definitions)
    wks = wiktionary_senses(wk, key, POS_MAP, BAD_TAGS, idf, skip)
    chosen = choose_senses(key, info, wn, wks, masker, idf, skip)

    senses = []
    examples: list[tuple[int, str]] = []  # (preference, marked text)
    collocs: list[str] = []
    seen_col: set[str] = set()
    pos_seen = list(info["pos"])
    display_upper = (info["display"] or "")[:1].isupper()

    def add_example(text: str):
        if re.search(r"#\d+;", text) or "..." in text or "…" in text:
            return  # LaTeX math escaped by the dump (#92;frac#123;...), or several examples run together
        # several examples run together with wide gaps ("abject failure   abject terror")
        parts = [p for p in re.split(r";?\s{2,}|;\s+(?=\S)", text) if p.strip()] if re.search(r"\s{2,}", text) else [text]
        if len(parts) > 1:
            for p in parts:
                add_example(p)
            return
        text = clean_text(text)
        if not masker.contains(text):
            return
        if not display_upper and any(m.group(1)[:1].isupper() and m.start() > 0
                                     for m in masker.rx_forms.finditer(text)):
            return  # used as a name mid-sentence ("When will Roderick get his Eagle?")
        nt = n_tokens(text)
        # short lowercase fragments ("able to swim", "a free man") are collocations,
        # anything else long enough is treated as an example sentence
        is_phrase = nt <= 5 and text[:1].islower() and not re.search(r"[.!?]$", text)
        m = masker.mark(text)
        if is_phrase:
            k = re.sub(r"^(the|a|an) ", "", m.lower())  # "the margin of victory" = "margin of victory"
            if k not in seen_col and nt >= 2:
                seen_col.add(k)
                collocs.append(m)
        elif 4 <= nt <= 35 and all(m != x for _, x in examples):
            # prefer complete, editor-written sentences ("Inspect the system for leaks.") over
            # WordNet's elliptical fragments ("his taste was impeccable, his health admirable")
            sentence = text[:1].isupper() and bool(re.search(r"[.!?][\"”’']?$", text))
            examples.append((0 if sentence and nt <= 20 else 1 if sentence else 2, m))

    for c in chosen:
        if c.wn is not None:
            ss = c.wn
            syn_pool: dict[str, tuple[int, float]] = {}
            labelled = {x.lower() for x in re.findall(r"[`‘]([^'’]+)['’] (?:is|are) (?:archaic|obsolete|slang|colloquial)", ss.gloss)}
            for l in ss.lemmas:
                ll = l.lower()
                if ll == key or ll in labelled or masker.leaks(l) or not good_synonym(l):
                    continue
                score = (wn.tagcount.get((ll, ss.offset), 0), zipf(l))
                if ll not in syn_pool or syn_pool[ll] < score:
                    syn_pool[ll] = score
            syns = dedupe_variants(key, sorted(syn_pool, key=lambda l: syn_pool[l], reverse=True))[:MAX_SYNONYMS]
            sense = {"p": c.tag, "d": masker.mark_loose(clean_definition(ss.definition)), "s": syns}
        else:
            w = c.wk
            syns = [x for x in dict.fromkeys(w.synonyms) if not masker.leaks(x) and good_synonym(x) and zipf(x) >= 2.5]
            syns = dedupe_variants(key, sorted(syns, key=zipf, reverse=True))[:MAX_SYNONYMS]
            sense = {"p": c.tag, "d": masker.mark_loose(clean_definition(w.gloss)), "s": syns, "src": "wkt"}
        senses.append(sense)
        if c.tag not in pos_seen:
            pos_seen.append(c.tag)
    # examples and collocations only from the senses we show: an example of a dropped sense
    # ("his brag cornfield", "in England they call a quintillion a trillion") would teach it anyway
    for c in chosen:
        if c.wn is not None and not any(sym == ";r" for sym, *_ in c.mine):  # not "in England they call a trillion a billion"
            for ex in c.wn.examples:
                add_example(ex)
    for c in chosen:
        for ss in c.extra_wn:
            for ex in ss.examples:
                add_example(ex)
    for w in dict.fromkeys(w for c in chosen for w in c.related_wk):
        for ex in w.examples:
            add_example(ex)
    examples.sort(key=lambda t: t[0])
    if sum(pref < 2 for pref, _ in examples) >= 2:
        examples = [t for t in examples if t[0] < 2]  # enough real sentences: drop the fragments

    # ---- collocations from derived multi-word terms that WordNet also lists (= established phrases)
    derived = set()
    for d in wk:
        if d["word"].lower() == key:
            derived |= {x for x in d["derived"] if " " in x and 2 <= n_tokens(x) <= 4}
    phrase_c = [x for x in derived if x.lower() in wn.all_lemmas and masker.contains(x)]
    phrase_c.sort(key=zipf, reverse=True)
    for x in phrase_c:
        m = masker.mark(x)
        k = re.sub(r"^(the|a|an) ", "", m.lower())
        if k not in seen_col:
            seen_col.add(k)
            collocs.append(m)

    entry = {
        "w": info["display"] or key,
        "pos": pos_seen,
        "cefr": info["cefr"],
        "src": info["cefr_src"],
        "levels": info["levels"],
        "zipf": round(zipf(key), 2),
        # most frequent inflection: 'bewilder' is rare but 'bewildered' is not
        "_zmax": max(zipf(f) for f in masker.forms | {key}),
        "ipa": pick_ipa([d for d in wk], key, ipadict),
        "senses": senses,
        "ex": [x for _, x in examples[:MAX_EXAMPLES]],
        "col": collocs[:MAX_COLLOCATIONS],
    }
    return entry


# ============================================================ main

def cmd_candidates() -> None:
    wn = WordNet()
    words = collect(wn)
    INTERIM.mkdir(parents=True, exist_ok=True)
    (INTERIM / "candidates.txt").write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")
    print(f"{len(words)} candidate words -> {INTERIM / 'candidates.txt'}")


def cmd_build() -> None:
    wn = WordNet()
    words = collect(wn)
    wkt = load_wiktionary()
    ipadict = load_ipadict()
    ngsl_forms = defaultdict(list)
    for head, forms in S.read_ngsl_forms():
        ngsl_forms[head.lower()] += [f.lower() for f in forms]

    idf = IDF([tokens(wk_text(s)) for ds in wkt.values() for d in ds for s in d["senses"]])

    out, dropped, rare = [], [], []
    for i, key in enumerate(sorted(words)):
        e = build_entry(key, words[key], wn, wkt.get(key, []), ipadict, ngsl_forms, idf)
        zmax = e.pop("_zmax")
        if not e["senses"]:
            dropped.append(key)  # nothing to ask about
            continue
        if zmax < MIN_ZIPF:
            rare.append(key)  # listed, but almost never used (glocal, cyberpet, gracefulness)
            continue
        e["id"] = key
        out.append(e)
        if i % 2000 == 0:
            print(f"  {i}/{len(words)} {key}", file=sys.stderr)

    # stats
    st = defaultdict(int)
    for e in out:
        st["total"] += 1
        st["with_senses"] += bool(e["senses"])
        st["wordnet_senses"] += bool(e["senses"]) and "src" not in e["senses"][0]
        st["with_examples"] += bool(e["ex"])
        st["with_collocations"] += bool(e["col"])
        st["with_ipa"] += bool(e["ipa"])
        st[f"cefr_{e['cefr']}"] += 1
        st[f"src_{e['src']}"] += 1
    st["dropped_no_senses"] = len(dropped)
    st["dropped_rare"] = len(rare)
    meta = {
        "built": date.today().isoformat(),
        "stats": dict(sorted(st.items())),
        "sources": {
            "wordnet": "Princeton WordNet 3.1 (WordNet License)",
            "wiktionary": "Wiktionary via kaikki.org (CC BY-SA 4.0)",
            "cefrj": "CEFR-J Wordlist 1.5, Tono Laboratory, TUFS",
            "octanove": "Octanove Vocabulary Profile C1/C2 1.0 (CC BY-SA 4.0)",
            "oxford": "The Oxford 5000, Oxford University Press (levels only)",
            "efllex": "EFLLex, Duerlich & Francois 2018, CEFRLex/UCLouvain (CC BY-NC-SA 4.0)",
            "kelly": "Kelly list English, Kilgarriff et al. 2014 (CC BY-NC-SA 2.0)",
            "ngsl": "NGSL / NAWL / TSL / BSL word forms, Browne, Culligan & Phillips (CC BY-SA 4.0)",
            "ipadict": "ipa-dict en_US (MIT)",
            "wordfreq": "wordfreq (Speer, CC BY-SA 4.0)",
        },
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "words": out}, f, ensure_ascii=False, separators=(",", ":"))
    write_csv(out)
    print(json.dumps(meta["stats"], indent=1))
    print(f"-> {OUT_JSON} ({OUT_JSON.stat().st_size/1e6:.1f} MB)")


def write_csv(entries) -> None:
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    unmask = lambda s: s.replace("[[", "").replace("]]", "")  # noqa: E731
    cols = ["word", "pos", "ipa_us", "ipa_uk", "cefr", "cefr_source"] + [f"level_{n}" for n, _ in LEVEL_SOURCES] + ["zipf"]
    for i in range(1, MAX_SENSES + 1):
        cols += [f"definition{i}", f"pos{i}", f"synonyms{i}"]
    cols += ["examples", "collocations"]
    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for e in entries:
            row = [e["w"], "/".join(e["pos"]), e["ipa"].get("us", ""), e["ipa"].get("uk", ""), e["cefr"], e["src"]]
            row += [e["levels"].get(n, "") for n, _ in LEVEL_SOURCES] + [e["zipf"]]
            for i in range(MAX_SENSES):
                if i < len(e["senses"]):
                    s = e["senses"][i]
                    row += [unmask(s["d"]), s["p"], "; ".join(s["s"])]
                else:
                    row += ["", "", ""]
            row += [" | ".join(map(unmask, e["ex"])), " | ".join(map(unmask, e["col"]))]
            w.writerow(row)


if __name__ == "__main__":
    {"candidates": cmd_candidates, "build": cmd_build}[sys.argv[1] if len(sys.argv) > 1 else "build"]()
