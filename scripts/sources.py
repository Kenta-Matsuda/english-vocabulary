"""Readers for the raw word-list sources in data/raw/.

CEFR readers yield (headword, pos, level). NGSL-family lists are used only for
inflected forms (masking), not as word sources.
Only English headwords are extracted; translations (Japanese, Vietnamese...)
are deliberately ignored.
"""
from __future__ import annotations

import csv
import html
import re
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

csv.field_size_limit(10**9)

CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]

_TAG = re.compile(r"<[^>]+>")
_SOUND = re.compile(r"\[sound:[^\]]*\]")


def clean_html(s: str) -> str:
    s = _SOUND.sub(" ", s)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = _TAG.sub(" ", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def normalize_headword(s: str) -> str | None:
    """Return a lowercase single-word key or None if it is not a single word."""
    s = clean_html(s).strip(" .,;:!?\"'“”‘’()")
    if not s or " " in s:
        return None
    s = s.replace("’", "'")
    if not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*[A-Za-z]|[A-Za-z]", s):
        return None
    return s.lower()


# ---------------------------------------------------------------- CEFR

def read_cefr():
    """Yield (word, pos, level). CEFR-J 1.5 (A1-B2) + Octanove C1/C2."""
    with open(RAW / "cefr" / "word_list_cefr.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            yield row["headword"], row["pos"], row["CEFR"].strip()
    with open(RAW / "cefr" / "octanove-vocabulary-profile-c1c2-1.0.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            yield row["headword"], row["pos"], row["CEFR"].strip()


def read_oxford5000():
    """Yield (word, pos, level) from the Oxford 5000 (A1-C1). Only the word, pos and level are used;
    the OUP definitions/examples in the same file are ignored."""
    with open(RAW / "cefr" / "oxford" / "oxford_5000.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            lvl = row["cefr"].strip().upper()
            if lvl in CEFR_ORDER:
                yield row["word"], row["type"], lvl


EFLLEX_LEVELS = ["A1", "A2", "B1", "B2", "C1"]
EFLLEX_MIN_DOCS = 1
_PTB = {"NN": "noun", "VB": "verb", "JJ": "adjective", "RB": "adverb", "IN": "preposition",
        "CC": "conjunction", "DT": "determiner", "PRP": "pronoun", "UH": "interjection", "CD": "number"}


def read_efllex():
    """Yield (word, pos, level) from EFLLex (Duerlich & Francois 2018).

    EFLLex gives, for every lemma, the number of CEFR-graded textbooks/readers at each level
    (A1..C1) it occurs in. Level = the first level at which it has occurred in at least
    EFLLEX_MIN_DOCS documents (cumulatively). With 1 (first occurrence, the usual CEFRLex
    baseline) agreement with CEFR-J on shared words is the same as with 2 (40% exact,
    82% within one level; Oxford 5000 vs CEFR-J: 44% / 87%), so the larger coverage is kept."""
    with open(RAW / "cefr" / "efllex" / "EFLLex.tsv", encoding="utf-8") as f:
        rows = csv.reader(f, delimiter="	")
        head = next(rows)
        doc_cols = [head.index(f"nb_doc@{l.lower()}") for l in EFLLEX_LEVELS]
        for r in rows:
            seen = 0.0
            for lvl, c in zip(EFLLEX_LEVELS, doc_cols):
                seen += float(r[c])
                if seen >= EFLLEX_MIN_DOCS:
                    yield r[0], _PTB.get(r[1], ""), lvl
                    break


def read_kelly():
    """Yield (word, pos, level) from the English Kelly list (Kilgarriff et al. 2014), A1-C2."""
    import xlrd  # only needed here

    sh = xlrd.open_workbook(str(RAW / "cefr" / "kelly" / "en_m3.xls")).sheet_by_index(0)
    for i in range(1, sh.nrows):
        _id, word, pos, lvl = sh.row_values(i)[:4]
        lvl = str(lvl).strip("“”\" ")
        if lvl in CEFR_ORDER:
            yield str(word), str(pos).lower(), lvl


def _read_lines(path: Path) -> list[str]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return text.splitlines()


def read_ngsl_forms():
    """Yield (headword, [forms]) from all NGSL-family teaching lists."""
    for name in ["NGSL_12_lemmatized_for_teaching.csv", "NAWL_12_lemmatized_for_teaching.csv",
                 "TSL_12_lemmatized_for_teaching.csv", "BSL_120_lemmatized_for_teaching.csv"]:
        if True:
            for line in _read_lines(RAW / "ngsl" / name):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split(",") if p.strip()]
                yield parts[0], parts[1:]
