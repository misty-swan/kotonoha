#!/usr/bin/env node
// kotonoha check — 日本語の文章を機械的に点検し、指摘だけを出す（依存なし）。
//
// 使い方:
//   node check.mjs <ファイル>            ファイルを点検する
//   echo "本文" | node check.mjs         標準入力を点検する
//   node check.mjs --json <ファイル>      JSON で出力する
//   node check.mjs --max-length 100 ...  一文の長さの目安を変える（既定 80）
//   node check.mjs --max-ten 4 ...       一文の読点の上限を変える（既定 3。超えたら指摘）
//   node check.mjs --yomiage ...         読み上げ原稿として点検する（声にならない記号を指摘し、
//                                        読点の数・文末の連続・短い主語の後の読点の指摘を緩める）
//
// 正規表現による検出なので、誤検出があります。指摘をすべて直すのではなく、
// 文脈を見て判断してください。コードブロック、インラインコード、引用、URL は対象外です。

import { readFileSync } from 'node:fs';

// ---------- 引数 ----------
const argv = process.argv.slice(2);
let asJson = false;
let maxLength = 80;
let maxTen = 3;
let maxTenGiven = false;
let yomiage = false;
let file = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') asJson = true;
  else if (a === '--max-length') maxLength = Number(argv[++i]) || maxLength;
  else if (a === '--max-ten') { maxTen = Number(argv[++i]) || maxTen; maxTenGiven = true; }
  else if (a === '--yomiage') yomiage = true;
  else if (a === '-h' || a === '--help') {
    console.log('使い方: node check.mjs [--json] [--yomiage] [--max-length N] [--max-ten N] [ファイル]');
    process.exit(0);
  } else file = a;
}

// 読み上げ原稿では、息継ぎの読点を許すため、読点の上限を緩める（yomiage.md 5）。
if (yomiage && !maxTenGiven) maxTen = 5;

let text;
try {
  text = file && file !== '-' ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
} catch (e) {
  console.error(`読み込めませんでした: ${file ?? '標準入力'}（${e.message}）`);
  process.exit(1);
}

// ---------- 前処理 ----------
// 対象外の部分は同じ長さの空白に置き換え、行と位置を保つ。
const blank = (s) => ' '.repeat(s.length);
const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
let inFence = false;
const lines = rawLines.map((line) => {
  if (/^\s*(```|~~~)/.test(line)) {
    inFence = !inFence;
    return '';
  }
  if (inFence) return '';
  if (/^\s*>/.test(line)) return ''; // 引用
  return line
    .replace(/`[^`]*`/g, blank) // インラインコード
    .replace(/https?:\/\/\S+/g, blank) // URL
    .replace(/<!--.*?-->/g, blank);
});

// ---------- ルール ----------
// level: error（誤り）/ hin（品位）/ hyoki（表記）/ check（要確認）
const J = '[ぁ-んァ-ヶ一-龠々ー]'; // 和文の文字
const rules = [
  // --- 誤り ---
  { level: 'error', label: '二重敬語',
    re: /おっしゃられ|ご覧になられ|お越しになられ|お帰りになられ|お読みになられ|お見えになられ|いらっしゃられ|お召し上がりになられ|拝見させていただ|拝読させていただ|伺わせていただ|お伺いさせていただ|申し上げさせていただ/g,
    suggest: (m) => ({
      'おっしゃられ': 'おっしゃる', 'ご覧になられ': 'ご覧になる', 'お越しになられ': 'お越しになる',
      'お帰りになられ': 'お帰りになる', 'お読みになられ': 'お読みになる', 'お見えになられ': 'お見えになる',
      'いらっしゃられ': 'いらっしゃる', 'お召し上がりになられ': 'お召し上がりになる／召し上がる',
      '拝見させていただ': '拝見する', '拝読させていただ': '拝読する', '伺わせていただ': '伺う',
      'お伺いさせていただ': '伺う', '申し上げさせていただ': '申し上げる',
    })[m] },
  { level: 'error', label: 'さ入れ言葉',
    re: /(休ま|行か|読ま|帰ら|書か|使わ|言わ|やら|歌わ|飲ま|待た|送ら|作ら|取ら|撮ら|会わ|買わ|払わ|座ら|頑張ら|選ば|呼ば|運ば|遊ば|急が|泳が)させ(?=て|られ|ます|ない)/g,
    suggest: (m) => m.replace('させ', 'せ') + '（五段動詞に「さ」は入れない）' },
  { level: 'check', label: 'さ入れ言葉の疑い',
    re: /[かがたなばまらわ]させて/g,
    suggest: (m) => `${m[0]}せて？（「減らす」「活かす」など「す」で終わる動詞なら正しい）` },
  { level: 'error', label: 'ら抜き言葉',
    re: /(見|来|食べ|寝|着|出|起き|考え|決め|信じ|逃げ|助け|覚え|教え|借り|降り|生き|変え|続け|受け|答え|調べ|集め|始め|止め|辞め|閉じ|浴び|入れ)れ(る|ない|ます|ません|た|て|なかっ|ず)/g,
    suggest: (m) => m.replace(/れ(?=(る|ない|ます|ません|た|て|なかっ|ず)$)/, 'られ') },
  { level: 'error', label: '重言',
    re: /頭痛が痛|まず最初に|一番最初|(後で|後から)後悔|馬から落馬|必ず必要|一番ベスト|返事を返|元旦の朝|諸先生方|過半数を超え|約[0-9０-９一二三四五六七八九十百千万]+[^、。\s]{0,4}(くらい|ぐらい|ほど)|各[^\s、。]{1,6}ごと|第[0-9０-９一二三四五六七八九十]+日目/g,
    suggest: () => '重なる語の一方を削る' },
  { level: 'error', label: '慣用句の誤用',
    re: /汚名挽回|怒り心頭に達|上へ下への|押しも押されぬ|二の舞を踏/g,
    suggest: (m) => ({
      '汚名挽回': '汚名返上／名誉挽回', '怒り心頭に達': '怒り心頭に発する', '上へ下への': '上を下への',
      '押しも押されぬ': '押しも押されもせぬ', '二の舞を踏': '二の舞を演じる／二の足を踏む',
    })[m] },
  { level: 'error', label: '半角カタカナ', re: /[｡-ﾟ]+/g, suggest: () => '全角カタカナにする' },
  { level: 'error', label: '全角英数字', re: /[０-９Ａ-Ｚａ-ｚ]+/g, suggest: () => '半角にする' },

  { level: 'error', label: '読点の連続', re: /[、，]{2,}/g, suggest: () => '一つにする' },
  { level: 'error', label: '読点の直後の句点', re: /[、，][。．]/g, suggest: () => 'どちらかを削る' },

  // --- 品位 ---
  { level: 'hin', label: '俗語・話し言葉',
    re: /やばい|ヤバい|ヤバ(?=[かくけ])|マジで|マジに|ガチで|めっちゃ|めちゃくちゃ|めちゃめちゃ|ぶっちゃけ|ほぼほぼ|ちゃんと|いっぱい|ゲット|メアド|超(?=(すご|いい|楽し|かわい|可愛|便利|おすすめ|美味|おいし|大事|大切|簡単|嬉し|うれし|面白|おもしろ))/g,
    suggest: () => 'goi.md「話し言葉・俗語」を参照' },
  { level: 'hin', label: '縮約形',
    re: /ちゃ[うっい](?!ろ)|じゃ[うっい](?!ろ)|なきゃ|なくちゃ|じゃない|じゃなく|じゃありません/g,
    suggest: () => '「〜てしまう」「〜なければ」「〜ではない」など' },
  { level: 'hin', label: 'い抜き言葉',
    re: /(っ|い|ん)(て|で)(る|ます|ました|ません|ない|た)/g,
    suggest: (m) => m.replace(/(て|で)/, '$1い') },
  { level: 'hin', label: 'ぼかし言葉',
    re: /みたいな|みたいに|みたいです|的な感じ|って感じ|かなと思|という形で|させていただく形/g,
    suggest: () => '言い切るか、「〜のような」などに' },
  { level: 'hin', label: '「とか」',
    re: /(?<!なん|何)とか(?=[、。もでがはをに\s]|$)/g, suggest: () => '「〜や」「〜など」' },
  { level: 'hin', label: '誇張・煽り',
    re: /最高(?!裁|峰|気温|値|額|責任|経営|速度|水準|学府|位|潮|齢)|最強|究極|圧倒的|完璧|史上最|絶対(?!値|音感|零度|的多数)|激安|爆売れ|衝撃の|話題沸騰|今だけ|今すぐ|お見逃しなく|見逃せない|見逃し厳禁|必見|損する|損しない|急いで(?=[!！。]|くだ|下さ)|お急ぎ(くだ|下さ)|神対応/g,
    suggest: () => '程度を落とすか削る。事実（期間・数量）は残す' },
  { level: 'hin', label: '自ら名乗る価値語',
    re: /高級感|極上|ワンランク上|こだわりの|贅沢な/g,
    suggest: () => '一つに絞るか、原文にある事実に語らせる' },
  { level: 'hin', label: '接客マニュアル調',
    re: /よろしかったでしょうか|からお預かり|のほうを?お(持ち|伺い|預かり)|ございますでしょうか/g,
    suggest: () => 'keigo.md「接客マニュアル調」を参照' },
  { level: 'hin', label: '感嘆符・疑問符の連続', re: /[!！?？]{2,}/g, suggest: () => '句点で静かに終える' },
  { level: 'hin', label: '感嘆符', re: /(?<![!！?？])[!！](?![!！?？])/g, suggest: () => '「。」に替える（多くても一文書に一つ）' },
  { level: 'hin', label: '絵文字・装飾記号', re: /[\p{Extended_Pictographic}♪★☆♡♥]/gu, suggest: () => '外す' },
  { level: 'hin', label: '伸ばし記号の連続', re: /[〜~ー]{2,}/g, suggest: () => '一つにするか外す' },
  { level: 'hin', label: '「笑」「w」', re: /（笑）|\(笑\)|(?<=[ぁ-んァ-ヶ一-龠])w+(?![A-Za-z])|(?<=[ぁ-んァ-ヶ一-龠])笑(?=[。\s]|$)/g, suggest: () => '外す' },

  // --- 表記 ---
  { level: 'hyoki', label: '補助動詞は仮名で', re: /[てで]下さ|[てで]頂[きくけいかこ]|(?<=[ごお][一-龠]{1,4}[みしりきちいびぎにえけせ]?)頂[きくけいかこ]|致し(ます|まし|ませ|て)/g,
    suggest: (m) => m.replace('下さ', 'くださ').replace('頂', 'いただ').replace('致し', 'いたし') },
  { level: 'hyoki', label: '「出来る」は仮名で', re: /出来(?![事栄上高心立映物合秋])/g, suggest: () => 'でき' },
  { level: 'hyoki', label: '副詞・接続詞は仮名で',
    re: /予め|更に|尚、|但し|又は|及び|概ね|殆ど|是非(?!を|も)|宜しく|活気付/g,
    suggest: (m) => ({ '予め': 'あらかじめ', '更に': 'さらに', '尚、': 'なお、', '但し': 'ただし', '又は': 'または',
      '及び': 'および（法令文は及び）', '概ね': 'おおむね', '殆ど': 'ほとんど', '是非': 'ぜひ', '宜しく': 'よろしく',
      '活気付': '活気づ' })[m] },
  { level: 'hyoki', label: '送り仮名', re: /行な[うっいわえお]|表わ[すしさせ]|現われ|終(る|らな|ります|りまし|った)|取扱[うい]|申込[むみま]/g,
    suggest: (m) => m.replace('行な', '行').replace('表わ', '表').replace('現われ', '現れ')
      .replace(/^終/, '終わ').replace('取扱', '取り扱').replace('申込', '申し込') },
  { level: 'hyoki', label: '句読点の混在', re: new RegExp(`(?<=${J})[，,．]`, 'g'), suggest: () => '「、」「。」にそろえる' },
  { level: 'hyoki', label: '三点リーダー', re: /(?<!…)…(?!…)|(?<=[ぁ-んァ-ヶ一-龠])\.{3}/g, suggest: () => '「……」（二つ重ねる）' },

  // --- 要確認 ---
  { level: 'check', label: '「させていただく」', re: /させていただ|せていただ/g, suggest: () => '許可・恩恵がなければ「いたします」' },
  { level: 'check', label: '形式名詞（仮名書きの候補）', re: /(る|た|う|ない)(事|時|所|物)(?![件務業例情実前後故態項柄典間代期点刻計々差給限速効分頃有在属品理件資体質])/g,
    suggest: (m) => m.slice(0, -1) + ({ 事: 'こと', 時: 'とき', 所: 'ところ', 物: 'もの' })[m.slice(-1)] },
  { level: 'check', label: '「〜通り」', re: /(?<=[のたる])通り(?![魔道沿])/g, suggest: () => 'とおり（数字のあとは「通り」）' },
  { level: 'check', label: '「〜になります」', re: /(?<=(こちら|資料|料金|合計|円|お釣り|品|お品物).{0,8})になります/g, suggest: () => '「です」「でございます」' },
  { level: 'check', label: 'カタカナ語',
    re: /アジェンダ|エビデンス|コンセンサス|スキーム|ペンディング|リスケ|フィックス|アサイン|ソリューション|ブラッシュアップ|マスト|ローンチ|ジャストアイデア|コミット|バッファ|ステークホルダー|シナジー|ナレッジ|プライオリティ|アグリー/g,
    suggest: () => 'goi.md「カタカナ語」を参照' },
  { level: 'check', label: '慣用句（要確認）', re: /的を得|采配を振る[うっい]|足元をすく|役不足|熱にうなされ/g,
    suggest: (m) => ({ '的を得': '的を射る（近年は許容する辞書も）', '足元をすく': '足をすくう', '役不足': '力不足の意味なら「力不足」',
      '熱にうなされ': '熱に浮かされる（文脈による）' })[m] ?? '采配を振る' },
  { level: 'check', label: '重言（許容説あり）', re: /違和感を感じ|被害を被|今現在/g, suggest: () => '「違和感を覚える」「被害を受ける」「現在」など' },
  { level: 'check', label: '二重否定', re: /ない(わけ|こと|もの)では(ない|ありません)|なくは(ない|ありません)|ないとは(言えない|限らない)/g,
    suggest: () => '肯定形で言えないか検討する' },
  { level: 'check', label: '引用の「と」の後の読点', re: /と、(思|言|考|感じ|述べ)/g, suggest: () => '「と思う」「と言う」は続けて書く（touten.md 2-4）' },
  { level: 'check', label: '仮名の長い連続', re: /[ぁ-ん]{15,}/g, suggest: () => '読点を打つか、漢字を交える（touten.md 1-12）' },
  { level: 'check', label: '漢字の連続', re: /[一-龠々〆ヵヶ]{7,}/g, suggest: () => '助詞を補うか、和語でほどく' },
];

// 読み上げ原稿でだけ使うルール（yomiage.md 4）。声にならない記号を指摘する。
const yomiageRules = [
  { level: 'check', label: '声にならない記号（中黒）', re: /・/g,
    suggest: () => '読点や「や」「と」でつなぐ。順を追って言う' },
  { level: 'check', label: '声にならない記号（括弧）', re: /[（(][^）)]*[）)]/g,
    suggest: () => '中身を本文に溶かすか、別の文にする' },
  { level: 'check', label: '声にならない記号（二重括弧）', re: /『[^』]*』/g,
    suggest: () => '「〜という」で示し、原稿の中では一種類にそろえる' },
  { level: 'check', label: '声にならない記号（ダッシュ・リーダー）', re: /[―—]+|…+|‥+/g,
    suggest: () => '句点か読点に置き換える' },
  { level: 'check', label: '声にならない記号（スラッシュ）', re: /[／/]/g,
    suggest: () => '「または」「や」「と」に言い換える' },
  { level: 'check', label: '声にならない記号（波ダッシュ）', re: /[〜～~]/g,
    suggest: () => '「から」「まで」と言える形にする' },
  { level: 'check', label: '声にならない記号（米印・矢印）', re: /[※→⇒]/g,
    suggest: () => '本文に溶かすか、確認へ回す' },
  { level: 'check', label: '伏せ字', re: /([〇○●△▲×✕□■＊*])\1+/g,
    suggest: () => 'そのまま読まれてしまう。読む前に入れてもらうよう確認へ回す' },
];
if (yomiage) rules.push(...yomiageRules);

// ---------- 検出 ----------
const findings = [];
const ctx = (line, start, end) => {
  const s = Math.max(0, start - 12);
  const e = Math.min(line.length, end + 12);
  return (s > 0 ? '…' : '') + line.slice(s, e).trim() + (e < line.length ? '…' : '');
};

lines.forEach((line, i) => {
  if (!line.trim()) return;
  for (const r of rules) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(line)) !== null) {
      if (m[0] === '') { r.re.lastIndex++; continue; }
      findings.push({
        level: r.level, rule: r.label, line: i + 1, col: m.index + 1,
        start: m.index, end: m.index + m[0].length,
        match: m[0], suggest: r.suggest ? r.suggest(m[0]) : undefined,
        context: ctx(rawLines[i], m.index, m.index + m[0].length),
      });
    }
  }
});

// ---------- 文単位の点検 ----------
// 見出し・箇条書き・表の行は文としての点検から外す。
const sentences = [];
lines.forEach((line, i) => {
  const t = line.trim();
  if (!t || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/.test(t)) return;
  const parts = t.match(/[^。！？!?]+[。！？!?」』）)]*/g) || [];
  for (const p of parts) {
    const s = p.trim();
    if (s) sentences.push({ text: s, line: i + 1 });
  }
});

const DESUMASU = /(です|ます|ました|でした|ません|でしょう|ましょう|ください|ございます|ございました)(か|ね|よ)?$/;
const DEARU = /(である|であった|であろう|だ|だった|だろう|ではない|のだ)$/;
const tail = (s) => s.replace(/[。！？!?」』）)\s]+$/, '');
let nDesu = 0, nDearu = 0;
const dearuLines = [], desuLines = [];
let prevKey = null, run = 0;
const conjWith = [], conjWithout = [];

for (const s of sentences) {
  const len = s.text.replace(/\s/g, '').length;
  if (len > maxLength) {
    findings.push({ level: 'check', rule: '長い文', line: s.line, match: `${len}字`,
      suggest: `目安 ${maxLength}字。分けられないか検討する`, context: s.text.slice(0, 30) + '…' });
  }
  const tens = (s.text.match(/[、，,]/g) || []).length;
  if (tens >= maxTen + 1) {
    findings.push({ level: 'check', rule: '読点が多い', line: s.line, match: `読点${tens}個`,
      suggest: '文を分けるか語順を変える（touten.md 3）', context: s.text.slice(0, 30) + '…' });
  }
  if (tens === 0 && len >= 60) {
    findings.push({ level: 'check', rule: '長い文に読点がない', line: s.line, match: `${len}字・読点0`,
      suggest: '区切りを検討する（touten.md 3）', context: s.text.slice(0, 30) + '…' });
  }
  if (!yomiage && len <= 20 && /^(私|僕|わたし|ぼく|彼|彼女|我々|私たち|弊社|当社)は、/.test(s.text)) {
    findings.push({ level: 'check', rule: '短い文の主語の後の読点', line: s.line, match: s.text.match(/^[^、]+、/)[0],
      suggest: '短い文なら読点は不要なことが多い（touten.md 2-1）', context: s.text });
  }
  const conj = s.text.match(/^(しかし|そして|ただし|さらに|なお|つまり|ところが|一方|だが|それでも|したがって|ですから|そのため)(、?)/);
  if (conj) (conj[2] ? conjWith : conjWithout).push({ line: s.line, word: conj[1] });
  const head = s.text.match(/^(なので|でも|だから|だけど|けど)/);
  if (head) {
    findings.push({ level: 'hin', rule: '文頭の話し言葉', line: s.line, match: head[0],
      suggest: '「そのため」「ですから」「しかし」「ただ」など', context: s.text.slice(0, 30) });
  }
  const t = tail(s.text);
  if (DESUMASU.test(t)) { nDesu++; desuLines.push(s.line); }
  else if (DEARU.test(t)) { nDearu++; dearuLines.push(s.line); }

  const key = t.slice(-2);
  if (key && key === prevKey) run++; else run = 1;
  prevKey = key;
  // 読み上げ原稿では丁寧な文末が続くのは自然なので、5回続いたときだけ指摘する（yomiage.md 6）。
  if (run === (yomiage ? 5 : 3)) {
    findings.push({ level: 'check', rule: '同じ文末の連続', line: s.line, match: `「${key}」が${run}回続く`,
      suggest: '文末に変化を付けるか、文をまとめる', context: s.text.slice(-30) });
  }
}

if (conjWith.length && conjWithout.length) {
  const minor = conjWith.length >= conjWithout.length ? conjWithout : conjWith;
  const style = minor === conjWith ? '読点あり' : '読点なし';
  findings.push({ level: 'check', rule: '文頭の接続詞の後の読点が不統一', line: minor[0].line,
    match: `読点あり${conjWith.length}・なし${conjWithout.length}`,
    suggest: `少ないほう（${style}：${minor.map((c) => `${c.line}行「${c.word}」`).slice(0, 6).join('、')}）を多いほうにそろえる`,
    context: '' });
}

if (nDesu > 0 && nDearu > 0) {
  const minority = nDesu >= nDearu ? { style: '常体', lines: dearuLines } : { style: '敬体', lines: desuLines };
  findings.push({ level: 'error', rule: '文体の混在', line: minority.lines[0],
    match: `敬体${nDesu}文・常体${nDearu}文`,
    suggest: `${minority.style}の文（${[...new Set(minority.lines)].slice(0, 8).join(', ')}行目）を多数派にそろえる。会話文や意図した切り替えは除く`,
    context: '' });
}

// ---------- 重複の除去 ----------
// 同じ行で範囲が重なる指摘は、重い層のものだけを残す。
const rank = { error: 0, hin: 1, hyoki: 2, check: 3 };
findings.sort((a, b) => a.line - b.line || rank[a.level] - rank[b.level] || (a.start ?? 0) - (b.start ?? 0));
const kept = [];
for (const f of findings) {
  const dup = f.start !== undefined && kept.some((k) => k.line === f.line && k.start !== undefined
    && k.start < f.end && f.start < k.end && rank[k.level] <= rank[f.level]);
  if (!dup) kept.push(f);
}

// ---------- 統計 ----------
const body = lines.join('\n');
const chars = body.replace(/\s/g, '');
const kanji = (chars.match(/[一-龠々]/g) || []).length;
const lens = sentences.map((s) => s.text.replace(/\s/g, '').length);
const longest = lens.length ? Math.max(...lens) : 0;
const stats = {
  characters: chars.length,
  sentences: sentences.length,
  averageSentenceLength: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
  longestSentence: longest,
  longestSentenceLine: lens.length ? sentences[lens.indexOf(longest)].line : null,
  kanjiRatio: chars.length ? Math.round((kanji / chars.length) * 100) : 0,
  style: nDesu && nDearu ? '混在' : nDesu ? '敬体' : nDearu ? '常体' : '判定できず',
  mode: yomiage ? '読み上げ原稿' : '目で読む文書',
};

// ---------- 出力 ----------
const names = { error: '誤り', hin: '品位', hyoki: '表記', check: '要確認' };
const count = (lv) => kept.filter((f) => f.level === lv).length;

if (asJson) {
  const out = kept.map(({ start, end, ...f }) => ({ ...f, level: names[f.level] }));
  console.log(JSON.stringify({ summary: Object.fromEntries(Object.keys(names).map((k) => [names[k], count(k)])), findings: out, stats }, null, 2));
} else {
  console.log(`kotonoha check${yomiage ? '（読み上げ原稿）' : ''} — 指摘 ${kept.length} 件（誤り ${count('error')}／品位 ${count('hin')}／表記 ${count('hyoki')}／要確認 ${count('check')}）`);
  console.log('※ 機械的な検出です。誤検出もあるため、文脈を見て判断してください。\n');
  for (const lv of Object.keys(names)) {
    const fs = kept.filter((f) => f.level === lv);
    if (!fs.length) continue;
    console.log(`【${names[lv]}】`);
    for (const f of fs) {
      const sug = f.suggest ? ` → ${f.suggest}` : '';
      console.log(`  ${String(f.line).padStart(4)}行  ${f.rule}「${f.match}」${sug}`);
      if (f.context) console.log(`        ${f.context}`);
    }
    console.log('');
  }
  console.log(`【統計】文字数 ${stats.characters}／文 ${stats.sentences}／平均 ${stats.averageSentenceLength}字／最長 ${stats.longestSentence}字` +
    (stats.longestSentenceLine ? `（${stats.longestSentenceLine}行）` : '') + `／漢字 ${stats.kanjiRatio}%／文体 ${stats.style}`);
}
