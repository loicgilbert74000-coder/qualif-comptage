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

  const INK = "14213D";      // texte principal sur fond clair
  const AMBER_TXT = "9A4A00"; // orange foncé : texte sur fond clair (contraste ≥ 5:1)
  const TEAL_TXT = "0B6B5F";
  const SOFT = "E6EBF5";      // texte secondaire sur fond sombre

  pres.addSection({ title: "Ouverture et problème" });
  // 1 — Titre + problème
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Ouverture et problème" });
  s.addText("Qualif-Comptage", { x: 0.6, y: 0.35, w: 8.8, h: 0.8, fontFace: "Cambria", fontSize: 44, bold: true, color: C.background1, align: "left", valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addText("Sans données de comptage fiables, pas de sortie du fossile pilotable.", { x: 0.6, y: 1.2, w: 8.8, h: 0.5, fontFace: "Calibri", fontSize: 22, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Accroche" });
  const faults = [
    ["FaClock", "Trous", "Heures ou jours sans relevé"],
    ["FaBolt", "Pics et négatifs", "Un zéro en trop, une virgule décalée"],
    ["FaArrowDown", "Index qui baisse", "Remplacement ou erreur de saisie ?"],
    ["FaLock", "Bloqué", "Valeur figée en pleine saison de chauffe"],
  ];
  faults.forEach((f, i) => {
    const x = 0.6 + i * 2.25, y = 1.95;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.05, h: 2.3, rectRadius: 0.08, fill: { color: "1F3A66" }, line: { color: "1F3A66" }, objectName: `Carte ${f[1]}` });
    circleIcon(s, ic[f[0]], x + 0.2, y + 0.18, 0.6, "E0533F", `Icône ${f[1]}`);
    s.addText(f[1], { x: x + 0.2, y: y + 0.92, w: 1.7, h: 0.4, fontFace: "Calibri", fontSize: 18, bold: true, color: C.background1, margin: 0, valign: "top", isTextBox: true });
    s.addText(f[2], { x: x + 0.2, y: y + 1.36, w: 1.7, h: 0.85, fontFace: "Calibri", fontSize: 16, color: C.background1, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Aujourd'hui : correction à la main, compteur par compteur, sans trace.", { x: 0.6, y: 4.4, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 20, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "Constat" });
  s.addText("Énerg-IACK 2026 · Défi 3 : L'IA gardienne de la donnée\nSaleh Bauch, Stéphane Bernardini, Loïc Gilbert, Sébastien Lavaud", { x: 0.6, y: 4.85, w: 8.8, h: 0.55, fontFace: "Calibri", fontSize: 14, color: SOFT, margin: 0, valign: "top", isTextBox: true, objectName: "Équipe et défi" });

  // 2 — Solution
  pres.addSection({ title: "Solution" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Solution" });
  s.addText("Importer, qualifier, corriger, tracer", { placeholder: "title", align: "left", valign: "top" });
  const steps = [
    ["FaFileUpload", "Importer", "CSV de tout fluide : électricité, gaz, eau, chaleur"],
    ["FaSearch", "Qualifier", "Trous, pics, index en baisse, paliers, avec un score par compteur"],
    ["FaMagic", "Corriger", "Profil type, interpolation ou report : la personne choisit"],
    ["FaHistory", "Tracer", "Chaque validation ou refus est enregistré"],
  ];
  steps.forEach((st, i) => {
    const x = 0.6 + i * 2.25, y = 1.5;
    circleIcon(s, ic[st[0]], x, y, 0.9, i === 2 ? "C2620A" : "0B6B5F", `Étape ${st[1]}`);
    s.addText(`${i + 1}. ${st[1]}`, { x, y: y + 1.1, w: 2.1, h: 0.45, fontFace: "Cambria", fontSize: 22, bold: true, color: INK, margin: 0, isTextBox: true });
    s.addText(st[2], { x, y: y + 1.65, w: 2.05, h: 1.5, fontFace: "Calibri", fontSize: 16, color: INK, margin: 0, valign: "top", isTextBox: true });
    if (i < 3) s.addText("›", { x: x + 1.2, y: y + 0.05, w: 0.9, h: 0.8, fontFace: "Calibri", fontSize: 40, bold: true, color: "64748B", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `Flèche ${i + 1}` });
  });
  s.addText("L'outil propose, la personne décide.", { x: 0.6, y: 4.6, w: 8.8, h: 0.45, fontFace: "Calibri", fontSize: 22, bold: true, color: INK, margin: 0, isTextBox: true, objectName: "Principe" });

  // 3 — Preuve
  pres.addSection({ title: "Preuve" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Preuve" });
  s.addText("Preuve : 8 h de gaz reconstruites", { placeholder: "title", align: "left", valign: "top" });
  const labels = sim.labels.map((l, i) => (i % 12 === 0 ? (i % 24 === 0 ? l.slice(0, 5) : "12h") : " ")), raw = sim.raw, rec = sim.rec;
  const gapIdx = raw.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const lo = Math.min(...gapIdx) - 1, hi = Math.max(...gapIdx) + 1;
  const recGap = rec.map((v, i) => (i >= lo && i <= hi ? v : null));
  s.addChart(pres.charts.LINE, [
    { name: "Mesure brute (trou le 22/01)", labels, values: raw },
    { name: "Reconstruit par profil type", labels, values: recGap },
  ], {
    x: 0.5, y: 1.3, w: 6.5, h: 3.6, chartColors: [INK, "E8890C"], lineSize: 3.5, lineDataSymbol: "none",
    showLegend: true, legendPos: "b", legendFontSize: 13, legendColor: INK, legendFontFace: "+mn-lt",
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

  // 4 — Honnêteté
  pres.addSection({ title: "Limites et reprise" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Limites et reprise" });
  s.addText("Ce qui marche, ce qui reste à faire", { placeholder: "title", align: "left", valign: "top" });
  const col = (x, head, color, icn, items) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.3, w: 4.3, h: 3.7, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Carte ${head}` });
    circleIcon(s, ic[icn], x + 0.25, 1.5, 0.6, color, `Icône ${head}`);
    s.addText(head, { x: x + 1.05, y: 1.5, w: 3.0, h: 0.6, fontFace: "Cambria", fontSize: 24, bold: true, color: INK, margin: 0, valign: "middle", isTextBox: true });
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), { x: x + 0.25, y: 2.3, w: 3.85, h: 2.6, fontFace: "Calibri", fontSize: 16, color: INK, margin: 0, valign: "top", paraSpaceAfter: 8, isTextBox: true, objectName: `Liste ${head}` });
  };
  col(0.6, "Ça marche", "0B6B5F", "FaCheck", ["10 types d'anomalies détectés, seuils réglables", "Reconstruction avec repli en cascade", "Exécutable sans installation", "18 tests passés, historique des traitements"]);
  col(5.1, "Pas encore", "B3261E", "FaTimes", ["Diagnostic « IA » = des règles, pas un modèle entraîné", "Pas de veille continue (CSV déposés à la main)", "Défauts connus (audit) : import sur valeur vide, faux positifs en horaire", "Preuve sur données simulées"]);

  // 5 — Impact + suite
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
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.5, w: 2.0, h: 2.3, rectRadius: 0.08, fill: { color: "1F3A66" }, line: { color: "1F3A66" }, objectName: `Carte ${cd[1]}` });
    circleIcon(s, ic[cd[0]], x + 0.2, 2.65, 0.55, "F5A524", `Icône ${cd[1]}`);
    s.addText(cd[1], { x: x + 0.2, y: 3.3, w: 1.65, h: 0.4, fontFace: "Cambria", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true });
    s.addText(cd[2], { x: x + 0.2, y: 3.75, w: 1.65, h: 1.0, fontFace: "Calibri", fontSize: 16, color: C.background1, margin: 0, valign: "top", isTextBox: true });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 7.05, y: 2.5, w: 2.35, h: 2.3, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" }, objectName: "Carte QR" });
  s.addImage({ path: path.join(__dirname, "qr-depot.png"), x: 7.4, y: 2.6, w: 1.65, h: 1.65, altText: "QR code vers le dépôt GitHub loicgilbert74000-coder/qualif-comptage", objectName: "QR code dépôt" });
  s.addText("Code source : scannez", { x: 7.1, y: 4.3, w: 2.25, h: 0.4, fontFace: "Calibri", fontSize: 14, bold: true, color: "0B1426", align: "center", margin: 0, isTextBox: true, objectName: "Légende QR" });
  s.addText("Suite : détecter les ruptures communes à plusieurs compteurs d'un même automate.", { x: 0.6, y: 4.95, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 16, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Suite" });

  // Notes (≈ 3 min, ~430 mots)
  const N = fs.readFileSync(path.join(__dirname, "notes.json"), "utf8");
  const notes = JSON.parse(N);
  pres.slides.forEach((sl, i) => sl.addNotes(notes[i]));

  const out = path.join(__dirname, "qualif-comptage-pitch.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("ok", out);
})();
