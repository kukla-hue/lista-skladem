// Spočítá kusy skladem (skladem + rezervováno) pro lištu na fajnspanek.cz
// a uloží je do sklad.json. Spouští GitHub Actions jednou denně.
import { writeFileSync } from "node:fs";

const TOKEN = process.env.SHOPTET_TOKEN;
if (!TOKEN) throw new Error("Chybí SHOPTET_TOKEN");

// Pořadí = pořadí na liště. Produkt patří do první kategorie, kde je započtený.
// navic = kusy vystavené na prodejně, které nejsou vedené ve skladu.
const CATS = [
  { guid: "352a7ee4-ed2a-11e9-ac23-ac1f6b0076ec", tvary: ["matrace", "matrace", "matrací"], navic: 21 },
  { guid: "a406fa38-ed2b-11e9-ac23-ac1f6b0076ec", tvary: ["rošt", "rošty", "roštů"], navic: 21 },
  { guid: "5d9a7cbb-eebd-11e9-ac23-ac1f6b0076ec", tvary: ["postel", "postele", "postelí"], navic: 11, vyradit: /stolek|komod/i },
  { guid: "23d876dc-eebe-11e9-ac23-ac1f6b0076ec", tvary: ["polštář", "polštáře", "polštářů"], vyradit: /klínov|podhlavník|kolen|podsedák|cestovn|travel|\bset\b/i },
  { guid: "42e20358-0224-11ea-beb1-002590dad85e", tvary: ["přikrývka", "přikrývky", "přikrývek"] },
];
// Doplňky se nepočítají v žádné kategorii.
const DOPLNKY = /potah|chránič|náhradní|lamel|taška|poukaz/i;
// Matrace DUO 1+1 = 2 kusy.
const DUO = /\bDUO\b/;

async function api(path) {
  const r = await fetch("https://api.myshoptet.com/api" + path, {
    headers: { "Shoptet-Private-API-Token": TOKEN, "Content-Type": "application/vnd.shoptet.v1.0" },
  });
  const j = await r.json();
  if (!r.ok || j.errors?.length) throw new Error(`${path}: ${r.status} ${JSON.stringify(j.errors)}`);
  return j.data;
}

async function vse(path, key) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await api(`${path}${path.includes("?") ? "&" : "?"}page=${page}&itemsPerPage=100`);
    out.push(...d[key]);
    if (page >= d.paginator.pageCount) return out;
  }
}

// Kusy na produkt: kladný stav + rezervace, přes všechny varianty a sklady.
const kusy = new Map();
for (const { id } of (await api("/stocks")).stocks) {
  for (const s of await vse(`/stocks/${id}/supplies`, "supplies")) {
    const n = Math.max(+s.amount || 0, 0) + Math.max(+s.claim || 0, 0);
    kusy.set(s.productGuid, (kusy.get(s.productGuid) || 0) + n);
  }
}

const tvar = (n, [a, b, c]) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
const hotovo = new Set();
const v = [];
for (const c of CATS) {
  let soucet = 0;
  const vyrazeno = [];
  for (const p of await vse(`/products?categoryGuid=${c.guid}`, "products")) {
    if (hotovo.has(p.guid)) continue;
    const n = kusy.get(p.guid) || 0;
    if (p.type !== "product" || DOPLNKY.test(p.name) || c.vyradit?.test(p.name)) {
      if (n) vyrazeno.push(`${p.name} (${n})`);
      continue;
    }
    hotovo.add(p.guid);
    soucet += DUO.test(p.name) && c === CATS[0] ? n * 2 : n;
  }
  console.log(`${c.tvary[2]}: ${soucet} + prodejna ${c.navic || 0}` + (vyrazeno.length ? `\n  vyřazeno: ${vyrazeno.join(", ")}` : ""));
  // Nula ze skladu znamená chybu (API, přejmenovaná kategorie…). Běh selže,
  // na webu zůstanou poslední čísla a GitHub pošle e-mail.
  if (!soucet && c.tvary[0] !== "postel") throw new Error(`Podezřelá nula: ${c.tvary[2]}`);
  soucet += c.navic || 0;
  v.push([soucet, tvar(soucet, c.tvary)]);
}

const d = new Date().toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
writeFileSync("sklad.json", JSON.stringify({ d, v }) + "\n");
console.log(JSON.stringify({ d, v }));
