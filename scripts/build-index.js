#!/usr/bin/env node
// 扫描 nfo/ 目录，解析每个 NFO 的 title，生成 index.json 供 App 匹配名称。
// 用法: node scripts/build-index.js
// 可选环境变量: REPO / BRANCH / DIR / TOKEN

const fs = require('fs');
const path = require('path');

const REPO = process.env.REPO || 'dstudyb/Introduction';
const BRANCH = process.env.BRANCH || 'main';
const DIR = process.env.DIR || 'nfo';
const TOKEN = process.env.TOKEN || '';

const API = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const ROOT = path.join(__dirname, '..');
const LOCAL_DIR = path.join(ROOT, DIR);

const headers = { 'User-Agent': 'build-index', Accept: 'application/vnd.github+json' };
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

// 归一化名称用于 App 匹配：全角转半角、去大小写、去空格与常见标点
function normalize(s) {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.·・:：!！?？,，.。、'"“”‘’()（）\[\]【】]/g, '');
}

function pick(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

// 返回仓库内的相对路径数组，如 ['nfo/xxx.nfo']
async function listLocal() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.nfo')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  walk(LOCAL_DIR);
  return out;
}

async function listRemote() {
  const res = await fetch(`${API}/git/trees/${BRANCH}?recursive=1`, { headers });
  if (!res.ok) throw new Error(`列出文件失败: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.tree
    .filter((t) => t.type === 'blob')
    .map((t) => t.path)
    .filter((p) => p.toLowerCase().endsWith('.nfo') && (!DIR || p.startsWith(DIR + '/')));
}

async function readFile(rel, local) {
  if (local) return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const res = await fetch(RAW + encodeURI(rel), { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

async function build() {
  const local = fs.existsSync(LOCAL_DIR);
  const files = local ? await listLocal() : await listRemote();
  console.log(`发现 ${files.length} 个 NFO 文件 (${local ? '本地' : '远程'})`);

  const items = [];
  for (const file of files) {
    let xml;
    try {
      xml = await readFile(file, local);
    } catch (e) {
      console.warn(`跳过 ${file}: ${e.message}`);
      continue;
    }
    const title = pick(xml, 'title');
    const originaltitle = pick(xml, 'originaltitle');
    const names = [title, originaltitle].filter(Boolean);

    items.push({
      id: path.basename(file, '.nfo'),
      file,
      url: RAW + encodeURI(file),
      title,
      originaltitle,
      year: pick(xml, 'year'),
      premiered: pick(xml, 'premiered'),
      keys: [...new Set(names.map(normalize).filter(Boolean))],
    });
  }

  items.sort((a, b) => (a.premiered < b.premiered ? 1 : a.premiered > b.premiered ? -1 : 0));

  const index = {
    updated: new Date().toISOString().slice(0, 10),
    count: items.length,
    base: RAW + (DIR ? DIR + '/' : ''),
    items,
  };

  fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`已写入 index.json，共 ${items.length} 条`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
