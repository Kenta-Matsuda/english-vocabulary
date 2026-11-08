"""Build the vocabulary dataset used by the web app.

Usage:
  python scripts/build_dataset.py candidates   # step 1: write data/interim/candidates.txt
  python scripts/extract_wiktionary.py          # step 2: (needs the 3.2GB kaikki dump)
  python scripts/build_dataset.py build        # step 3: write web/public/data/words.json
                                                #         and data/dist/vocabulary.csv

Source priority (most trusted first):
  definitions : WordNet 3.1  >  Wiktionary (only when WordNet has no entry)
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
from datetime import date
from pathlib import Path

import orjson
from wordfreq import zipf_frequency

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources as S  # noqa: E402
from wordnet import WordNet  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
INTERIM = ROOT / "data" / "interim"
OUT_JSON = ROOT / "web" / "public" / "data" / "words.json"
OUT_CSV = ROOT / "data" / "dist" / "vocabulary.csv"

MAX_SENSES = 5
MAX_SYNONYMS = 10
MAX_EXAMPLES = 4
MAX_COLLOCATIONS = 6

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
    return clean_text(t).rstrip(" :;,")


def good_synonym(x: str) -> bool:
    # numerals and codes ("8" for eight, "atomic number 6", "a/c") give the answer away or are not words
    return not re.search(r"[0-9/]", x)


def build_entry(key: str, info: dict, wn: WordNet, wk: list[dict], ipadict, ngsl_forms) -> dict:
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

    senses = []
    examples: list[str] = []
    collocs: list[str] = []
    pos_seen = list(info["pos"])

    def add_example(text: str):
        if re.search(r"#\d+;", text):
            return  # LaTeX math escaped by the Wiktionary dump (#92;frac#123;...)
        # several examples run together with wide gaps ("abject failure   abject terror")
        parts = [p for p in re.split(r";?\s{2,}|;\s+(?=\S)", text) if p.strip()] if re.search(r"\s{2,}", text) else [text]
        if len(parts) > 1:
            for p in parts:
                add_example(p)
            return
        text = clean_text(text)
        if not masker.contains(text):
            return
        nt = n_tokens(text)
        # short lowercase fragments ("able to swim", "a free man") are collocations,
        # anything else long enough is treated as an example sentence
        is_phrase = nt <= 5 and text[:1].islower() and not re.search(r"[.!?]$", text)
        if is_phrase:
            m = masker.mark(text)
            if m not in collocs and nt >= 2:
                collocs.append(m)
        elif 4 <= nt <= 35:
            m = masker.mark(text)
            if m not in examples:
                examples.append(m)

    # ---- WordNet senses
    cands = []
    for p, rank, ss in wn.senses(key):
        lemma_here = next((l for l in ss.lemmas if l.lower() == key), key)
        if lemma_here[:1].isupper() and not (info["display"] or "")[:1].isupper():
            continue  # proper-noun sense (e.g. 'March' for 'march')
        tc = wn.tagcount.get((key, ss.offset), 0)
        # tie-break (mostly for rare words where every tag count is 0): prefer senses that
        # have synonyms / an example using the word, and avoid "(geology) ..." domain senses
        quality = (len(ss.lemmas) > 1) + any(masker.contains(e) for e in ss.examples)             - ss.definition.startswith("(")
        cands.append((-tc, -quality, rank, p, ss))
    cands.sort(key=lambda t: t[:3])
    for _neg, _q, _rank, p, ss in cands[:MAX_SENSES]:
        syn_pool: dict[str, tuple[int, float]] = {}
        for l in ss.lemmas:
            ll = l.lower()
            if ll == key or masker.leaks(l) or not good_synonym(l):
                continue
            score = (wn.tagcount.get((ll, ss.offset), 0), zipf(l))
            if ll not in syn_pool or syn_pool[ll] < score:
                syn_pool[ll] = score
        syns = dedupe_variants(key, sorted(syn_pool, key=lambda l: syn_pool[l], reverse=True))[:MAX_SYNONYMS]
        tag = POS_MAP[ss.pos]
        senses.append({"p": tag, "d": masker.mark_loose(clean_definition(ss.definition)), "s": syns})
        if tag not in pos_seen:
            pos_seen.append(tag)
    # examples from *all* the word's synsets (sense order), not just the top ones shown
    for _neg, _q, _rank, _p, ss in cands:
        for ex in ss.examples:
            add_example(ex)

    # ---- Wiktionary
    good_senses = []
    for d in wk:
        if d["word"].lower() != key:
            continue
        for s in d["senses"]:
            if s["form_of"] or set(s["tags"]) & BAD_TAGS or not s["glosses"]:
                continue
            good_senses.append((d, s))
    for d, s in good_senses:
        for ex in s["examples"]:
            add_example(ex)
    if not senses:
        for d, s in good_senses:
            if len(senses) >= 3:
                break
            gloss = s["glosses"][-1]
            if gloss.startswith("..."):
                continue
            syns = [x for x in dict.fromkeys(s["synonyms"] + d["synonyms"])
                    if not masker.leaks(x) and good_synonym(x) and zipf(x) >= 2.5]
            syns = dedupe_variants(key, sorted(syns, key=zipf, reverse=True))[:MAX_SYNONYMS]
            tag = POS_MAP.get(d["pos"], d["pos"])
            senses.append({"p": tag, "d": masker.mark_loose(clean_definition(gloss)), "s": syns, "src": "wkt"})
            if tag not in pos_seen:
                pos_seen.append(tag)

    # ---- collocations from derived multi-word terms that WordNet also lists (= established phrases)
    derived = set()
    for d in wk:
        if d["word"].lower() == key:
            derived |= {x for x in d["derived"] if " " in x and 2 <= n_tokens(x) <= 4}
    phrase_c = [x for x in derived if x.lower() in wn.all_lemmas and masker.contains(x)]
    phrase_c.sort(key=zipf, reverse=True)
    for x in phrase_c:
        m = masker.mark(x)
        if m not in collocs:
            collocs.append(m)

    entry = {
        "w": info["display"] or key,
        "pos": pos_seen,
        "cefr": info["cefr"],
        "src": info["cefr_src"],
        "levels": info["levels"],
        "zipf": round(zipf(key), 2),
        "ipa": pick_ipa([d for d in wk], key, ipadict),
        "senses": senses,
        "ex": examples[:MAX_EXAMPLES],
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

    out, dropped = [], []
    for i, key in enumerate(sorted(words)):
        e = build_entry(key, words[key], wn, wkt.get(key, []), ipadict, ngsl_forms)
        if not e["senses"]:
            dropped.append(key)  # nothing to ask about
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
