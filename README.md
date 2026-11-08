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
python -m pip install wordfreq orjson xlrd
python scripts/build_dataset.py candidates      # 候補語リスト -> data/interim/candidates.txt
# Wiktionaryダンプを data/raw/_big/kaikki-English.jsonl に置く
#   https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
python scripts/extract_wiktionary.py            # -> data/interim/wiktionary_subset.jsonl.gz
python scripts/build_dataset.py build           # -> web/public/data/words.json, data/dist/vocabulary.csv
```

`wiktionary_subset.jsonl.gz` はコミット済みなので、3.2GBのダンプがなくても `build` は再実行できる。

### 収録語の決め方
- **CEFRレベルが付いた語彙リスト**に載っている**単語（1語）だけ**を収録する。英検・TOEIC・TOEFLの区分は使わない。熟語は見出しにせず、各単語のコロケーション・例文として示す。
- レベルは次の順で、**最初に載っているリストのレベル**を採用する（同じリスト内で品詞ごとにレベルが違う場合は低いほう）。

  | 優先 | リスト | レベル | 性質 | 採用語数 |
  |---|---|---|---|---|
  | 1 | CEFR-J Wordlist 1.5 | A1〜B2 | 研究者が作成・検証した語彙表 | 6,773 |
  | 2 | Octanove Vocabulary Profile | C1〜C2 | CEFR-Jの上位レベル拡張 | 1,721 |
  | 3 | Oxford 5000 | A1〜C1 | OUPがコーパスと専門家の判断で作成 | 554 |
  | 4 | EFLLex（CEFRLex） | A1〜C1 | CEFR準拠の教科書・リーダーでの出現から算出（初出レベル） | 2,060 |
  | 5 | Kelly list | A1〜C2 | EUの研究プロジェクト。コーパス頻度帯をCEFRに対応づけたもの | 399 |

  - 4・5はレベルが頻度から機械的に決まっているため、追加するのは「WordNetに載っている一般語」かつ「固有名詞・活用形・数詞・略語でない」かつ「Zipf 2.5以上」の語だけ。
  - 参考: 共通する語でCEFR-Jとレベルが一致する割合は Oxford 44%（±1以内 87%）、EFLLex 40%（同 82%）、Kelly 29%（同 64%）。リスト間でもこの程度は揺れる。
  - サイトでは出題範囲を「Source」で絞れる（例: CEFR-J + Octanove + Oxford だけにする）。単語ページには各リストでのレベルを表示する。
- 語義が1つも取れなかった語（51語）は出題できないので収録しない。
- イギリス式とアメリカ式の綴り（colour/color, analyse/analyze など）は、頻度が高いほうの見出しに統合する。

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
- Oxford 5000 のファイルにはOUPの語義・例文も入っているが、使うのは**見出し語・品詞・レベルだけ**。
- NGSL系リスト（NGSL/NAWL/TSL/BSL）は活用形の取得（空欄にする語形の判定）にだけ使う。
- `data/raw/` の英検・TOEIC・TOEFL・AWLのファイルは、現在はデータ作成に使っていない。

### 収録数（作成時点）
11,507語。すべてにCEFRレベルと語義がある（例文あり: 8,238 / コロケーションあり: 6,923 / 発音記号あり: 11,177）
A1 1,167・A2 1,476・B1 2,435・B2 3,162・C1 2,109・C2 1,158

## サイトの機能
- **サイクル**: 出題範囲（CEFRレベル。必要ならレベルの出典リストでも絞れる）と語数を決めて、テスト範囲を固定する。サイクル内のテストはすべて同じ語を、毎回ランダムな順番で出題する。
  - 次のサイクルを作るときは、前のサイクルで間違えた語を**必ず繰り越す**（「どれかのテストで間違えた語」か「最後のテストで間違えた語」かを設定で選べる）。
  - 残りの枠は「復習（過去に出題した語）」と「新しい語」を、設定した割合でランダムに選ぶ。
- **印刷（PDF）**: ブラウザの印刷から「PDFに保存」で保存できる（A4、ページ番号つき）。
  - **暗記用シート (Study sheet)**: 見出し語・発音記号・レベル・全語義（品詞つき）・類語・コロケーション・例文。確認用のチェックボックスつき。前のサイクルから繰り越した語には★を付ける。
  - **テスト用紙 (Test sheet)**: 語義・類語・コロケーション・例文（見出し語は空欄）と、頭文字が入った文字数分のマス目の解答欄。採点欄つき。
  - **解答 (Answer key)**: 3列で番号・単語・発音記号。テスト用紙とは別に印刷できる（両方まとめて印刷も可）。
- **オンラインテスト**: 答えを入力し、自動で採点する。採点結果は後から手で修正できる。
- **紙テストの結果登録**: 印刷したときと同じ順番で ○× を入力する。
- **クイックテスト**: サイクルとは別に、範囲を決めてランダムに10問・100問・任意の問題数で出題する。
- **履歴**: ブラウザ（IndexedDB）に保存する。JSONでのエクスポート・インポート（追加または置き換え）に対応。
- **発音**: ブラウザ標準の読み上げ（Web Speech API）を使う。通信なしですぐ鳴る。自然な英語音声（Microsoft Aria Online (Natural) など）が入っている **Microsoft Edge** での利用を推奨。設定画面でアクセント（US/UK）と音声を選べる。

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
| Oxford 5000（winterdl/oxford-5000-vocabulary-audio-definition 経由） | data/raw/cefr/oxford | © Oxford University Press。レベルのみ使用・個人利用 |
| EFLLex（Dürlich & François 2018, CEFRLex / UCLouvain） | data/raw/cefr/efllex | CC BY-NC-SA 4.0 |
| Kelly list English（Kilgarriff et al. 2014、antdurrant/word.lists 経由） | data/raw/cefr/kelly | CC BY-NC-SA 2.0 |
| NGSL / NAWL / TSL / BSL（Browne, Culligan & Phillips） | data/raw/ngsl | CC BY-SA 4.0（活用形のみ使用） |
| ipa-dict en_US | data/raw/ipa | MIT |
| wordfreq | （ビルド時に利用） | Apache-2.0 / データは CC BY-SA 4.0 |
| 英検・TOEIC・TOEFL・AWL | data/raw/eiken, toeic, toefl, awl | 現在は未使用 |

---

## 当初のメモ

- 作りたいデータの形: | 英単語 | CEFR | 英検区分 | TOEIC頻出 | TOEFL頻出 | 語義１（英文）（のちにCEFRだけに変更） | 類語１ | 語義２（英文） | 類語２ | ... | 用例 | → `data/dist/vocabulary.csv` として出力済み
- テスト: 特定のCEFRや英検級などに該当する単語をランダムにN個選び、英文の語義と類語の情報から英単語を当てる
- 問題と解答（用例があれば載せる）をPDFで印刷できるようにする。学習履歴はブラウザに保存する
- 音声: GeminiのAPIキーで発音を聞けるようにする（BYOK）（のちにブラウザ標準の読み上げに変更）
