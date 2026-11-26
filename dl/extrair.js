// Extração do Diário do Legislativo (texto do PDF em linhas {p, t, b}: página, texto, fração em negrito)
// Saída: grupos no formato da planilha: { desc, pag: "a - b", props: [{prop, pag}] }
const TIPOS = [
  [/^projetos? de lei complementar/i, "PLC"],
  [/^projetos? de lei/i, "PL"],
  [/^projetos? de resolu[cç][aã]o/i, "PRE"],
  [/^propostas? de emenda [aà] constitui[cç][aã]o/i, "PEC"],
  [/^requerimentos? de comiss[aã]o/i, "RQC"],
  [/^requerimentos?/i, "RQN"],
  [/^mensage(m|ns)/i, "MSG"],
  [/^vetos?/i, "VET"],
  [/^indica[cç](ão|ao|ões|oes)/i, "IND"],
  [/^relat[oó]rios? de evento institucional/i, "REL"],
];
const QUEBRA = /^(emendas?|substitutivos?|of[ií]cios?|leis?|decretos?|resolu[cç](ão|ões)|pareceres?|atas?|portarias?|deliberaç(ão|ões)|editais?|avulsos?|subemendas?|artigos?|art\.|incisos?|processos?|contratos?|convênios?|reuni(ão|ões)|termos?)$/i;
const KW = /(relat[oó]rios? de evento institucional|projetos? de lei complementar|projetos? de lei|projetos? de resolu[cç][aã]o|propostas? de emenda [aà] constitui[cç][aã]o|requerimentos? de comiss[aã]o|requerimentos?|mensage(?:m|ns)|vetos?|indica[cç](?:ão|ao|ões|oes)|emendas?|subemendas?|substitutivos?|of[ií]cios?|leis?|leis complementares|lei complementar|decretos?|resolu[cç](?:ão|ões)|pareceres?|deliberaç(?:ão|ões)|portarias?|atos?|avisos?|processos?)\s*:?\s*$/i;
function tipoDe(palavra){
  if (QUEBRA.test(palavra) || /^(leis? complementar(es)?|portarias?|atos?|avisos?|processos?)$/i.test(palavra)) return null;
  for (const [rx, sg] of TIPOS) if (rx.test(palavra)) return sg;
  return null;
}
export function refs(texto, forcarRQC, comPos, tipoBase){
  const out = [], anteriores = new Set();
  texto = String(texto).replace(/\bn[º°]s?\s+(?=n[º°])/gi, "");   // "nº nº 3.734/2023"
  const rn0 = /\bn[º°]s?\.?\s*(?=\d)/gi;
  let m, tipo = tipoBase || null;
  const pos = []; while ((m = rn0.exec(texto))) pos.push([m.index, rn0.lastIndex]);
  for (let q = 0; q < pos.length; q++) {
    const [ini, i] = pos[q];
    const antes = texto.slice(Math.max(0, ini - 70), ini);
    const kw = antes.match(KW);
    // "na forma do Substitutivo nº 1, 4.695/2025, do deputado ...": o nº da emenda/substitutivo não interrompe a lista de projetos;
    // os números com ano que vêm depois dele continuam sendo do tipo da lista
    let emendaNaLista = false;
    if (kw && /^(sub)?emendas?$|^substitutivos?$/i.test(kw[1].trim()) && tipo) emendaNaLista = true;
    else if (kw) tipo = tipoDe(kw[1]);
    else if (!/([;:.()]|[;,]\s*e)\s*[–-]?\s*$/.test(antes) && antes.trim()) tipo = null;   // item de lista também termina em "; e"
    else if (tipoBase && (!tipo || /;\s*(e\s*)?$/.test(antes))) tipo = tipoBase;   // lista ("...; nº 23.409/2026, ..."): cada item volta ao tipo da lista, mesmo depois de "Projeto de Lei nº ..." citado no item anterior
    // ata de comissão: correspondência "prestando informações relativas ao Requerimento nº ..." só cita requerimento antigo (não é RQC a lançar)
    // idem para "voto de congratulações formulado em atenção ao Requerimento nº ..." e "de que trata o Requerimento nº ..."
    if (forcarRQC && /\b(relativ[ao]s?|referentes?|em resposta|em atenção|de que trata)\s+(a|ao|aos|à|às|o|os)\s+requerimentos?(\s+em\s+comiss[aã]o)?\s*$/i.test(antes)) { tipo = null; continue; }
    // "medidas solicitadas por meio do Requerimento nº 19.908/2026", "objeto do Requerimento nº ...": requerimento antigo citado no texto do RQC
    if (forcarRQC && /\b(por\s+meio|atrav[ée]s|objeto|nos\s+termos|aprovad[oa]s?\s+por\s+meio)\s+d[oa]s?\s+requerimentos?(\s+de\s+comiss[aã]o)?\s*$/i.test(antes)) { tipo = null; continue; }
    // "Submetido a votação, é aprovado o Requerimento nº 19.572/2026" (2ª Fase, dispensa o Plenário): é RQN, como no plural
    const rqnVotado = /(?:^|\s)(é|foi)\s+aprovad[oa]\s+o\s+requerimento\s*$/i.test(antes);
    let t = tipo; if (t === "RQN" && forcarRQC && !rqnVotado && !(kw && /^requerimentos$/i.test(kw[1].trim()) && /n[º°]s/i.test(texto.slice(ini, i)))) t = "RQC";   // "aprovados os Requerimentos nºs 19.294, ... e 19.401/2026" na ata de comissão: são RQN (dispensam o Plenário)
    const prox = q + 1 < pos.length ? pos[q + 1][0] : texto.length;
    const pv = texto.indexOf(";", i);
    const fim = Math.min(prox, pv < 0 ? texto.length : pv);
    let trecho = texto.slice(i, fim), desloc = 0;
    if (emendaNaLista) { const mm = trecho.match(/^\s*\d{1,4}(?![\d.\/])(?:\s*(?:,|e|a)\s*\d{1,4}(?![\d.\/]))*/); if (mm) { desloc = mm[0].length; trecho = trecho.slice(desloc); } }
    const rn = /(\d{1,3}(?:\.\d{3})+|\d{1,5})(?:\/((?:19|20)\d\d)(?!\d))?/g; let k, pend = [], achados = [], ultimo = 0;
    while ((k = rn.exec(trecho))) {
      const antesC = trecho[k.index - 1], depois = trecho.slice(rn.lastIndex, rn.lastIndex + 3);
      if (antesC === "/" || antesC === "-" || /^\/\d/.test(depois) || /^[ªº°\-]/.test(depois)) { pend = []; continue; }
      const n = parseInt(k[1].replace(/\./g, ""), 10);
      const entre = trecho.slice(Math.max(0, k.index - 4), k.index);
      if (/\sa\s+$/.test(entre) && pend.length) { const ini2 = pend[pend.length - 1]; if (n > ini2 && n - ini2 <= 600) for (let x = ini2 + 1; x < n; x++) pend.push(x); }
      pend.push(n);
      if (k[2]) { for (const x of pend) achados.push({ n: String(x), ano: k[2], idx: i + desloc + k.index }); pend = []; ultimo = rn.lastIndex; }
    }
    if (!t || !achados.length) continue;
    if (/^[\s,.]*(e\s+[\d.]+\/\d{4}\s*)?(foram|foi)\s+publicad|^[^.;]{0,40}publicad[oa]s?\s+na\s+edi[cç][aã]o\s+anterior/i.test(trecho.slice(ultimo))) {
      // "PROJETO DE LEI COMPLEMENTAR Nº 113/2026 – O Projeto de Lei Complementar nº 113/2026 foi publicado na edição anterior.":
      // só a leitura em Plenário; o lançamento é na edição anterior. O título (citação anterior) também sai.
      for (const a of achados) anteriores.add(t + " " + a.n + "/" + a.ano);
      continue;
    }
    for (const a of achados) { const prop = t + " " + a.n + "/" + a.ano; out.push(comPos ? { prop, idx: a.idx } : prop); }
  }
  return anteriores.size ? out.filter(o => !anteriores.has(comPos ? o.prop : o)) : out;
}
const TIPO_TITULO = s => /^REQUERIMENTOS? DE COMISS/.test(s) ? "RQC" : /^REQUERIMENTO/.test(s) ? "RQN" : /^PROJETOS? DE LEI COMPLEMENTAR/.test(s) ? "PLC" : /^PROJETOS? DE LEI/.test(s) ? "PL" : /^PROJETOS? DE RESOLU/.test(s) ? "PRE" : /^PROPOSTAS? DE EMENDA/.test(s) ? "PEC" : /^MENSAGE/.test(s) ? "MSG" : /^VETO/.test(s) ? "VET" : null;
function classeRQ(item){
  const k = Math.max(item.lastIndexOf("(–"), item.lastIndexOf("(-"), item.lastIndexOf("( –"));
  const desp = k >= 0 ? item.slice(k) : "";
  if (/anexe-se/i.test(desp) || /anexe-se ao/i.test(item)) return "ANEXADOS";
  if (/[àa]s? comiss/i.test(desp)) return "COMISSÕES TEMÁTICAS";
  if (/mesa da assembleia/i.test(desp)) return /provid[eê]ncia interna/i.test(desp) ? "MESA DA ASSEMBLEIA, ENCAMINHADOS PARA PROVIDÊNCIA INTERNA" : "MESA DA ASSEMBLEIA, VOTADO EM PLENÁRIO";
  if (/retirada de tramita/i.test(item)) return "SEM DESPACHO, RETIRADA DE TRAMITAÇÃO";
  if (/reuni[aã]o especial/i.test(item)) return "SEM DESPACHO, REUNIÃO ESPECIAL";
  if (/desarquiv/i.test(item)) return "SEM DESPACHO, DESARQUIVAMENTO";
  if (/cidad[aã]o honor|cidadania honor/i.test(item)) return "CIDADANIA HONORÁRIA";
  return "SEM DESPACHO, COM COMUNICAÇÃO";
}
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const TOPO = /^(ATAS|MAT[EÉ]RIA DE REUNI[AÃ]O D[OE] PLEN[AÁ]RIO|PARECERES|PARECERES SOBRE VETOS?|TRAMITA[CÇ][AÃ]O DE PROPOSI[CÇ][OÕ]ES|CORRESPOND[EÊ]NCIA DESPACHADA PELO 1[ºo°]-SECRET[AÁ]RIO|ERRATAS?|MAT[EÉ]RIA ADMINISTRATIVA|EDITAIS DE CONVOCA[CÇ][AÃ]O|ORDENS? DO DIA|LEIS PROMULGADAS|PROPOSI[CÇ][OÕ]ES DE LEI|RESOLU[CÇ][AÃ]O|RESOLU[CÇ][OÕ]ES|MANIFESTA[CÇ][OÕ]ES|PRONUNCIAMENTOS|COMUNICA[CÇ][OÕ]ES DESPACHADAS PELO PRESIDENTE|DECIS[AÃ]O DA PRESID[EÊ]NCIA|ACORDO DE L[IÍ]DERES|COMUNICA[CÇ][AÃ]O DA PRESID[EÊ]NCIA|EMENDAS? OU SUBSTITUTIVOS? PUBLICADOS|EMENDAS N[AÃ]O RECEBIDAS PUBLICADAS|VOTA[CÇ][OÕ]ES NOMINAIS|PROPOSI[CÇ][OÕ]ES N[AÃ]O RECEBIDAS|ORDEM DO DIA|LEIS)$/;
const IGNORA_TOPO = /^(MAT[EÉ]RIA ADMINISTRATIVA|MAT[EÉ]RIA VOTADA|ASSEMBLEIA FISCALIZA|EDITAIS DE CONVOCA|ORDENS? DO DIA|ORDEM DO DIA|PRONUNCIAMENTOS|MESA DA ASSEMBLEIA|SUM[AÁ]RIO)/;
const IGNORA_SUB = /^(Comparecimento|Abertura|Atas|Encerramento|Quest(ão|ões) de Ordem|Falta de Qu[oó]rum|Abertura de Inscri|1ª Parte|2ª Parte|1ª Fase|2ª Fase|3ª Fase|Presid[eê]ncia d|Oradores Inscritos|Registro de Presen|Interrup|Suspens|Inexist[eê]ncia de Qu[oó]rum|Comunica[cç][oõ]es$|Discuss[aã]o e Vota[cç][aã]o de Pareceres$)/i;
const SUB_NOME = s => norm(s);
const ATA_SUB = /^(Atas|Correspond[eê]ncia|Apresenta[cç][aã]o de Proposi[cç][oõ]es|Recebimento de Proposi[cç][oõ]es|Palavras d[ao] President[ea]|Comunica[cç](ão|ões) da Presid[eê]ncia|Leitura de Comunica[cç][oõ]es|Designa[cç][aã]o de Comiss(ão|ões)|Decis(ão|ões) da Presid[eê]ncia|Despacho de Requerimentos?|Vota[cç][aã]o de Requerimentos?|Acordo de L[ií]deres|Quest(ão|ões) de Ordem|Comunica[cç][oõ]es|Discuss[aã]o e Vota[cç][aã]o d|Mat[eé]ria Votada|Vota[cç](ão|ões) Nomina|Homenagem P[oó]stuma|Declara[cç](ão|ões) de Voto|Encerramento|Comparecimento|Abertura|[123]ª (Parte|Fase)|Ordem do Dia|Inexist[eê]ncia de Qu[oó]rum|Falta de Qu[oó]rum|Oradores Inscritos|Registro de Presen|Suspens|Reabertura|Interrup|Prorroga|Leitura e Aprova|Requerimentos?$|Pronunciamentos|Questão de Ordem|Recebimento de Correspond|Pareceres|Recebimento|Vota[cç][aã]o|Elei[cç][aã]o)/i;
const IGNORA_SUB2 = /^(Discuss[aã]o e Vota[cç][aã]o d|Mat[eé]ria Votada|Homenagem P[oó]stuma|Declara[cç](ão|ões) de Voto|Pronunciamentos|Elei[cç][aã]o)/i;
// proposição de uma errata: a do título (epígrafe); senão, a do trecho acrescentado entre aspas
// (“nº 12.465/2025, do deputado ...”: em ata de comissão é RQC); senão, a do texto.
// O número citado em "onde se lê" é o errado, e "logo após o resumo do Requerimento nº X" é só referência.
export function refsErrata(e){
  const tit = refs(e.titulo);
  if (tit.length) {
    // "onde se lê: “Anexe-se ao Projeto de Lei nº 2.864/2024”, leia-se: “Anexe-se ao Projeto de Lei nº 2.865/2024”": o principal correto também recebe lançamento
    const ls = [...String(e.texto).matchAll(/leia-se\s*:?\s*[“"]([^”"]*anexe-se[^”"]*)[”"]/gi)].map(x => x[1]).join(" ; ");
    for (const r of (ls ? refs(ls) : [])) if (!tit.includes(r)) tit.push(r);
    return tit;
  }
  const txt = e.texto.replace(/onde se l[eê]\s*:?\s*[“"][^”"]*[”"]/gi, " ");
  const base = /COMISS/i.test(e.titulo) ? "RQC" : null;
  const cit = [...txt.matchAll(/[“"]([^”"]{5,})[”"]/g)].map(x => x[1]).join(" ; ");
  const rc = cit ? refs(cit, !!base, false, base) : [];
  return rc.length ? rc : refs(txt.replace(/ap[óo]s o resumo d[oa] [^,.;]*?n[º°]\s*[\d.]+\/\d{4}/gi, " "), !!base, false, base);
}

// Votações nominais na ata de Plenário: "Em votação, o projeto. – Procede-se à votação por meio eletrônico. ... Votaram “sim” N ..."
// Cada proposição votada nominalmente recebe "Votação Nominal publicada no DL em <data>, pág N" (manual GGA 4.12).
// Votação tornada sem efeito por falta de quórum não entra. Requerimentos incidentais (retirada de pauta, adiamento...) não entram (4.12.1).
const ITEM_PLEN = /(?:Discuss[aã]o|Vota[cç][aã]o),\s+em\s+(?:turno\s+[úu]nico|[12][ºo°]\s+turno|reda[cç][aã]o\s+final),\s+d[oa]s?\s+(Projeto\s+de\s+Lei\s+Complementar|Projeto\s+de\s+Lei|Projeto\s+de\s+Resolu[cç][aã]o|Proposta\s+de\s+Emenda\s+[àa]\s+Constitui[cç][aã]o|Veto|Requerimento|Mensagem)\s+n[º°]\s*([\d.]+)\/(\d{4})/gi;
function votacoesNominais(plen, add){
  if (!plen.length) return;
  let txt = "", mapa = [];
  for (const l of plen) { mapa.push([txt.length, l.p]); txt += (txt && !txt.endsWith("-") ? " " : "") + l.t; }
  const pagDe = idx => { let pag = mapa[0][1]; for (const [o, p] of mapa) { if (o <= idx) pag = p; else break; } return pag; };
  const itens = []; let m; ITEM_PLEN.lastIndex = 0;
  while ((m = ITEM_PLEN.exec(txt))) itens.push({ idx: m.index, prop: (TIPO_TITULO(norm(m[1])) || (/^veto/i.test(m[1]) ? "VET" : null)) + " " + m[2].replace(/\./g, "") + "/" + m[3] });
  const rx = /Procede-se\s+[àa]\s+vota[cç][aã]o\s+por\s+meio\s+eletr[ôo]nico/gi;
  while ((m = rx.exec(txt))) {
    const it = itens.filter(x => x.idx < m.index).pop(); if (!it || /^null /.test(it.prop)) continue;
    const depois = txt.slice(m.index, m.index + 600);
    if (/votação\s+sem\s+efeito|n[ãa]o\s+h[áa]\s+qu[óo]rum\s+para\s+vota[cç][aã]o/i.test(depois.slice(0, 400))) continue;
    const antes = txt.slice(it.idx, m.index);
    if (/requerimento\s+[^.]{0,120}(retirada de pauta|adiamento|invers[ãa]o|prefer[êe]ncia)[^.]{0,200}\.\s*[^.]*Em vota[cç][aã]o,\s+o\s+requerimento/i.test(antes)) continue;
    const ev = antes.lastIndexOf("Em votação");
    add("VOTAÇÕES NOMINAIS", it.prop, pagDe(ev >= 0 ? it.idx + ev : m.index));
  }
}

export function extrairDL(lines){
  const grupos = new Map();
  const doSumario = new Set(lines.filter(l => l.p === 1 && l.b > 0.8).map(l => (l.t.match(/^\d+ [–-] (.+)$/) || [])[1]).filter(Boolean).map(norm));
  const ehTopo = t => { const n = norm(t); return doSumario.has(n) || TOPO.test(n); };
  const erratas = [];
  let topo = null, topoTxt = null, ata = null, sub = null, doc = null, sumario = false, ultimaDescMsg = null;
  const add = (desc, prop, pag) => {
    if (!grupos.has(desc)) grupos.set(desc, { desc, props: [], pags: new Set() });
    const g = grupos.get(desc);
    if (prop && !g.props.some(x => x.prop === prop)) g.props.push({ prop, pag });
    g.pags.add(pag);
  };
  let buf = "", mapa = [], bdesc = null, bRQC = false, bFiltro = null, bTipo = null;
  const plen = [];
  const pagDe = idx => { let pag = mapa[0][1]; for (const [o, p] of mapa) { if (o <= idx) pag = p; else break; } return pag; };
  const flush = () => {
    if (bdesc && buf) {
      if (bdesc === "APRESENTAÇÃO DE PROPOSIÇÕES: REQUERIMENTOS") {
        const rx = /(?:^|\s)N[º°]\s*[\d.]+\/\d{4},/g; const ini = []; let mm;
        while ((mm = rx.exec(buf))) ini.push(mm.index);
        for (let q = 0; q < ini.length; q++) {
          const item = buf.slice(ini[q], q + 1 < ini.length ? ini[q + 1] : buf.length);
          const rs = refs(item, false, true, "RQN"); if (!rs.length) continue;
          const cl = classeRQ(item); const d = bdesc + " - " + cl;
          add(d, rs[0].prop, pagDe(ini[q] + rs[0].idx));
          // anexado: o principal também recebe lançamento; retirada sem despacho: só o requerimento
          if (cl === "ANEXADOS") for (const r of rs.slice(1)) add(d, r.prop, pagDe(ini[q] + r.idx));
        }
      } else for (const r of refs(buf, bRQC, true, bTipo)) {
        if (bFiltro && !bFiltro.test(r.prop)) continue;
        let d = bdesc;
        if (d === "OFÍCIOS" || d === "CORRESPONDÊNCIA: OFÍCIOS") d += " - " + (/^RQ/.test(r.prop) ? "REQUERIMENTOS" : /^PL /.test(r.prop) ? "PROJETOS DE LEI" : "OUTROS");
        add(d, r.prop, pagDe(r.idx));
      }
    }
    buf = ""; mapa = []; bdesc = null; bRQC = false; bFiltro = null; bTipo = null;
  };
  const push = (desc, t, p, rqc, filtro, tipoBase) => {
    if (desc !== bdesc || String(filtro || "") !== String(bFiltro || "") || !!rqc !== bRQC || (tipoBase || null) !== bTipo) flush();
    bdesc = desc; bRQC = !!rqc; bFiltro = filtro || null; bTipo = tipoBase || null;
    mapa.push([buf.length, p]); buf += (buf && !buf.endsWith("-") ? " " : "") + t;
  };
  const TIT_DOC = /^(REQUERIMENTOS?|PROJETOS? DE LEI( COMPLEMENTAR)?|PROJETOS? DE RESOLU[CÇ][AÃ]O|PROPOSTAS? DE EMENDA [AÀ] CONSTITUI[CÇ][AÃ]O|MENSAGE(M|NS)|OF[IÍ]CIOS?|VETOS?|INDICA[CÇ](ÃO|ÕES))$/;
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li]; const t = l.t; const bold = l.b > 0.8;
    if (/^Página \d+ de \d+/.test(t) || /^(Segunda|Terça|Quarta|Quinta|Sexta)-feira, \d+ de|^S[aá]bado, \d+ de/.test(t)) continue;
    const upper = t === t.toUpperCase();
    if (bold && upper && !/^\d/.test(t) && ehTopo(t)) {
      flush(); topo = norm(t); topoTxt = /^ERRATA/.test(topo) ? "ERRATAS" : t; ata = null; sub = null; doc = null; sumario = false; ultimaDescMsg = null;
      if (topoTxt === "ERRATAS") { add("ERRATAS", null, l.p); erratas.push({ titulo: "", texto: "", pag: l.p }); }
      continue;
    }
    if (!topo || IGNORA_TOPO.test(topo)) continue;
    if (topoTxt === "ERRATAS") {   // guarda título (epígrafe) e texto de cada errata: o lançamento é na proposição da matéria corrigida
      const e = erratas[erratas.length - 1];
      if (bold) e.titulo += (e.titulo ? " " : "") + t; else e.texto += (e.texto ? " " : "") + t;
      push("ERRATAS", t, l.p); continue;
    }
    if (bold && /^ATA DA /.test(t)) {
      flush();
      let titulo = t; if (lines[li + 1] && lines[li + 1].b > 0.8 && !/^Presid/.test(lines[li + 1].t)) titulo += " " + lines[li + 1].t;
      const c = titulo.match(/COMISS[AÃ]O (?:DE |DO |DA |DOS |DAS )?(.+?) NA \d/);
      const d = titulo.match(/EM (\d{1,2})\/(\d{1,2})\/(\d{4})/);
      ata = { comissao: c ? c[1] : null, data: d ? d[1].padStart(2, "0") + "/" + d[2].padStart(2, "0") : "" };
      sub = null; doc = null; sumario = !ata.comissao; if (ata.comissao && lines[li + 1] && lines[li + 1].b > 0.8) li++; continue;
    }
    if (sumario) { if (bold && /^(Comparecimento|Abertura)/.test(t)) sumario = false; else continue; }
    if (topo === "ATAS" && ata && !ata.comissao) plen.push(l);   // ata de Plenário: guardada para as votações nominais (abaixo)
    if (topo === "ATAS" && ata && ata.comissao) { push("REQUERIMENTOS DE COMISSÃO: " + ata.comissao + ", " + ata.data, t, l.p, true, /^RQC /, "RQC"); continue; }
    // "Despacho de Requerimentos" (caixa baixa, negrito) vem logo depois da Comunicação da Presidência, que é seção de topo:
    // é outro grupo; sem isso, os requerimentos despachados entravam na comunicação (e na preclusão de prazo)
    if (bold && !upper && /^Despacho de Requerimentos?$/i.test(t) && /^COMUNICACAO DA PRESIDENCIA/.test(topo)) { flush(); topoTxt = "DESPACHO DE REQUERIMENTOS"; continue; }
    const plenMat = /^MATERIA DE REUNIAO D[OE] PLENARIO/.test(topo);
    const temNum = /n[º°o]\s*[\d.]+\/\d{4}/i.test(t);
    if (bold && t.length < 90 && !temNum && ((!upper && !plenMat && (topo !== "ATAS" || ATA_SUB.test(t))) || (plenMat && upper && !TIT_DOC.test(t) && !/^ANEXOS?\b/.test(t)))) { flush(); sub = t; doc = null; ultimaDescMsg = null; continue; }
    if (bold && !upper && topo === "ATAS") continue;
    if (bold && upper && t.length < 120) { flush(); doc = t; }
    // "PROJETO DE RESOLUÇÃO Nº 143/2026" seguido de "– O Projeto de Resolução nº 143/2026 foi publicado na edição anterior.":
    // só a leitura em Plenário; o lançamento "Publicado no DL" é da edição anterior
    if (bold && upper && /N[º°O]\s*[\d.]+\/\d{4}$/i.test(t) && lines[li + 1] && /^[–-]\s*[AO]s?\s.{0,80}?\b(foi|foram)\s+publicad[oa]s?\s+na\s+edi[cç][aã]o\s+anterior/i.test(lines[li + 1].t)) { li++; continue; }
    let desc = null;
    if (topo === "ATAS" || plenMat) {
      if (!sub || IGNORA_SUB.test(sub) || IGNORA_SUB2.test(sub)) continue;
      const S = SUB_NOME(sub);
      if (/^(RECEBIMENTO DE )?CORRESPONDENCIA/.test(S)) {
        if (doc && /^MENSAGEM/.test(doc)) {
          if (bold && /^MENSAGEM/.test(t)) {
            const nx = lines.slice(li + 1, li + 120).find(x => x.b > 0.8 && x.t === x.t.toUpperCase() && !/^MENSAGEM/.test(x.t)); const tp = nx ? nx.t.replace(/\s+N[º°O].*$/i, "") : "PROPOSIÇÃO";
            // texto da própria mensagem (até o próximo título): retificação, emenda/substitutivo ou encaminhamento de projeto
            let corpo = ""; for (let j = li + 1; j < lines.length && j < li + 80 && !(lines[j].b > 0.8 && lines[j].t === lines[j].t.toUpperCase() && lines[j].t.length > 3); j++) corpo += " " + lines[j].t;
            // "– A Mensagem nº 296/2026, encaminhando ..., foi publicada na edição anterior.": só a leitura em Plenário; o lançamento é na edição anterior
            if (/^\s*[–-]\s*A\s+Mensage(m|ns)\s+n[º°o]s?\s*[\d.]+\/\d{4}[^]{0,300}?\b(foi|foram)\s+publicad[ao]s?\s+na\s+edi[cç][aã]o\s+anterior/i.test(corpo)) continue;
            ultimaDescMsg = /retifica/i.test(corpo) ? "MENSAGEM DO GOVERNADOR QUE RETIFICA MENSAGEM ANTERIOR"
              : /(emendas?|substitutivos?)\s+ao\s+Projeto/i.test(corpo.slice(0, 900)) ? "MENSAGEM DO GOVERNADOR QUE ENCAMINHA EMENDA OU SUBSTITUTIVO COM DESPACHO À MESA"
              : "MENSAGEM DO GOVERNADOR QUE ENCAMINHA " + tp.toUpperCase() + (/cr[ée]dito suplementar/i.test(corpo) ? " - CRÉDITO SUPLEMENTAR" : "");
          }
          desc = ultimaDescMsg || "MENSAGEM DO GOVERNADOR";
          if (!(bold && upper)) { if (/^[–-]\s*Anexe-se/i.test(t)) push(desc, t, l.p); continue; }   // despacho "– Anexe-se ao Projeto de Resolução nº 139/2026"; a mensagem citada no texto não entra
        } else if (doc && /^PROPOSTAS? DE A[CÇ][AÃ]O LEGISLATIVA/.test(doc)) {
          // Proposta de Ação Legislativa (PPAG/LOA): lança só a PLE do título; a ementa cita o projeto de lei, que não entra
          const m = bold && upper && t.match(/^PROPOSTAS? DE A[CÇ][AÃ]O LEGISLATIVA N[º°O]\s*([\d.]+)\/(\d{4})/i);
          if (m) { flush(); add("PROPOSTAS DE AÇÃO LEGISLATIVA", "PLE " + m[1].replace(/\./g, "") + "/" + m[2], l.p); }
          continue;
        } else if (doc && /^(PROJETO|PROPOSTA|VETO|EMENDA|SUBSTITUTIVO)/.test(doc) && ultimaDescMsg) {
          desc = ultimaDescMsg; if (!(bold && upper)) continue;
        } else desc = "OFÍCIOS";
      } else if (/^(APRESENTACAO|RECEBIMENTO) DE PROPOSICOES/.test(S)) {
        const d0 = doc || "";
        desc = "APRESENTAÇÃO DE PROPOSIÇÕES: " + (/^REQUERIMENTO/.test(d0) ? "REQUERIMENTOS" : /^PROJETOS? DE LEI COMPLEMENTAR/.test(d0) ? "PROJETOS DE LEI COMPLEMENTAR" : /^PROJETOS? DE RESOLU/.test(d0) ? "PROJETOS DE RESOLUÇÃO" : /^PROPOSTAS? DE EMENDA/.test(d0) ? "PROPOSTA DE EMENDA À CONSTITUIÇÃO" : "PROJETOS DE LEI");
        if (/^REQUERIMENTO/.test(d0)) { if (!(bold && upper)) push(desc, t, l.p, false, null, "RQN"); continue; }
        if (TIT_DOC.test(d0)) { if (!(bold && upper)) push(desc, t, l.p, false, null, TIPO_TITULO(d0)); continue; }
        if (!(bold && upper)) { push(desc, t, l.p, false, /^MSG /); continue; }
      } else if (/^ACORDOS? DE LIDERES/.test(S)) desc = "DECISÃO DA PRESIDÊNCIA, ACORDO DE LÍDERES";
      else if (/^RECEBIMENTO DE (SUBSTITUTIVO|EMENDA)/.test(S)) { desc = "EMENDAS OU SUBSTITUTIVOS PUBLICADOS"; if (!bold) continue; }   // só os títulos "SUBSTITUTIVO Nº 1 AO PROJETO ..."; a justificação cita mensagens
      else desc = sub.toUpperCase().replace(/^PALAVRAS D[AO] PRESIDENTE.*/, "PALAVRAS DO PRESIDENTE").replace(/^DESIGNAÇÃO DE COMISSÃO$/, "DESIGNAÇÃO DE COMISSÕES");
    } else if (/^(TRAMITA|PARECERES)/.test(topo)) {
      if (bold && /^PARECER/i.test(t)) {
        flush();
        let titulo = t; let j = li + 1; while (lines[j] && lines[j].b > 0.8 && titulo.length < 300 && !/n[º°o]\s*[\d.]+\/\d{4}/i.test(titulo)) titulo += " " + lines[j++].t;
        const grupoPar = /^PARECERES SOBRE VETO/.test(topo) ? "PARECERES SOBRE VETO" : "PARECERES";
        // parecer sobre Ofício (ex.: prestação de contas, pág 86-91): "Ofício" é palavra de quebra em refs() (reseta o tipo
        // dentro de listas comuns), então um parecer cujo título é o próprio Ofício nunca vira PL/PLC ali — some do grupo.
        // Aqui o título já está isolado (só a linha do parecer), então extrai o nº/ano do Ofício direto, sem mexer em
        // refs()/TIPOS/QUEBRA (usados em todo o resto do arquivo).
        const mOfi = titulo.match(/of[ií]cios?\s*n[º°o]?\.?\s*([\d.]+)\s*\/\s*(\d{4})/i);
        if (mOfi) add(grupoPar, "OFI " + mOfi[1].replace(/\./g, "") + "/" + mOfi[2], l.p);
        else for (const r of refs(titulo).slice(0, 1)) add(grupoPar, r, l.p);
      }
      continue;
    } else if (/^PROPOSICOES DE LEI/.test(topo)) {
      const m = bold && t.match(/^PROPOSI[CÇ][AÃ]O DE LEI N[º°]\s*([\d.]+)$/i);
      if (m) add("PROPOSIÇÕES DE LEI", "PROPLEI " + m[1].replace(/\./g, ""), l.p);
      continue;
    } else if (/^CORRESPOND/.test(topo)) desc = "CORRESPONDÊNCIA: OFÍCIOS";
    else desc = topoTxt;
    if (/^REQUERIMENTOS APROVADOS/.test(topo) && !bold) continue;   // só o título "REQUERIMENTO Nº ..."; o texto cita outros requerimentos
    push(desc, t, l.p, false, null, doc ? TIPO_TITULO(doc) : null);
  }
  flush();
  votacoesNominais(plen, add);
  const out = [];
  for (const g of grupos.values()) {
    const ps = [...g.pags].sort((a, b) => a - b);
    const o = { desc: g.desc, pag: ps[0] === ps[ps.length - 1] ? String(ps[0]) : ps[0] + " - " + ps[ps.length - 1], props: g.props };
    if (g.desc === "ERRATAS") {
      o.erratas = erratas;
      // proposição da errata: a do título (epígrafe); sem título com número, a do texto, sem o número errado citado em "onde se lê"
      const vistos = new Set(); o.props = [];
      for (const e of erratas) {
        const rs = refsErrata(e);
        for (const r of rs) if (!vistos.has(r)) { vistos.add(r); o.props.push({ prop: r, pag: e.pag }); }
      }
    }
    out.push(o);
  }
  out.sort((a, b) => parseInt(a.pag) - parseInt(b.pag));
  return out;
}
