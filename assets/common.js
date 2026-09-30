/* ============================================================
   AlgoTrack — assets/common.js — v9.1
   Code partagé : carte (index.html) + dashboard (dashboard.html)
   Source unique : CONFIG, couleurs, parsing, helpers, mock, chargement.
   ============================================================ */

// ---------------------- CONFIG ----------------------
// ⚠ Si vous recréez un déploiement Apps Script, mettez à jour l'URL ICI uniquement.
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbxjkSzeToO1DP8yaBtfh--mLU8xojga5gdg-Pmbpv0tvECXRNaTX0R4-fq7NEsey_Pv/exec", // Apps Script v9.1
  REFRESH_MS: 5 * 60 * 1000,
  SEUIL_FRAICHE_JOURS: 15,
  SEUIL_ALERTE_JOURS: 30
};

// ---------------------- RÈGLE DES COULEURS ----------------------
// 0→2 faible, 2→4 bonne (> 4 forte) — identique carte & dashboard
const COLORS = {
  pending:  { hex: "#94a3b8", tw: "bg-slate-400",  text: "text-slate-500", txt: "#0f172a" },
  severe:   { hex: "#b91c1c", tw: "bg-red-700",    text: "text-red-700",   txt: "#ffffff" },
  moderate: { hex: "#ef4444", tw: "bg-red-500",    text: "text-red-600",   txt: "#ffffff" },
  low:      { hex: "#bbf7d0", tw: "bg-green-200",  text: "text-green-700", txt: "#0f172a" },
  good:     { hex: "#22c55e", tw: "bg-green-500",  text: "text-green-600", txt: "#ffffff" },
  strong:   { hex: "#15803d", tw: "bg-green-700",  text: "text-green-700", txt: "#ffffff" }
};
const STATUT_LABELS = {
  strong: "Forte (> 4)", good: "Bonne (2 → 4)", low: "Faible (0 → 2)",
  moderate: "Modérée (−2 → 0)", severe: "Sévère (< −2)", pending: "En attente"
};
const STATUT_ORDER = ["strong", "good", "low", "moderate", "severe", "pending"];

function statutKey(v) {
  if (v === null || v === undefined || isNaN(v)) return "pending";
  if (v > 4)   return "strong";
  if (v >= 2)  return "good";
  if (v >= 0)  return "low";
  if (v >= -2) return "moderate";
  return "severe";
}
function colorFor(v) { return COLORS[statutKey(v)]; }
function survieColor(v) { return v >= 80 ? COLORS.good : v >= 50 ? COLORS.low : COLORS.moderate; }

const PALETTE = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#ef4444", "#a855f7"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

// ---------------------- SÉCURITÉ / TEXTE ----------------------
// Échappement HTML — à utiliser pour TOUTE valeur injectée en innerHTML
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Minuscule + sans accents — recherche insensible aux accents
function normFr(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ---------------------- PARSING / DATES ----------------------
function parseTxcr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "*") return null;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}
// Accepte jj/mm/aaaa ET aaaa-mm-jj (l'API v9 émet de l'ISO)
function parseFrDate(s) {
  let m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function fmtDate(d) {
  return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
}
// Affichage FR d'une date stockée en chaîne (ISO ou FR)
function displayFr(s) {
  if (!s) return "—";
  const d = parseFrDate(s);
  return d ? fmtDate(d) : String(s);
}
function fmtMois(ym) { const [y, m] = ym.split("-"); return `${MOIS[+m - 1]} ${y.slice(2)}`; }
function joursDepuis(d) { return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5)) : null; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function varBase(v) { return String(v || "").split("(")[0].trim(); }
function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
  let num = 0, dx = 0, dy = 0;
  pairs.forEach(([x, y]) => { num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; });
  return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
}

// Flotteur : la partie N° de ligne (avant la 1ère parenthèse ou "·") se termine par "F"
// Ex. "LT 2F (Ambolimbake) · Spinosum" → "LT 2F" → true
function aFlotteur(ligneTest) {
  const s = String(ligneTest || "").trim();
  const numPart = s.split(/[·(]/)[0].trim();
  return /F$/i.test(numPart);
}

// ---------------------- LIBELLÉ DE LIGNE (AFFICHAGE) ----------------------
// Le libellé COMPLET ("LT1 (Centre) · Sacol (Cottonii)") est la CLÉ de regroupement
// pour tous les calculs — il distingue les mêmes n° de ligne entre zones.
// À l'AFFICHAGE uniquement, on retire la mention de zone (déjà montrée en badge).
// Ex. : cleanLigneLabel("LT1 (Centre) · Sacol (Cottonii)", "Centre")
//   →  "LT1 · Sacol (Cottonii)"
// Si la zone est inconnue ("zone ?"), rien n'est nettoyé : le signal reste visible.
function cleanLigneLabel(label, zone) {
  const s = String(label || "").trim();
  const z = String(zone || "").trim();
  if (!z) return s;
  return s.split("(" + z + ")").join("").replace(/\s+/g, " ").trim();
}

// ---------------------- COMPOSANTS ----------------------
function badgeSgr(sgr) {
  const key = statutKey(sgr), c = COLORS[key];
  const txt = sgr === null ? "En attente" : `${sgr > 0 ? "+" : ""}${sgr.toFixed(2)} %/j`;
  return `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${c.tw} ${c.txt === "#ffffff" ? "text-white" : "text-slate-900"}">${txt}</span>`;
}
function dotFraicheur(lastDate) {
  const j = joursDepuis(lastDate);
  const hex = j === null ? COLORS.pending.hex
    : j <= CONFIG.SEUIL_FRAICHE_JOURS ? COLORS.good.hex
    : j <= CONFIG.SEUIL_ALERTE_JOURS ? COLORS.moderate.hex
    : COLORS.severe.hex;
  return `<span class="inline-block w-2 h-2 rounded-full mr-1.5" style="background:${hex}"></span>`;
}
// Statut de connexion — les 2 pages ont #statusDot / #statusText / #statusBadge
function setStatus(isLive, text) {
  document.querySelector("#statusBadge")?.classList.remove("hidden");
  const label = document.querySelector("#statusText");
  const dot = document.querySelector("#statusDot");
  if (label) label.textContent = text;
  if (dot) dot.className = "w-2 h-2 rounded-full " + (isLive ? "bg-emerald-500" : "bg-amber-500");
}

// ---------------------- CHARGEMENT ----------------------
async function loadData(strict) {
  if (!CONFIG.API_URL.startsWith("http")) {
    if (strict) throw new Error("API_URL non configurée");
    console.warn("API_URL non configurée — mode démo");
    setStatus(false, "Mode démo (données fictives)");
    return MOCK_GEOJSON;
  }
  try {
    const res = await fetch(CONFIG.API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const geo = await res.json();
    if (geo.error) throw new Error(geo.error);
    if (!geo.features || !geo.features.length) throw new Error("Aucune donnée");
    if (geo.excluded && geo.excluded.length)
      console.warn("Sites sans correspondance GeoJSON :", geo.excluded.join(", "));
    setStatus(true, "Live data...");
    return geo;
  } catch (err) {
    if (strict) throw err;
    console.warn("API indisponible, mode démo :", err.message);
    setStatus(false, "Mode démo");
    return MOCK_GEOJSON;
  }
}

// ---------------------- MOCK (mode démo) ----------------------
// Libellés au même format que l'API réelle : "LT 1 (Zone) · Variété".
// Dates relatives à aujourd'hui → dot de fraîcheur et alertes démontratives.
function mkSite(code, nom, secteur, tche, lon, lat, cumuls, opts = {}) {
  const teh = "THK5";
  const zone0 = opts.zone || "Ambolimbake";
  const var0 = opts.variete || "Sacol (Cottonii)";
  const rows = [];
  const base = new Date();
  base.setDate(base.getDate() - ((cumuls.length + (opts.pr ? 1 : 0)) + 1) * 15 + (opts.ageOffset || 0));
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const lbl = "LT 1 (" + zone0 + ") · " + var0;
  const mk = (i, d, txcr, w, nb, isPR) => ({
    ligne_test: lbl, tehake: teh, pesage: isPR ? "PR" : "P" + i,
    date_pesage: iso(d), duree: i === 0 ? "" : String(i * 15),
    txcr_calc: txcr, nb, poids: String(w),
    variete: var0, zone: zone0,
    materiel: opts.materiel || "Corde", type_culture: opts.type || "OB",
    sante: {
      efa: (opts.efa && i >= Math.ceil(cumuls.length / 2)) ? opts.efa : 0,
      iceice: opts.iceice ? (i === 1) : false,
      broutage: false, lomodraty: !!(opts.lomodraty && i === 2)
    }
  });
  let nb = 30;
  rows.push(mk(0, base, "*", 1.8, nb));
  cumuls.forEach((v, i) => {
    const w = 1.8 * Math.pow(1 + v / 100, 15 * (i + 1));
    if (opts.perte && i === 1) nb--;
    rows.push(mk(i + 1, new Date(base.getTime() + (i + 1) * 15 * 864e5),
      (v >= 0 ? "+" : "") + v.toFixed(2), +w.toFixed(2), nb));
  });
  if (opts.pr) {
    const v = opts.prCumul;
    const w = 1.8 * Math.pow(1 + v / 100, 15 * (cumuls.length + 1));
    rows.push(mk(cumuls.length + 1, new Date(base.getTime() + (cumuls.length + 1) * 15 * 864e5),
      "+" + v.toFixed(2), +w.toFixed(2), nb, true));
  }
  // Ligne secondaire AVEC flotteur (démo du graphique Avec vs Sans flotteur)
  if (opts.line2F) {
    const b2 = new Date(); b2.setDate(b2.getDate() - 45);
    const nm = "LT 2F (" + zone0 + ") · Spinosum";
    rows.push({ ligne_test: nm, tehake: teh, pesage: "P0", date_pesage: iso(b2), duree: "",
      txcr_calc: "*", nb: 30, poids: "1.5", variete: "Spinosum", zone: zone0,
      materiel: "Corde", type_culture: "OB",
      sante: { efa: 0, iceice: false, broutage: false, lomodraty: false } });
    opts.line2F.forEach((v, i) => {
      rows.push({ ligne_test: nm, tehake: teh, pesage: "P" + (i + 1),
        date_pesage: iso(new Date(b2.getTime() + (i + 1) * 15 * 864e5)),
        duree: String((i + 1) * 15), txcr_calc: (v >= 0 ? "+" : "") + v.toFixed(2),
        nb: 30, poids: +(1.5 * Math.pow(1 + v / 100, 15 * (i + 1))).toFixed(2),
        variete: "Spinosum", zone: zone0, materiel: "Corde", type_culture: "OB",
        sante: { efa: 0, iceice: false, broutage: false, lomodraty: false } });
    });
  }
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { site_id: code, code_site: code, site_nom: nom, secteur, tche, tehake: teh, rows } };
}

const MOCK_GEOJSON = { type: "FeatureCollection", features: [
  mkSite("TAM", "Tambalang Nord", "BTL", "Tovondrana Ariside", 43.760, -23.310, [4.62, 5.10],
    { zone: "Ambolimbake", pr: true, prCumul: 4.87, line2F: [3.20, 3.50] }),
  mkSite("BLM", "Ambolimoke", "ADK", "Hajatiana Arstide", 43.689, -23.354, [2.62, 2.30],
    { zone: "Bepoasa", variete: "Spinosum", perte: true }),
  mkSite("BVK", "Belavenoky", "BDA", "Franco", 43.655, -23.402, [0.45],
    { zone: "Beppa", variete: "Sacol (Cottonii)", materiel: "Tube-net", type: "LL" }),
  mkSite("APL", "Ampasilava", "ADK", "Bonhôte", 43.672, -23.381, [-0.42, -0.30],
    { zone: "Ambalaza", variete: "Spinosum", materiel: "Tube-net" }),
  mkSite("TSM", "Antsatsamoroy", "MKN", "Sandrine", 43.718, -23.390, [-2.40, -2.10],
    { zone: "Mitata", variete: "Spinosum", iceice: true, efa: 3, lomodraty: true }),
  mkSite("TSG", "Tserananangy", "MKN", "TOVO Irène Julie", 43.701, -23.365, [],
    { zone: "Betsiboko", variete: "Spinosum", ageOffset: 20 }) // > 30 j → alerte retard
]};