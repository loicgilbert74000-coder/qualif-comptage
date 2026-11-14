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
  headFontFace: "Arial",
  bodyFontFace: "Arial",
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

pres.defineSlideMaster({ title: "DARK", background: { color: HEX.dk2 } });
pres.defineSlideMaster({
  title: "LIGHT", background: { color: HEX.white },
  slideNumber: { x: 9.2, y: 5.2, w: 0.5, h: 0.3, fontFace: "Arial", fontSize: 10, color: C.accent5 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.58, w: 8.8, h: 0.65, fontFace: "Arial", fontSize: 28, bold: true, color: C.text1, valign: "top", margin: 0 }, text: "" } }],
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
  let s = pres.addSlide({ masterName: "DARK" });
  s.addText("1 · LE PROBLÈME", { x: 0.6, y: 0.4, w: 5, h: 0.3, fontFace: "Arial", fontSize: 12, bold: true, color: C.accent6, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Sur-titre" });
  s.addText("Qualif-Comptage", { x: 0.6, y: 0.75, w: 4.3, h: 0.75, fontFace: "Arial", fontSize: 32, bold: true, color: C.background1, valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addText("Un compteur qui ment fausse toutes les décisions.", { x: 0.6, y: 1.55, w: 4.1, h: 0.95, fontFace: "Arial", fontSize: 22, italic: true, color: C.accent6, valign: "top", margin: 0, isTextBox: true, objectName: "Accroche" });
  const faults = [["FaClock", "Trous de relevé"], ["FaBolt", "Pics et valeurs négatives"], ["FaArrowDown", "Index qui baisse"], ["FaLock", "Compteur bloqué"]];
  faults.forEach((f, i) => {
    const y = 2.75 + i * 0.5;
    circleIcon(s, ic[f[0]], 0.6, y, 0.4, "E0533F", `Icône ${f[1]}`);
    s.addText(f[1], { x: 1.15, y, w: 3.5, h: 0.4, fontFace: "Arial", fontSize: 18, bold: true, color: C.background1, margin: 0, valign: "middle", isTextBox: true });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 5.0, y: 0.45, w: 4.4, h: 4.25, rectRadius: 0.08, fill: { color: PANEL }, line: { color: PANEL }, objectName: "Carte graphique" });
  s.addText("Gaz (simulé), 27 janvier : valeur figée à 0 pendant 6 h", { x: 5.2, y: 0.55, w: 4.0, h: 0.7, fontFace: "Arial", fontSize: 16, bold: true, color: C.background1, valign: "top", margin: 0, isTextBox: true, objectName: "Titre graphique" });
  s.addChart(pres.charts.LINE, [{ name: "Gaz (kWh/h, simulé)", labels: lab(sim.hero_labels, 12), values: sim.hero_raw }], {
    x: 5.1, y: 1.3, w: 4.2, h: 3.3, chartColors: ["5CC8FF"], lineSize: 3.5, lineDataSymbol: "none", showLegend: false,
    catAxisLabelColor: SOFT, valAxisLabelColor: SOFT, catAxisLabelFontSize: 12, valAxisLabelFontSize: 12,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFrequency: 1, catAxisLabelRotate: 0,
    valGridLine: { color: GRIDD, size: 0.75 }, catGridLine: { style: "none" }, displayBlanksAs: "gap",
  });
  s.addText("Aujourd'hui : repérage et correction à la main, sans trace.", { x: 0.6, y: 4.8, w: 8.8, h: 0.35, fontFace: "Arial", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "Constat" });
  s.addText("Saleh Bauch · Stéphane Bernardini · Loïc Gilbert · Sébastien Lavaud — Défi 3 : L'IA gardienne de la donnée", { x: 0.6, y: 5.2, w: 8.8, h: 0.3, fontFace: "Arial", fontSize: 12, color: SOFT, margin: 0, isTextBox: true, objectName: "Équipe et défi" });

  // ───────────── 2 — Solution (capture réelle numérotée)
  s = pres.addSlide({ masterName: "LIGHT" });
  s.addText("2 · LA SOLUTION", { x: 0.6, y: 0.28, w: 8.8, h: 0.26, fontFace: "Arial", fontSize: 13, bold: true, color: AMBER_TXT, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Repère de section" });
  s.addText("L'outil propose, la personne décide", { placeholder: "title", align: "left", valign: "top" });
  s.addText("On importe un CSV de n'importe quel fluide ; l'outil qualifie, propose une correction, puis garde la trace.", { x: 0.6, y: 1.3, w: 8.8, h: 0.55, fontFace: "Arial", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true, objectName: "Chapeau" });
  const IMG_X = 4.75, IMG_Y = 2.0, IMG_W = 4.75, IMG_H = 4.75 * 732 / 1276;
  s.addShape(pres.ShapeType.roundRect, { x: IMG_X - 0.1, y: IMG_Y - 0.1, w: IMG_W + 0.2, h: IMG_H + 0.2, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "CBD5E1", width: 1 }, objectName: "Cadre capture" });
  s.addImage({ path: path.join(__dirname, "capture-diagnostic.png"), x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H, altText: "Capture de l'application : zone Absence de relevé de 8 heures, diagnostic proposé, choix du correctif (profil type, interpolation linéaire, report), boutons Appliquer ou Valider en l'état", objectName: "Capture application" });
  s.addText("Capture réelle de l'application (données simulées)", { x: IMG_X - 0.1, y: IMG_Y + IMG_H + 0.18, w: 5.0, h: 0.28, fontFace: "Arial", fontSize: 12, italic: true, color: "475569", margin: 0, isTextBox: true, objectName: "Légende capture" });
  const marks = [
    ["Le diagnostic", "L'outil explique la panne et propose un correctif.", 0.30],
    ["Le choix", "Profil type, interpolation ou report au choix.", 0.60],
    ["La décision", "Appliquer ou valider ; tout est enregistré.", 0.93],
  ];
  marks.forEach((m, i) => {
    const y = 2.0 + i * 1.0;
    s.addShape(pres.ShapeType.ellipse, { x: 0.6, y, w: 0.42, h: 0.42, fill: { color: "F5A524" }, line: { color: "F5A524" }, objectName: `Pastille ${i + 1}` });
    s.addText(String(i + 1), { x: 0.6, y, w: 0.42, h: 0.42, fontFace: "Arial", fontSize: 18, bold: true, color: "0B1426", align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(m[0], { x: 1.2, y: y - 0.04, w: 3.0, h: 0.34, fontFace: "Arial", fontSize: 20, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(m[1], { x: 1.2, y: y + 0.32, w: 3.0, h: 0.6, fontFace: "Arial", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true });
    // pastille correspondante, sur la capture
    const py = IMG_Y + IMG_H * m[2] - 0.17;
    s.addShape(pres.ShapeType.ellipse, { x: IMG_X - 0.4, y: py, w: 0.34, h: 0.34, fill: { color: "F5A524" }, line: { color: "FFFFFF", width: 1.5 }, objectName: `Repère capture ${i + 1}` });
    s.addText(String(i + 1), { x: IMG_X - 0.4, y: py, w: 0.34, h: 0.34, fontFace: "Arial", fontSize: 14, bold: true, color: "0B1426", align: "center", valign: "middle", margin: 0, isTextBox: true });
  });

  // ───────────── 3 — Preuve
  s = pres.addSlide({ masterName: "LIGHT" });
  s.addText("3 · LA PREUVE", { x: 0.6, y: 0.28, w: 8.8, h: 0.26, fontFace: "Arial", fontSize: 13, bold: true, color: AMBER_TXT, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Repère de section" });
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
  const stats = [[`${sim.ncorr}`, "points corrigés", AMBER_TXT], [`${sim.err_pct} %`, "d'écart moyen avec la vraie valeur", TEAL_TXT], ["4/4", "pannes injectées détectées", AMBER_TXT]];
  stats.forEach((st, i) => {
    const y = 1.3 + i * 1.22;
    s.addShape(pres.ShapeType.roundRect, { x: 7.2, y, w: 2.3, h: 1.1, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Carte chiffre ${i + 1}` });
    s.addText(st[0], { x: 7.35, y: y + 0.06, w: 2.0, h: 0.55, fontFace: "Arial", fontSize: 32, bold: true, color: st[2], margin: 0, isTextBox: true });
    s.addText(st[1], { x: 7.35, y: y + 0.62, w: 2.05, h: 0.45, fontFace: "Arial", fontSize: 13, color: INK, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Série horaire simulée sur 28 jours, pannes injectées, corrigée par le moteur du code.", { x: 0.5, y: 5.0, w: 8.4, h: 0.3, fontFace: "Arial", fontSize: 12, italic: true, color: "475569", margin: 0, isTextBox: true, objectName: "Source" });

  // ───────────── 4 — Le défi, point par point
  s = pres.addSlide({ masterName: "LIGHT" });
  s.addText("4 · OÙ EN EST-ON ?", { x: 0.6, y: 0.28, w: 8.8, h: 0.26, fontFace: "Arial", fontSize: 13, bold: true, color: AMBER_TXT, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Repère de section" });
  s.addText("Le défi 3, point par point", { placeholder: "title", align: "left", valign: "top" });
  const rows = [
    ["Couvert", "0B6B5F", "Détecter les anomalies", "10 types · 50/50 anomalies injectées détectées (benchmark de l'audit)"],
    ["Partiel", "B45309", "Qualifier chaque valeur", "4 statuts aujourd'hui ; « mesuré / estimé / hypothèse » à ajouter"],
    ["Partiel", "B45309", "Tracer chaque hypothèse", "Valeur brute conservée ; historique par dossier seulement"],
    ["Absent", "B3261E", "Veiller en continu", "CSV déposés à la main : pas de planificateur ni d'alertes"],
  ];
  rows.forEach((r, i) => {
    const y = 1.3 + i * 0.85;
    s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: y + 0.12, w: 1.25, h: 0.45, rectRadius: 0.22, fill: { color: r[1] }, line: { color: r[1] }, objectName: `Pastille ${r[2]}` });
    s.addText(r[0], { x: 0.6, y: y + 0.12, w: 1.25, h: 0.45, fontFace: "Arial", fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(r[2], { x: 2.1, y, w: 7.3, h: 0.38, fontFace: "Arial", fontSize: 20, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
    s.addText(r[3], { x: 2.1, y: y + 0.38, w: 7.3, h: 0.4, fontFace: "Arial", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Pas d'apprentissage : le diagnostic « IA » repose sur des règles. Défauts connus (audit) : import sur valeur vide, faux positifs en horaire.", { x: 0.6, y: 4.7, w: 8.4, h: 0.65, fontFace: "Arial", fontSize: 16, italic: true, color: INK, margin: 0, valign: "top", isTextBox: true, objectName: "Défauts connus" });

  // ───────────── 5 — Impact, reprise, suite (clair, sans bloc décoratif)
  s = pres.addSlide({ masterName: "LIGHT" });
  s.addText("5 · IMPACT ET SUITE", { x: 0.6, y: 0.28, w: 8.8, h: 0.26, fontFace: "Arial", fontSize: 13, bold: true, color: AMBER_TXT, charSpacing: 3, margin: 0, isTextBox: true, objectName: "Repère de section" });
  s.addText("Ce que ça change, et la suite", { placeholder: "title", align: "left", valign: "top" });
  const head = (txt, x, w) => s.addText(txt, { x, y: 1.4, w, h: 0.3, fontFace: "Arial", fontSize: 13, bold: true, color: AMBER_TXT, charSpacing: 2, margin: 0, isTextBox: true, objectName: `Rubrique ${txt}` });
  head("CE QUE ÇA CHANGE", 0.6, 3.0);
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.8, w: 3.0, h: 3.0, rectRadius: 0.08, fill: { color: "FFF3DC" }, line: { color: "F5A524", width: 1.5 }, objectName: "Carte impact" });
  s.addText("≈ 750 h par an", { x: 0.8, y: 1.95, w: 2.65, h: 0.6, fontFace: "Arial", fontSize: 28, bold: true, color: AMBER_TXT, margin: 0, valign: "top", isTextBox: true, objectName: "Chiffre impact" });
  s.addText("de correction manuelle évitées", { x: 0.8, y: 2.6, w: 2.65, h: 0.65, fontFace: "Arial", fontSize: 18, bold: true, color: INK, margin: 0, valign: "top", isTextBox: true });
  s.addText("Estimation pour 1 000 compteurs : 5 zones à traiter par compteur et par an, 10 min à la main contre 1 min avec l'outil.", { x: 0.8, y: 3.35, w: 2.65, h: 1.3, fontFace: "Arial", fontSize: 14, color: INK, margin: 0, valign: "top", isTextBox: true, objectName: "Hypothèses impact" });
  head("POUR LA VILLE", 3.95, 3.4);
  const pts = [
    ["Reprenable : ", "code ouvert (licence MIT), exécutable sans installation ou Docker."],
    ["Transposable : ", "aucun fluide codé en dur, donc d'autres services et d'autres communes."],
    ["Suite : ", "statuts « mesuré / estimé / hypothèse », trace par point, veille continue."],
  ];
  s.addText(pts.map((p, i) => [{ text: p[0], options: { bold: true, breakLine: false } }, { text: p[1], options: { breakLine: i < pts.length - 1 } }]).flat(), { x: 3.95, y: 1.8, w: 3.4, h: 3.0, fontFace: "Arial", fontSize: 16, color: INK, margin: 0, valign: "top", paraSpaceAfter: 12, isTextBox: true, objectName: "Pour la Ville" });
  head("CODE SOURCE", 7.7, 1.8);
  s.addShape(pres.ShapeType.roundRect, { x: 7.7, y: 1.8, w: 1.8, h: 2.35, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "CBD5E1", width: 1 }, objectName: "Carte QR" });
  s.addImage({ path: path.join(__dirname, "qr-depot.png"), x: 7.8, y: 1.9, w: 1.6, h: 1.6, altText: "QR code vers le dépôt GitHub loicgilbert74000-coder/qualif-comptage", objectName: "QR code dépôt" });
  s.addText("Scannez : le dépôt est public", { x: 7.75, y: 3.55, w: 1.7, h: 0.55, fontFace: "Arial", fontSize: 13, bold: true, color: INK, align: "center", valign: "top", margin: 0, isTextBox: true, objectName: "Légende QR" });

  // Notes (≈ 3 min, ~430 mots)
  const N = fs.readFileSync(path.join(__dirname, "notes.json"), "utf8");
  const notes = JSON.parse(N);
  pres.slides.forEach((sl, i) => sl.addNotes(notes[i]));

  const out = path.join(__dirname, "qualif-comptage-pitch.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  // Correctif : pptxgenjs écrit les valeurs absentes comme <c:pt><c:v></c:v></c:pt> (nombre vide, invalide).
  // On supprime ces points : un indice manquant = trou dans la courbe, ce que PowerPoint attend.
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async("string");
    zip.file(name, xml.replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, ""));
  }
  const clean = new JSZip();
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue; // pas d'entrées de dossier dans l'archive
    clean.file(name, await zip.file(name).async("nodebuffer"), { createFolders: false });
  }
  fs.writeFileSync(out, await clean.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("ok", out);
})();
