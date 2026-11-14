// Génère pitch/qualif-comptage-pitch.pptx (3 min, 6 diapositives) + notes du présentateur.
const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");
const React = require("react");
const RDS = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const SKILL = process.env.SKILL_DIR;
const { applyTheme } = require(path.join(SKILL, "scripts/apply_theme.js"));
const sim = JSON.parse(fs.readFileSync(process.env.SIM_JSON, "utf8"));

const THEME = {
  name: "Qualif-Comptage",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "14213D", lt1: "FFFFFF", dk2: "0B1426", lt2: "EEF2F7",
    accent1: "E8890C", accent2: "0E9F8E", accent3: "C0392B", accent4: "3B6FB6", accent5: "64748B", accent6: "F4C26B",
    hlink: "3B6FB6", folHlink: "64748B",
  },
};
const HEX = { dk1: "14213D", dk2: "0B1426", lt2: "EEF2F7", a1: "E8890C", a2: "0E9F8E", a3: "C0392B", a5: "64748B", white: "FFFFFF" };

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Qualif-Comptage — pitch 3 minutes";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

pres.defineSlideMaster({
  title: "DARK", background: { color: HEX.dk2 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.5, w: 8.8, h: 1.4, fontFace: "Cambria", fontSize: 44, bold: true, color: C.background1, valign: "top", margin: 0 }, text: "" } }],
});
pres.defineSlideMaster({
  title: "LIGHT", background: { color: HEX.white },
  slideNumber: { x: 9.2, y: 5.2, w: 0.5, h: 0.3, fontFace: "Calibri", fontSize: 10, color: C.accent5 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 8.8, h: 0.8, fontFace: "Cambria", fontSize: 32, bold: true, color: C.text1, valign: "top", margin: 0 }, text: "" } }],
});

async function icon(name, color = "#FFFFFF") {
  const svg = RDS.renderToStaticMarkup(React.createElement(fa[name], { color, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
function circleIcon(slide, img, x, y, d, fill, name) {
  slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: name + " fond" });
  slide.addImage({ data: img, x: x + d * 0.26, y: y + d * 0.26, w: d * 0.48, h: d * 0.48, altText: name, objectName: name });
}

(async () => {
  const ic = {};
  for (const n of ["FaClock", "FaBolt", "FaArrowDown", "FaLock", "FaFileUpload", "FaSearch", "FaMagic", "FaHistory", "FaCheck", "FaTimes", "FaCodeBranch", "FaGlobe", "FaBalanceScale"]) ic[n] = await icon(n);

  const INK = "14213D";
  const AMBER_TXT = "9A4A00";
  const TEAL_TXT = "0B6B5F";
  const SOFT = "E6EBF5";
  const PANEL = "1F3A66";
  const GRIDD = "3A5280";
  const lab = (arr, step) => arr.map((l, i) => (i % step === 0 ? (i % (2 * step) === 0 ? l.slice(0, 5) : "12h") : " "));

  // ───────────── 1 — Accroche + problème
  pres.addSection({ title: "Problème" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Problème" });
  s.addText("ÉNERG-IACK 2026 · DÉFI 3", { x: 0.6, y: 0.4, w: 5, h: 0.3, fontFace: "Calibri", fontSize: 12, bold: true, color: C.accent6, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Sur-titre" });
  s.addText("Qualif-Comptage", { x: 0.6, y: 0.75, w: 4.4, h: 0.75, fontFace: "Cambria", fontSize: 38, bold: true, color: C.background1, valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addText("Un compteur qui ment fausse toutes les décisions.", { x: 0.6, y: 1.55, w: 4.1, h: 0.95, fontFace: "Calibri", fontSize: 22, italic: true, color: C.accent6, valign: "top", margin: 0, isTextBox: true, objectName: "Accroche" });
  const faults = [["FaClock", "Trous de relevé"], ["FaBolt", "Pics et valeurs négatives"], ["FaArrowDown", "Index qui baisse"], ["FaLock", "Compteur bloqué"]];
  faults.forEach((f, i) => {
    const y = 2.75 + i * 0.5;
    circleIcon(s, ic[f[0]], 0.6, y, 0.4, "E0533F", `Icône ${f[1]}`);
    s.addText(f[1], { x: 1.15, y, w: 3.5, h: 0.4, fontFace: "Calibri", fontSize: 18, bold: true, color: C.background1, margin: 0, valign: "middle", isTextBox: true });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 5.0, y: 0.45, w: 4.4, h: 4.25, rectRadius: 0.08, fill: { color: PANEL }, line: { color: PANEL }, objectName: "Carte graphique" });
  s.addText("Un compteur de gaz, 27 janvier : valeur figée à 0 pendant 6 h", { x: 5.2, y: 0.55, w: 4.0, h: 0.7, fontFace: "Calibri", fontSize: 16, bold: true, color: C.background1, valign: "top", margin: 0, isTextBox: true, objectName: "Titre graphique" });
  s.addChart(pres.charts.LINE, [{ name: "Gaz (kWh/h, simulé)", labels: lab(sim.hero_labels, 12), values: sim.hero_raw }], {
    x: 5.1, y: 1.3, w: 4.2, h: 3.3, chartColors: ["5CC8FF"], lineSize: 3.5, lineDataSymbol: "none", showLegend: false,
    catAxisLabelColor: SOFT, valAxisLabelColor: SOFT, catAxisLabelFontSize: 12, valAxisLabelFontSize: 12,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFrequency: 1, catAxisLabelRotate: 0,
    valGridLine: { color: GRIDD, size: 0.75 }, catGridLine: { style: "none" }, displayBlanksAs: "gap",
  });
  s.addText("Aujourd'hui : repérage et correction à la main, sans trace.", { x: 0.6, y: 4.8, w: 8.8, h: 0.35, fontFace: "Calibri", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "Constat" });
  s.addText("Saleh Bauch · Stéphane Bernardini · Loïc Gilbert · Sébastien Lavaud — Défi 3 : L'IA gardienne de la donnée", { x: 0.6, y: 5.2, w: 8.8, h: 0.3, fontFace: "Calibri", fontSize: 12, color: SOFT, margin: 0, isTextBox: true, objectName: "Équipe et défi" });

  // ───────────── 2 — Solution (capture réelle)
  pres.addSection({ title: "Solution" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Solution" });
  s.addText("L'outil propose, la personne décide", { placeholder: "title", align: "left", valign: "top" });
  const steps = [
    ["FaFileUpload", "Importer", "CSV de tout fluide"],
    ["FaSearch", "Qualifier", "Score et zones à traiter"],
    ["FaMagic", "Corriger", "Plusieurs correctifs au choix"],
    ["FaHistory", "Tracer", "Chaque décision enregistrée"],
  ];
  steps.forEach((st, i) => {
    const y = 1.4 + i * 0.95;
    circleIcon(s, ic[st[0]], 0.6, y + 0.05, 0.6, i === 2 ? "C2620A" : "0B6B5F", `Étape ${st[1]}`);
    s.addText(`${i + 1}. ${st[1]}`, { x: 1.4, y, w: 2.7, h: 0.35, fontFace: "Cambria", fontSize: 20, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(st[2], { x: 1.4, y: y + 0.36, w: 2.7, h: 0.5, fontFace: "Calibri", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 4.3, y: 1.3, w: 5.2, h: 3.2, rectRadius: 0.1, fill: { color: "FFFFFF" }, line: { color: "CBD5E1", width: 1 }, shadow: { type: "outer", color: "000000", opacity: 0.18, blur: 8, offset: 3, angle: 90 }, objectName: "Cadre capture" });
  s.addImage({ path: path.join(__dirname, "capture-diagnostic.png"), x: 4.45, y: 1.45, w: 4.9, h: 4.9 * 732 / 1276, altText: "Capture de l'application : zone Absence de relevé de 8 heures, diagnostic proposé, choix du correctif (profil type, interpolation linéaire, report)", objectName: "Capture application" });
  s.addText("Capture réelle de l'application (données simulées)", { x: 4.3, y: 4.62, w: 5.2, h: 0.3, fontFace: "Calibri", fontSize: 12, italic: true, color: "475569", margin: 0, isTextBox: true, objectName: "Légende capture" });

  // ───────────── 3 — Preuve
  pres.addSection({ title: "Preuve" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Preuve" });
  s.addText("Preuve : 8 h de gaz reconstruites", { placeholder: "title", align: "left", valign: "top" });
  const labels = lab(sim.labels, 12), raw = sim.raw, rec = sim.rec, truth = sim.truth_gap;
  const gapIdx = raw.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const lo = Math.min(...gapIdx) - 1, hi = Math.max(...gapIdx) + 1;
  const only = (arr) => arr.map((v, i) => (i >= lo && i <= hi ? v : null));
  s.addChart(pres.charts.LINE, [
    { name: "Mesure brute (trou le 22/01)", labels, values: raw },
    { name: "Valeur réelle (connue en simulation)", labels, values: only(truth) },
    { name: "Reconstruit par profil type", labels, values: only(rec) },
  ], {
    x: 0.5, y: 1.3, w: 6.5, h: 3.6, chartColors: [INK, "8A97B0", "E8890C"], lineSize: 3.5, lineDataSymbol: "none",
    showLegend: true, legendPos: "b", legendFontSize: 12, legendColor: INK, legendFontFace: "+mn-lt",
    catAxisLabelColor: INK, valAxisLabelColor: INK, catAxisLabelFontSize: 12, valAxisLabelFontSize: 12,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFrequency: 1, catAxisLabelRotate: 0,
    valGridLine: { color: "CBD5E1", size: 0.75 }, catGridLine: { style: "none" },
    showValAxisTitle: true, valAxisTitle: "kWh par heure (simulé)", valAxisTitleFontSize: 12, valAxisTitleColor: INK, valAxisTitleFontFace: "+mn-lt",
    displayBlanksAs: "gap",
  });
  const stats = [[`${sim.ncorr}`, "points corrigés", AMBER_TXT], [`${sim.err_pct} %`, "d'écart moyen avec la vraie valeur", TEAL_TXT], ["50/50", "anomalies injectées détectées", AMBER_TXT]];
  stats.forEach((st, i) => {
    const y = 1.3 + i * 1.22;
    s.addShape(pres.ShapeType.roundRect, { x: 7.2, y, w: 2.3, h: 1.1, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Carte chiffre ${i + 1}` });
    s.addText(st[0], { x: 7.35, y: y + 0.06, w: 2.0, h: 0.55, fontFace: "Cambria", fontSize: 32, bold: true, color: st[2], margin: 0, isTextBox: true });
    s.addText(st[1], { x: 7.35, y: y + 0.62, w: 2.05, h: 0.45, fontFace: "Calibri", fontSize: 13, color: INK, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Série horaire simulée sur 28 jours, pannes injectées, corrigée par le moteur du code.", { x: 0.5, y: 5.0, w: 8.4, h: 0.3, fontFace: "Calibri", fontSize: 12, italic: true, color: "475569", margin: 0, isTextBox: true, objectName: "Source" });

  // ───────────── 4 — Le défi, point par point
  pres.addSection({ title: "Le défi point par point" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Le défi point par point" });
  s.addText("Le défi 3, point par point", { placeholder: "title", align: "left", valign: "top" });
  const rows = [
    ["Couvert", "0B6B5F", "Détecter les anomalies", "10 types, seuils réglables · 50/50 anomalies injectées détectées"],
    ["Partiel", "B45309", "Qualifier chaque valeur", "4 statuts aujourd'hui ; « mesuré / estimé / hypothèse » à ajouter"],
    ["Partiel", "B45309", "Tracer chaque hypothèse", "Valeur brute conservée, historique par dossier ; pas encore de trace par point"],
    ["Absent", "B3261E", "Veiller en continu", "CSV déposés à la main : pas de planificateur ni d'alertes"],
  ];
  rows.forEach((r, i) => {
    const y = 1.3 + i * 0.85;
    s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: y + 0.12, w: 1.25, h: 0.45, rectRadius: 0.22, fill: { color: r[1] }, line: { color: r[1] }, objectName: `Pastille ${r[2]}` });
    s.addText(r[0], { x: 0.6, y: y + 0.12, w: 1.25, h: 0.45, fontFace: "Calibri", fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(r[2], { x: 2.1, y, w: 7.3, h: 0.38, fontFace: "Cambria", fontSize: 20, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(r[3], { x: 2.1, y: y + 0.38, w: 7.3, h: 0.4, fontFace: "Calibri", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Défauts connus (audit) : import sur valeur vide, faux positifs en horaire.", { x: 0.6, y: 4.8, w: 8.8, h: 0.5, fontFace: "Calibri", fontSize: 16, italic: true, color: INK, margin: 0, valign: "top", isTextBox: true, objectName: "Défauts connus" });

  // ───────────── 5 — Impact, reprise, suite
  pres.addSection({ title: "Impact et suite" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Impact et suite" });
  s.addText("Des décisions fondées sur des données saines", { x: 0.6, y: 0.4, w: 8.8, h: 0.7, fontFace: "Cambria", fontSize: 30, bold: true, color: C.background1, align: "left", valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.15, w: 8.8, h: 1.15, rectRadius: 0.08, fill: { color: "F5A524" }, line: { color: "F5A524" }, objectName: "Bandeau impact" });
  s.addText("≈ 750 h / an", { x: 0.8, y: 1.15, w: 3.2, h: 1.15, fontFace: "Cambria", fontSize: 36, bold: true, color: "0B1426", margin: 0, valign: "middle", isTextBox: true, objectName: "Chiffre impact" });
  s.addText("de correction manuelle évitées pour 1 000 compteurs. Hypothèses : 5 zones par compteur et par an, 10 min à la main contre 1 min avec l'outil.", { x: 4.1, y: 1.15, w: 5.15, h: 1.15, fontFace: "Calibri", fontSize: 16, color: "0B1426", margin: 0, valign: "middle", isTextBox: true, objectName: "Hypothèses impact" });
  const cards = [
    ["FaBalanceScale", "Pour la Ville", "Moins de nettoyage, des données fiables"],
    ["FaGlobe", "Transposable", "Aucun fluide codé en dur"],
    ["FaCodeBranch", "Reprenable", "Code ouvert (MIT), Docker ou exécutable"],
  ];
  cards.forEach((cd, i) => {
    const x = 0.6 + i * 2.15;
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.5, w: 2.0, h: 2.3, rectRadius: 0.08, fill: { color: PANEL }, line: { color: PANEL }, objectName: `Carte ${cd[1]}` });
    circleIcon(s, ic[cd[0]], x + 0.2, 2.65, 0.55, "F5A524", `Icône ${cd[1]}`);
    s.addText(cd[1], { x: x + 0.2, y: 3.3, w: 1.65, h: 0.4, fontFace: "Cambria", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true });
    s.addText(cd[2], { x: x + 0.2, y: 3.75, w: 1.65, h: 1.0, fontFace: "Calibri", fontSize: 16, color: C.background1, margin: 0, valign: "top", isTextBox: true });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 7.05, y: 2.5, w: 2.35, h: 2.3, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" }, objectName: "Carte QR" });
  s.addImage({ path: path.join(__dirname, "qr-depot.png"), x: 7.4, y: 2.6, w: 1.65, h: 1.65, altText: "QR code vers le dépôt GitHub loicgilbert74000-coder/qualif-comptage", objectName: "QR code dépôt" });
  s.addText("Code source : scannez", { x: 7.1, y: 4.3, w: 2.25, h: 0.4, fontFace: "Calibri", fontSize: 14, bold: true, color: "0B1426", align: "center", margin: 0, isTextBox: true, objectName: "Légende QR" });
  s.addText("Suite : statuts « mesuré / estimé / hypothèse », trace par point, veille continue.", { x: 0.6, y: 4.95, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 16, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Suite" });

  // Notes (≈ 3 min, ~430 mots)
  const N = fs.readFileSync(path.join(__dirname, "notes.json"), "utf8");
  const notes = JSON.parse(N);
  pres.slides.forEach((sl, i) => sl.addNotes(notes[i]));

  const out = path.join(__dirname, "qualif-comptage-pitch.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("ok", out);
})();
