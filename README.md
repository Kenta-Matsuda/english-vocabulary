# English Vocabulary Trainer

英語の語義・類語・コロケーション・例文から英単語を当てる、個人用の学習サイト（GitHub Pages / 静的サイト）。
コンセプトは「英語は英語で勉強する」。日本語訳などの訳語は一切使わない。

## 構成

```
data/
  raw/                 取得した元データ（下記「データソース」）
    _big/              Wiktionary全量ダンプ（3.2GB、git管理外）
  interim/             中間データ（候補語リスト、Wiktionaryの必要部分だけ抜き出したもの）
  dist/vocabulary.csv  完成データのCSV版（確認・他用途向け）
scripts/               データ作成スクリプト（Python）
web/                   サイト本体（Vite + Preact + TypeScript）
  public/data/words.json  サイトが読む完成データ（1回作成してコミット済み）
.github/workflows/pages.yml  GitHub Pagesへのデプロイ（サイトのビルドのみ。データは再作成しない）
```

## データの作り方（1回だけ実行済み。作り直すときのみ）

```sh
python -m pip install wordfreq orjson
python scripts/build_dataset.py candidates      # 候補語リスト -> data/interim/candidates.txt
# Wiktionaryダンプを data/raw/_big/kaikki-English.jsonl に置く
#   https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
python scripts/extract_wiktionary.py            # -> data/interim/wiktionary_subset.jsonl.gz
python scripts/build_dataset.py build           # -> web/public/data/words.json, data/dist/vocabulary.csv
```

`wiktionary_subset.jsonl.gz` はコミット済みなので、3.2GBのダンプがなくても `build` は再実行できる。

### 収録語の決め方
- 英検・TOEIC・TOEFL・CEFRのリストに載っている**単語（1語）だけ**を収録する。熟語は見出しにせず、各単語のコロケーション・例文として示す。
- CEFR: A1〜B2はCEFR-J、C1〜C2はOctanove。品詞ごとにレベルが違う場合は**低いほう**を採用。
- 英検: 2級・準1級・1級。複数の級に載っている語は**低い級**に揃える。
- TOEIC頻出 = TOEIC 600 ∪ TSL。TOEFL頻出 = TOEFL 1000 ∪ NAWL ∪ AWL。

### 内容の採用元（信頼度の高い順）
| 項目 | 採用元 |
|---|---|
| 語義 | WordNet 3.1（タグ付きコーパスでの使用頻度順、最大5件）→ WordNetにない語だけWiktionary |
| 類語 | 同じsynsetのWordNet語（形容詞は「similar to」も含む）。**正解の語やその派生語を含むものは除外**し、使用頻度の上位10件まで |
| 例文 | WordNetの用例 → Wiktionaryの用例（編集者が書いた短い用例のみ。廃語・俗語の語義は除く） |
| コロケーション | WordNetの短い用例（"able to swim" など）、WordNetにも載っているWiktionaryの派生フレーズ |
| 発音記号 | Wiktionary（米: GA / 英: RP）→ ipa-dict（米） |
| 頻度 | wordfreq（Zipf値） |

- 語義・例文・コロケーションに出てくる見出し語（活用形や、語義中の派生語も含む）は `[[...]]` で印を付けてあり、問題では空欄にして表示する。
- TOEFL 1000 / TOEIC 600 のデータセットは品質が保証されていないため、**どのリストに載っているかの判定だけ**に使い、語義・例文には使っていない。
- 英検のAnkiデッキも**見出し語だけ**を使う（訳語・例文は使わない）。`英検1級パス単 AI例文.txt` は見出し語の欄がないため使っていない。

### 収録数（作成時点）
11,698語（語義あり: 11,628 / 例文あり: 8,501 / コロケーションあり: 6,997 / 発音記号あり: 11,409）
CEFR A1 1,069・A2 1,229・B1 2,124・B2 2,462・C1 893・C2 846 / 英検2級 1,939・準1級 2,868・1級 951 / TOEIC 1,670 / TOEFL 2,123

## サイトの機能
- **サイクル**: 出題範囲（CEFR / 英検 / TOEIC / TOEFL の組み合わせ）と語数を決めて、テスト範囲を固定する。サイクル内のテストはすべて同じ語を、毎回ランダムな順番で出題する。
  - 次のサイクルを作るときは、前のサイクルで間違えた語を**必ず繰り越す**（「どれかのテストで間違えた語」か「最後のテストで間違えた語」かを設定で選べる）。
  - 残りの枠は「復習（過去に出題した語）」と「新しい語」を、設定した割合でランダムに選ぶ。
- **印刷（PDF）**: 単語リスト、問題用紙（解答欄つき）、解答（発音記号・例文つき）。ブラウザの印刷から「PDFに保存」で保存できる。
- **オンラインテスト**: 答えを入力し、自動で採点する。採点結果は後から手で修正できる。
- **紙テストの結果登録**: 印刷したときと同じ順番で ○× を入力する。
- **クイックテスト**: サイクルとは別に、範囲を決めてランダムに10問・100問・任意の問題数で出題する。
- **履歴**: ブラウザ（IndexedDB）に保存する。JSONでのエクスポート・インポート（追加または置き換え）に対応。
- **発音**: Gemini TTS（自分のAPIキーを使うBYOK）。音声は保存せず毎回生成する。キーを設定していない場合はブラウザ標準の読み上げを使う。

### 毎週の使い方の例（作成者の場合）
土曜: サイクルを作成して単語リストを印刷 → 月・水・金: 紙テストを印刷して解き、○×を入力 → 次の土曜: 「Start next cycle」で、間違えた語を繰り越した次のサイクルを作成。

## 開発

```sh
cd web
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

### GitHub Pages
- リポジトリの Settings → Pages → Source を **GitHub Actions** にする。`main` にpushすると自動でデプロイされる。
- 注意: プライベートリポジトリでPagesを使うには有料プラン（Pro以上）が必要。また、Enterprise Cloud以外では**サイト自体は公開URLになる**（`noindex` は設定済み）。完全に非公開にしたい場合は、ローカルで `npm run dev` / `npm run preview` を使う。

## データソースとライセンス
| データ | 場所 | ライセンス |
|---|---|---|
| Princeton WordNet 3.1 | data/raw/wordnet | WordNet License |
| Wiktionary（kaikki.org経由） | data/interim/wiktionary_subset.jsonl.gz | CC BY-SA 4.0 |
| CEFR-J Wordlist 1.5（Maximax67/Words-CEFR-Dataset 経由） | data/raw/cefr/word_list_cefr.csv | CEFR-J利用規約（出典の明記が必要） |
| Octanove Vocabulary Profile C1/C2 | data/raw/cefr/octanove-*.csv | CC BY-SA 4.0 |
| NGSL / NAWL / TSL / BSL（Browne, Culligan & Phillips） | data/raw/ngsl | CC BY-SA 4.0 |
| Academic Word List（Coxhead 2000） | data/raw/awl | 学術用リスト（見出し語のみ） |
| ipa-dict en_US | data/raw/ipa | MIT |
| wordfreq | （ビルド時に利用） | Apache-2.0 / データは CC BY-SA 4.0 |
| TOEFL Essential Vocabulary | data/raw/toefl | リスト判定のみに使用 |
| TOEIC 600 Words | data/raw/toeic | リスト判定のみに使用 |
| 英検（個人のAnkiデッキ） | data/raw/eiken | 見出し語のみ使用・個人利用 |

---

## 当初のメモ

- 作りたいデータの形: | 英単語 | CEFR | 英検区分 | TOEIC頻出 | TOEFL頻出 | 語義１（英文） | 類語１ | 語義２（英文） | 類語２ | ... | 用例 | → `data/dist/vocabulary.csv` として出力済み
- テスト: 特定のCEFRや英検級などに該当する単語をランダムにN個選び、英文の語義と類語の情報から英単語を当てる
- 問題と解答（用例があれば載せる）をPDFで印刷できるようにする。学習履歴はブラウザに保存する
- 音声: GeminiのAPIキーで発音を聞けるようにする（BYOK）
