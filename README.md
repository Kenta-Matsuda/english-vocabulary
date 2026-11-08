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
  | 1 | CEFR-J Wordlist 1.5 | A1〜B2 | 研究者が作成・検証した語彙表 | 6,719 |
  | 2 | Octanove Vocabulary Profile | C1〜C2 | CEFR-Jの上位レベル拡張 | 1,552 |
  | 3 | Oxford 5000 | A1〜C1 | OUPがコーパスと専門家の判断で作成 | 554 |
  | 4 | EFLLex（CEFRLex） | A1〜C1 | CEFR準拠の教科書・リーダーでの出現から算出（初出レベル） | 2,060 |
  | 5 | Kelly list | A1〜C2 | EUの研究プロジェクト。コーパス頻度帯をCEFRに対応づけたもの | 399 |

  - 4・5はレベルが頻度から機械的に決まっているため、追加するのは「WordNetに載っている一般語」かつ「固有名詞・活用形・数詞・略語でない」かつ「Zipf 2.5以上」の語だけ。
  - 参考: 共通する語でCEFR-Jとレベルが一致する割合は Oxford 44%（±1以内 87%）、EFLLex 40%（同 82%）、Kelly 29%（同 64%）。リスト間でもこの程度は揺れる。
  - サイトでは出題範囲を「Source」で絞れる（例: CEFR-J + Octanove + Oxford だけにする）。単語ページには各リストでのレベルを表示する。
- 語義が1つも取れなかった語（54語）は出題できないので収録しない。
- リストに載っていても、**どの活用形もZipf 2.0未満**（1億語に1回程度より少ない）の語は収録しない（220語。glocal, cyberpet, gracefulness, amorphously など、造語やまれな派生語）。bewilder のように原形はまれでも bewildered がよく使われる語は残る。
- イギリス式とアメリカ式の綴り（colour/color, analyse/analyze など）は、頻度が高いほうの見出しに統合する。

### 内容の採用元（信頼度の高い順）
| 項目 | 採用元 |
|---|---|
| 語義 | WordNet 3.1 の語義から、学習する価値のあるものだけを選ぶ（下記「語義の選び方」、最大5件）。WordNetにない語や、WordNetにない・定義がおかしい主要な語義はWiktionary |
| 類語 | 同じsynsetのWordNet語のみ（形容詞の「similar to」でつながる語は意味が離れるため含めない）。**正解の語やその派生語を含むものは除外**し、使用頻度の上位10件まで |
| 例文 | 表示する語義のWordNet用例・Wiktionary用例（編集者が書いた短い用例のみ）。**完全な文（大文字で始まり句点で終わる）を優先**し、それが2つ以上あればWordNetの断片的な用例（"his taste was impeccable, his health admirable"）は使わない。落とした語義の用例は使わない |
| コロケーション | 表示する語義のWordNetの短い用例（"able to swim" など）、WordNetにも載っているWiktionaryの派生フレーズ。冠詞だけ違う重複（the margin of victory / margin of victory）は1つにする |
| 発音記号 | Wiktionary（米: GA / 英: RP）→ ipa-dict（米） |
| 頻度 | wordfreq（Zipf値） |

#### 語義の選び方
WordNetは知っている語義をすべて載せていて（broadcaster の「肥料散布機」、crease の「マレー短剣」、eagle の「10ドル金貨」など）、頻度の情報はSemCorのタグ数しかない（ほとんどの語義で0）。そこでWiktionaryの2つの情報を使う。

- **翻訳された言語の数**: 編集者は実際に使われる語義から翻訳するので、語義の使用頻度の目安になる（broadcaster: 「放送者」41言語 / 「肥料散布機」1言語）。
- **用法ラベル**: historical, archaic, dated, obsolete, slang, humorous など。

各WordNet語義を、同じ品詞のWiktionary語義のうち最も似たもの（定義・用例・類語・上位語の単語の重なり、IDF重み付き）に対応づけ、その翻訳数とラベルを引き継ぐ。そのうえで:

1. **落とす**: 対応するWiktionary語義にラベルがある（eagle「金貨」historical、paw「手」humorous、trillion「10^18」dated）、WordNet自身のラベルがある（brag 形容詞「すごい」colloquialism）、見出し語が複合語の略になっている（acute = acute accent）、地域限定（"in Great Britain"）。
2. **落とす**: 翻訳数がその品詞の最多語義の25%未満、かつWordNetの第1語義でない、かつSemCorでほぼ未出現（2回未満）。3つすべてがそろったときだけ落とす（翻訳表が別の語義に付いていることがあり、翻訳数0だけでは珍しいとは言えないため）。
3. **重複をまとめる**: 複数のWordNet語義が同じWiktionary語義に対応する場合（crease「しわを作る」「しわにする」）は1つにする。
4. **Wiktionaryで補う**: WordNetが持っていない、またはWordNetの定義が対応しない主要な語義（翻訳数が最多の50%以上）はWiktionaryの定義を加える（up-and-coming: "Emerging; aspiring; beginning to attract attention"）。答えが見える循環定義（"One who broadcasts", "Not honest"）は使わない。
5. **並べ順**: 翻訳数の割合（品詞ごと）と、WordNetの順・SemCorタグ数の大きいほう。

例: broadcaster は「放送する人」だけ、brag は「v. show off / n. an instance of boastful talk」、trillion は「10^12」だけになる。

- 語義・例文・コロケーションに出てくる見出し語（活用形や、語義中の派生語も含む）は `[[...]]` で印を付けてあり、問題では空欄にして表示する。
- Oxford 5000 のファイルにはOUPの語義・例文も入っているが、使うのは**見出し語・品詞・レベルだけ**。
- NGSL系リスト（NGSL/NAWL/TSL/BSL）は活用形の取得（空欄にする語形の判定）にだけ使う。
- `data/raw/` の英検・TOEIC・TOEFL・AWLのファイルは、現在はデータ作成に使っていない。

### 収録数（作成時点）
11,284語。すべてにCEFRレベルと語義がある（例文あり: 7,471 / コロケーションあり: 6,442 / 発音記号あり: 11,091）
A1 1,165・A2 1,473・B1 2,432・B2 3,116・C1 2,052・C2 1,046

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
