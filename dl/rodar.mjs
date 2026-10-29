// MATE · DL e DE (roda no GitHub Actions)
// 1. Lê as edições recentes do Diário do Legislativo (PDF), separa por seção/página como na planilha
//    e confere no MATE se cada proposição tem o "Publicado no DL em <data>".
// 2. Lê as leis publicadas no Diário do Executivo (API de legislação) e confere o
//    "Lei N publicada no Diário do Executivo em <data>" na proposição de origem.
// Saída: dados/dl/<id>.json, dados/de/<data>.json e dados/indice.json (servidos pelo GitHub Pages).
import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extrairDL, refs, refsErrata } from "./extrair.js";

const API = "https://dadosabertos.almg.gov.br/api/v2";
const VERSAO = 16;                 // muda quando a extração muda: reprocessa as edições
const JANELA = 14;                // dias para trás
const CARENCIA = 2;               // dias úteis
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR_DL = path.join(RAIZ, "dados", "dl"), DIR_DE = path.join(RAIZ, "dados", "de"), DIR_PZ = path.join(RAIZ, "dados", "prazo");
for (const d of [DIR_DL, DIR_DE, DIR_PZ]) fs.mkdirSync(d, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ultimo = 0;
// ponte pelo worker da Cloudflare: usada quando a ALMG recusa a conexão vinda do GitHub
const PONTE = "https://mate.diogocascimiro.workers.dev";
let viaPonte = false;
async function api(p){
  const w = ultimo + 1100 - Date.now(); if (w > 0) await sleep(w);
  ultimo = Date.now();
  for (let t = 0; t < 6; t++) {
    try {
      const r = await fetch(viaPonte ? PONTE + "/api/almg?p=" + encodeURIComponent(p) : API + p, { headers: { Accept: "application/json", "User-Agent": "almg.digital-mate/1.0" } });
      ultimo = Date.now();
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { if (t === 5) throw e; if (!viaPonte && t >= 1) { viaPonte = true; console.log("ALMG sem resposta direta: usando a ponte pela Cloudflare"); continue; } await sleep(10000 * (t + 1)); }
  }
}
const brHoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const ymd = d => d.toISOString().slice(0, 10);
const compact = s => s.replace(/-/g, "");
function uteisDesde(data){
  const d = new Date(data + "T12:00:00Z"), h = new Date(brHoje() + "T12:00:00Z"); let n = 0;
  while (d < h) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w > 0 && w < 6) n++; }
  return n;
}
const lerJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } };
const gravar = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1));

// ---------- PDF → linhas {p, t, b} ----------
async function linhasPDF(url){
  let r = null;
  if (!viaPonte) { try { r = await fetch(url); } catch (e) { viaPonte = true; } }
  if (viaPonte) r = await fetch(PONTE + "/api/almgpdf?u=" + encodeURIComponent(url));
  if (!r.ok) throw new Error("PDF " + r.status);
  const data = new Uint8Array(await r.arrayBuffer());
  const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    await pg.getOperatorList();                       // carrega as fontes (para saber o que é negrito)
    const c = await pg.getTextContent();
    const negrito = {};
    for (const x of c.items) if (x.fontName && !(x.fontName in negrito)) { let n = ""; try { n = pg.commonObjs.get(x.fontName).name || ""; } catch {} negrito[x.fontName] = /bold|black|heavy/i.test(n); }
    let cur = "", b = 0, tot = 0;
    for (const x of c.items) {
      cur += x.str; const n = x.str.trim().length; tot += n; if (negrito[x.fontName]) b += n;
      if (x.hasEOL) { if (cur.trim()) out.push({ p: i, t: cur.trim(), b: tot ? b / tot : 0 }); cur = ""; b = 0; tot = 0; }
    }
    if (cur.trim()) out.push({ p: i, t: cur.trim(), b: tot ? b / tot : 0 });
    pg.cleanup();
  }
  await doc.destroy();
  return out;
}

// ---------- histórico no MATE (cache por rodada) ----------
const cacheHist = new Map();
async function historico(prop){
  if (cacheHist.has(prop)) return cacheHist.get(prop);
  const [tipo, na] = prop.split(" "); const [num, ano] = na.split("/");
  let h = null;
  try { const j = await api(`/proposicoes/${encodeURIComponent(tipo)}/${num}/${ano}`); const o = j && j.resultado && j.resultado.listaItem && j.resultado.listaItem[0]; h = o ? (o.listaHistoricoTramitacoes || []) : null; }
  catch (e) { h = undefined; }
  cacheHist.set(prop, h); return h;
}
const dataRx = d => { const [y, m, dd] = d.split("-"); return `0?${+dd}[\\/ .]0?${+m}[\\/ .]${y}`; };

function avaliar(data, hist, rx, carenciaTxt){
  if (hist === undefined) return null;                      // erro de rede: tenta de novo depois
  if (hist === null) return { status: uteisDesde(data) <= CARENCIA ? "aguardando" : "nao_cadastrada", mate: "" };
  for (const h of hist) {
    const txt = String(h.historico || "").replace(/\s+/g, " ");
    const m = txt.match(rx);
    if (m) return { status: "ok", mate: m[0] };
  }
  return { status: uteisDesde(data) <= CARENCIA ? "aguardando" : "pendente", mate: "" };
}

// ---------- erratas: a proposição está na matéria corrigida (edição/página citadas no texto) ----------
const normT = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const cachePDF = new Map();
async function paginasEdicao(data, pag){
  if (!cachePDF.has(data)) {
    const out = [];
    try {
      const j = await api(`/diario_legislativo/pesquisa?ini=${compact(data)}&fim=${compact(data)}&tp=20&p=1`);
      for (const x of ((j && j.list && j.list.lista) || [])) { try { out.push(...(await linhasPDF(x.url))); } catch {} }
    } catch {}
    cachePDF.set(data, out);
  }
  return cachePDF.get(data).filter(l => l.p >= pag && l.p <= pag + 1);
}
async function propsErrata(g){
  for (const e of g.erratas || []) {
    // título, trecho acrescentado entre aspas ou texto da errata (ver refsErrata); sem número, vai à página corrigida
    const diretos = refsErrata(e);
    if (diretos.length) { for (const r of diretos) if (!g.props.some(p => p.prop === r)) g.props.push({ prop: r, pag: e.pag }); continue; }
    const achados = new Set();
    const chave = normT(e.titulo).slice(0, 45);
    for (const m of e.texto.matchAll(/edi[cç][aã]o de (\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(?:na\s+)?p[áa]gs?\.?\s*(\d+)/gi)) {
      const data = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      const ls = await paginasEdicao(data, +m[4]);
      for (let i = 0; i < ls.length; i++) {
        if (!(ls[i].b > 0.8) || !chave || !normT(ls[i].t + " " + (ls[i + 1] ? ls[i + 1].t : "")).startsWith(chave.slice(0, 30))) continue;
        let txt = ""; for (let j = i; j < ls.length && j < i + 60; j++) { if (j > i + 2 && ls[j].b > 0.8 && /^ERRATAS?$/.test(ls[j].t)) break; txt += " " + ls[j].t; }
        // o que foi acrescentado/corrigido vem entre aspas: “nº 3.670/2023, do deputado ...”
        const cit = [...txt.matchAll(/[“"]([^”"]{5,})[”"]/g)].map(x => x[1]).join(" ; ");
        const base = /COMISS/.test(chave) ? "RQC" : null;
        for (const r of (cit ? refs(cit, !!base, false, base) : refs(txt, !!base))) achados.add(r);
      }
    }
    for (const r of achados) if (!g.props.some(p => p.prop === r)) g.props.push({ prop: r, pag: e.pag });
  }
}

// ---------- preclusão de prazo (art. 104): requerimentos aprovados conclusivamente na Comunicação da Presidência ----------
function somaUteis(data, n){ const d = new Date(data + "T12:00:00Z"); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w > 0 && w < 6) n--; } return ymd(d); }
async function rodarPrazos(){
  const resumo = [];
  for (const f of fs.readdirSync(DIR_DL)) {
    const ed = lerJSON(path.join(DIR_DL, f), null); if (!ed) continue;
    const props = []; for (const g of ed.grupos) if (/^COMUNICA[CÇ][AÃ]O DA PRESID/i.test(g.desc)) for (const p of g.props) if (/^RQN /.test(p.prop)) props.push(p.prop);
    if (!props.length) continue;
    const alvo = somaUteis(ed.data, 3);
    const arq = path.join(DIR_PZ, ed.id + ".json");
    const ant = lerJSON(arq, { grupos: [{ props: [] }] }); const antigo = new Map(ant.grupos[0].props.map(p => [p.prop, p]));
    const [y, m, d] = ed.data.split("-");
    const grupo = { desc: "PRECLUSÃO DE PRAZO: REQUERIMENTOS, APROVADOS", pag: `${d}/${m}/${y}`, props: props.map(p => antigo.get(p) || { prop: p, status: "novo", mate: "" }) };
    for (const p of grupo.props) {
      if (p.status === "ok") continue;
      if (brHoje() < alvo) { p.status = "aguardando"; continue; }
      const h = await historico(p.prop); if (h === undefined) continue;
      const x = (h || []).find(x => x.data >= ed.data && /encerrado o prazo do artigo 104/i.test(String(x.historico || "")));
      p.status = x ? "ok" : h === null ? "nao_cadastrada" : uteisDesde(alvo) <= CARENCIA ? "aguardando" : "pendente";
      p.mate = x ? String(x.historico).replace(/\s+/g, " ").match(/Encerrado o prazo[^.]*\./i)[0] : "";
    }
    gravar(arq, { data: alvo, referencia: ed.data, grupos: [grupo], conferido_em: new Date().toISOString() });
    resumo.push({ fonte: "PRAZO", id: ed.id, data: alvo, arquivo: "dados/prazo/" + ed.id + ".json", contagem: contar([grupo]) });
  }
  return resumo;
}

// ---------- Diário do Legislativo ----------
async function edicoesDL(){
  const fim = new Date(Date.now() - 3 * 3600e3), ini = new Date(fim.getTime() - JANELA * 864e5);
  const lista = [];
  for (let p = 1; p <= 5; p++) {
    const j = await api(`/diario_legislativo/pesquisa?ini=${compact(ymd(ini))}&fim=${compact(ymd(fim))}&tp=20&p=${p}`);
    const l = (j && j.list) || {};
    for (const x of l.lista || []) lista.push({ id: String(x.id), data: x.metadados.data, url: x.url, obs: x.metadados.observacao || "" });
    if (!l.totalPaginas || p >= l.totalPaginas) break;
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
}

async function rodarDL(){
  const eds = await edicoesDL();
  const resumo = [];
  for (const e of eds) {
    const f = path.join(DIR_DL, e.id + ".json");
    let ed = lerJSON(f, null);
    if (!ed || ed.versao !== VERSAO) {
      try {
        const linhas = await linhasPDF(e.url);
        const grupos = extrairDL(linhas);
        for (const g of grupos) if (g.erratas) await propsErrata(g);
        const antigo = new Map(); if (ed) for (const g of ed.grupos) for (const p of g.props) antigo.set(p.prop, p);
        for (const g of grupos) g.props = g.props.map(p => { const a = antigo.get(p.prop); return a && a.status === "ok" ? { ...p, status: "ok", mate: a.mate } : { ...p, status: "novo", mate: "" }; });
        ed = { versao: VERSAO, id: e.id, data: e.data, url: e.url, obs: e.obs, paginas: linhas.length ? linhas[linhas.length - 1].p : 0, extraido_em: new Date().toISOString(), grupos };
      } catch (err) { console.log("falha no PDF", e.id, err.message); continue; }
    }
    // conferência: "Publicado(a) no DL em <data>"
    const rx = new RegExp(`publicad[oa]s?(\\s+na\\s+[íi]ntegra[^.]{0,80}?,)?\\s+no\\s+DL\\s+em\\s+${dataRx(e.data)}(,?\\s*p[áa]gs?\\.?\\s*[\\d, e-]+)?`, "i");
    for (const g of ed.grupos) for (const p of g.props) {
      if (p.status === "ok") continue;
      if (/^PROPLEI /.test(p.prop)) {   // Proposição de Lei: o lançamento vai no projeto de origem
        const n = p.prop.split(" ")[1];
        let o = null;
        try { const j = await api(`/proposicoes/pesquisa/avancada?tp=5&p=1&expr=${encodeURIComponent("Proposição de Lei " + n)}`); o = ((j && j.resultado && j.resultado.listaItem) || []).find(o => (o.listaHistoricoTramitacoes || []).some(h => new RegExp("Proposi[cç][aã]o de Lei " + n + "\\b").test(h.historico || ""))); } catch {}
        if (!o) { p.status = uteisDesde(e.data) <= CARENCIA ? "aguardando" : "revisar"; continue; }
        p.origem = "Proposição de Lei " + n; p.prop = o.siglaTipoProjeto + " " + o.numero + "/" + o.ano;
        cacheHist.set(p.prop, o.listaHistoricoTramitacoes || []);
      }
      const h = await historico(p.prop);
      const a = avaliar(e.data, h, rx);
      if (a) { p.status = a.status; p.mate = a.mate; }
    }
    ed.conferido_em = new Date().toISOString();
    gravar(f, ed);
    resumo.push({ fonte: "DL", id: e.id, data: e.data, url: e.url, obs: e.obs, arquivo: "dados/dl/" + e.id + ".json", contagem: contar(ed.grupos) });
  }
  return resumo;
}

// ---------- Diário do Executivo (leis sancionadas) ----------
async function rodarDE(){
  const ini = ymd(new Date(Date.now() - 3 * 3600e3 - JANELA * 864e5));
  const porData = new Map();
  for (const tipo of ["LEI", "LCP", "EMC"]) {
    const ano = brHoje().slice(0, 4);
    const j = await api(`/legislacao/mineira/pesquisa/direcionada?tp=50&p=1&tipo=${tipo}&ano=${ano}`);
    for (const x of (j && j.resultado && j.resultado.listaItem) || []) {
      const m = String(x.fonte || "").replace(/<[^>]+>/g, "").match(/Di[áa]rio do Executivo\s*-\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s*P[áa]g\.\s*(\d+))?/i);
      if (!m) continue;
      const data = `${m[3]}-${m[2]}-${m[1]}`; if (data < ini) continue;
      const desc = tipo === "LCP" ? "LEI COMPLEMENTAR" : tipo === "EMC" ? "EMENDA À CONSTITUIÇÃO" : "LEIS";
      if (!porData.has(data)) porData.set(data, new Map());
      const g = porData.get(data); if (!g.has(desc)) g.set(desc, { desc, pags: new Set(), props: [] });
      const gg = g.get(desc); if (m[4]) gg.pags.add(+m[4]);
      gg.props.push({ prop: tipo + " " + x.numero + "/" + x.ano, pag: m[4] ? +m[4] : null, norma: x.norma });
    }
  }
  const resumo = [];
  for (const [data, g] of porData) {
    const f = path.join(DIR_DE, data + ".json");
    const ant = lerJSON(f, { grupos: [] }); const antigo = new Map(); for (const gg of ant.grupos) for (const p of gg.props) antigo.set(p.prop, p);
    const grupos = [...g.values()].map(gg => { const ps = [...gg.pags].sort((a, b) => a - b); return { desc: gg.desc, pag: ps.length ? (ps[0] === ps[ps.length - 1] ? String(ps[0]) : ps[0] + " - " + ps[ps.length - 1]) : "", props: gg.props.map(p => antigo.get(p.prop) && antigo.get(p.prop).status === "ok" ? antigo.get(p.prop) : { ...p, status: "novo", mate: "", origem: (antigo.get(p.prop) || {}).origem || "" }) }; });
    for (const gg of grupos) for (const p of gg.props) {
      if (p.status === "ok") continue;
      const [tp, na] = p.prop.split(" "); const [num, ano] = na.split("/");
      const rx = new RegExp(`(Lei|Lei Complementar|Emenda à Constituição)\\s+(n[º°.]\\s*)?${num}\\s+publicada\\s+no\\s+Di[áa]rio\\s+do\\s+Executivo\\s+em\\s+${dataRx(data)}`, "i");
      // proposição de origem: pesquisa pelo número da norma e confirma no histórico
      let achou = null, existe = false;
      const cands = p.origem ? [p.origem] : [];
      if (!cands.length) {
        try { const j = await api(`/proposicoes/pesquisa/avancada?tp=10&p=1&expr=${encodeURIComponent((tp === "LCP" ? "Lei Complementar " : tp === "EMC" ? "Emenda à Constituição " : "Lei ") + num)}`); for (const it of (j && j.resultado && j.resultado.listaItem) || []) cands.push(it.siglaTipoProjeto + " " + it.numero + "/" + it.ano); } catch {}
      }
      for (const c of cands.slice(0, 5)) {
        const h = await historico(c); if (!h) continue;
        for (const x of h) {
          const txt = String(x.historico || "").replace(/\s+/g, " ");
          if (new RegExp(`\\b${num}\\b`).test(txt) && /sancionad|publicada no Di[áa]rio do Executivo/i.test(txt)) existe = true, p.origem = c;
          const m = txt.match(rx); if (m) { achou = m[0]; p.origem = c; break; }
        }
        if (achou) break;
      }
      p.status = achou ? "ok" : uteisDesde(data) <= CARENCIA ? "aguardando" : "pendente";
      p.mate = achou || "";
    }
    gravar(f, { data, grupos, conferido_em: new Date().toISOString() });
    resumo.push({ fonte: "DE", data, arquivo: "dados/de/" + data + ".json", contagem: contar(grupos) });
  }
  return resumo;
}

function contar(grupos){ const c = {}; for (const g of grupos) for (const p of g.props) c[p.status] = (c[p.status] || 0) + 1; return c; }

const t0 = Date.now();
const dl = await rodarDL();
let de = [];
try { de = await rodarDE(); } catch (e) { console.log("DE falhou:", e.message); }
let pz = [];
try { pz = await rodarPrazos(); } catch (e) { console.log("prazos falhou:", e.message); }
const anterior = lerJSON(path.join(RAIZ, "dados", "indice.json"), { edicoes: [] });
const mapa = new Map(anterior.edicoes.map(x => [x.arquivo, x]));
for (const x of [...dl, ...de, ...pz]) mapa.set(x.arquivo, x);
const limite = ymd(new Date(Date.now() - 60 * 864e5));
const edicoes = [...mapa.values()].filter(x => x.data >= limite).sort((a, b) => b.data.localeCompare(a.data));
gravar(path.join(RAIZ, "dados", "indice.json"), { atualizado_em: new Date().toISOString(), edicoes });
console.log("ok", dl.length, "edições DL,", de.length, "datas DE,", Math.round((Date.now() - t0) / 1000) + "s");
