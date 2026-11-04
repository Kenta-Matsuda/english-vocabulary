"""Readers for the raw word-list sources in data/raw/.

Each reader returns an iterable of headwords (plus metadata where relevant).
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
EIKEN_ORDER = ["2", "pre1", "1"]  # lower grade first

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


# ---------------------------------------------------------------- TOEFL / TOEIC

def read_toefl1000():
    with open(RAW / "toefl" / "toefl_essential_vocabulary.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            yield row["word"]


def read_toeic600():
    with open(RAW / "toeic" / "toeic_600_words.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            yield row["english"]


def _read_lines(path: Path) -> list[str]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return text.splitlines()


def _ngsl_teaching(name: str):
    if True:
        for line in _read_lines(RAW / "ngsl" / name):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            yield line.split(",")[0]


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


def read_tsl():
    return _ngsl_teaching("TSL_12_lemmatized_for_teaching.csv")


def read_bsl():
    return _ngsl_teaching("BSL_120_lemmatized_for_teaching.csv")


def read_nawl():
    return _ngsl_teaching("NAWL_12_lemmatized_for_teaching.csv")


def read_ngsl():
    return _ngsl_teaching("NGSL_12_lemmatized_for_teaching.csv")


def read_awl():
    with open(RAW / "awl" / "awl_headwords.tsv", encoding="utf-8") as f:
        next(f)
        for line in f:
            yield line.split("\t")[0]


# ---------------------------------------------------------------- Eiken (Anki exports)

def _anki_rows(path: Path):
    lines = [l for l in open(path, encoding="utf-8") if not l.startswith("#")]
    return list(csv.reader(lines, delimiter="\t"))


def _first_field(path: Path):
    for r in _anki_rows(path):
        if r:
            yield r[0]


def _regex_field(path: Path, pattern: str, col: int = 0):
    rx = re.compile(pattern, re.S | re.I)
    for r in _anki_rows(path):
        if len(r) > col:
            m = rx.search(r[col])
            if m:
                yield m.group(1)


def read_eiken():
    """Yield (headword, grade). grade in {"1","pre1","2"}.

    Note: "英検1級パス単 AI例文.txt" contains only sentences (no headword field),
    so it cannot be used as a word source and is skipped.
    """
    e = RAW / "eiken"
    sources = [
        ("1", e / "1" / "Eiken Core Vocabulary.txt", None),
        ("1", e / "1" / "英検1級_単語.txt", None),
        ("pre1", e / "semi-1" / "英検準1級.txt", None),
        ("pre1", e / "semi-1" / "でる順パス単.txt", r'<P class="word">(.*?)</P>'),
        ("pre1", e / "semi-1" / "英検準1級出る度A.txt", r"<h3>(.*?)<br"),
        ("2", e / "2" / "Eiken 2.txt", None),
        ("2", e / "2" / "4000 Essential English Words.txt",
         r"font-size: 70px;color:#FF80DD;'>(.*?)</div>"),
    ]
    for grade, path, rx in sources:
        it = _first_field(path) if rx is None else _regex_field(path, rx)
        for w in it:
            yield w, grade, path.name
