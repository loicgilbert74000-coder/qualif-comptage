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

  pres.addSection({ title: "Ouverture et problème" });
  // 1 — Titre + problème
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Ouverture et problème" });
  s.addText("Qualif-Comptage", { x: 0.6, y: 0.4, w: 8.8, h: 0.8, fontFace: "Cambria", fontSize: 40, bold: true, color: C.background1, align: "left", valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addText("Sans données de comptage fiables, pas de sortie du fossile pilotable.", { x: 0.6, y: 1.2, w: 8.8, h: 0.45, fontFace: "Calibri", fontSize: 20, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Accroche" });
  const faults = [
    ["FaClock", "Trous", "Relevés absents pendant des heures ou des jours"],
    ["FaBolt", "Pics et négatifs", "Un zéro en trop, une virgule décalée"],
    ["FaArrowDown", "Index qui baisse", "Remplacement de compteur, ou erreur de saisie ?"],
    ["FaLock", "Compteur bloqué", "Une valeur figée en pleine saison de chauffe"],
  ];
  faults.forEach((f, i) => {
    const x = 0.6 + i * 2.25, y = 1.95;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.05, h: 2.1, rectRadius: 0.08, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: `Carte ${f[1]}` });
    circleIcon(s, ic[f[0]], x + 0.2, y + 0.18, 0.55, C.accent3, `Icône ${f[1]}`);
    s.addText(f[1], { x: x + 0.2, y: y + 0.85, w: 1.7, h: 0.5, fontFace: "Calibri", fontSize: 16, bold: true, color: C.background1, margin: 0, valign: "top", isTextBox: true });
    s.addText(f[2], { x: x + 0.2, y: y + 1.3, w: 1.7, h: 0.7, fontFace: "Calibri", fontSize: 14, color: "D5DCEA", margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Aujourd'hui : correction à la main, compteur par compteur, sans trace.", { x: 0.6, y: 4.25, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "Constat" });
  s.addText("Énerg-IACK 2026 · Défi 3 : L'IA gardienne de la donnée · Saleh Bauch, Stéphane Bernardini, Loïc Gilbert, Sébastien Lavaud", { x: 0.6, y: 4.85, w: 8.8, h: 0.5, fontFace: "Calibri", fontSize: 12, color: "B8C2D6", margin: 0, isTextBox: true, objectName: "Équipe et défi" });

  // 3 — Solution
  pres.addSection({ title: "Solution" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Solution" });
  s.addText("Un outil : importer, qualifier, corriger, tracer", { placeholder: "title", align: "left", valign: "top", fontSize: 28 });
  const steps = [
    ["FaFileUpload", "Importer", "CSV de n'importe quel fluide : électricité, gaz, eau, chaleur, mazout…"],
    ["FaSearch", "Qualifier", "Trous, pics, index en baisse, paliers : score de qualité par compteur"],
    ["FaMagic", "Corriger", "Profil type du compteur, interpolation ou report, au choix de la personne"],
    ["FaHistory", "Tracer", "Chaque validation ou refus est inscrit dans l'historique"],
  ];
  steps.forEach((st, i) => {
    const x = 0.6 + i * 2.25, y = 1.6;
    circleIcon(s, ic[st[0]], x, y, 0.8, i === 2 ? C.accent1 : C.accent2, `Étape ${st[1]}`);
    s.addText(`${i + 1}. ${st[1]}`, { x, y: y + 1.0, w: 2.05, h: 0.4, fontFace: "Cambria", fontSize: 20, bold: true, color: C.text1, margin: 0, isTextBox: true });
    s.addText(st[2], { x, y: y + 1.45, w: 2.0, h: 1.3, fontFace: "Calibri", fontSize: 14, color: C.accent5, margin: 0, valign: "top", isTextBox: true });
    if (i < 3) s.addShape(pres.ShapeType.rightArrow, { x: x + 0.95, y: y + 0.27, w: 0.9, h: 0.26, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Flèche ${i + 1}` });
  });
  s.addText("Le modèle ne remplace pas l'expert : il propose, la personne décide.", { x: 0.6, y: 4.6, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 16, italic: true, color: C.text1, margin: 0, isTextBox: true, objectName: "Principe" });

  // 4 — Preuve
  pres.addSection({ title: "Preuve" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Preuve" });
  s.addText("Preuve : 8 h de gaz manquantes, reconstruites", { placeholder: "title", align: "left", valign: "top", fontSize: 28 });
  const labels = sim.labels, raw = sim.raw, rec = sim.rec;
  // série « reconstruit » : uniquement sur le trou (+ 1 point de chaque côté pour relier)
  const gapIdx = raw.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const lo = Math.min(...gapIdx) - 1, hi = Math.max(...gapIdx) + 1;
  const recGap = rec.map((v, i) => (i >= lo && i <= hi ? v : null));
  s.addChart(pres.charts.LINE, [
    { name: "Mesure brute (trou 22/01, 6h–13h)", labels, values: raw },
    { name: "Reconstruit par profil type", labels, values: recGap },
  ], {
    x: 0.5, y: 1.4, w: 6.4, h: 3.4, chartColors: [HEX.a5, HEX.a1], lineSize: 2.5, lineDataSymbol: "none",
    showLegend: true, legendPos: "b", legendFontSize: 11, legendColor: HEX.dk1, legendFontFace: "+mn-lt",
    catAxisLabelColor: HEX.a5, valAxisLabelColor: HEX.a5, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFrequency: 6, catAxisLabelRotate: 0,
    valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" },
    showValAxisTitle: true, valAxisTitle: "kWh / h (simulé)", valAxisTitleFontSize: 10, valAxisTitleColor: HEX.a5, valAxisTitleFontFace: "+mn-lt",
    displayBlanksAs: "gap",
  });
  const stats = [[`${sim.ncorr}`, "points corrigés\n(8 manquants, 13 incohérents)"], [`${sim.err_pct} %`, "écart moyen avec\nla vraie valeur"], ["50/50", "anomalies injectées\ndétectées (audit)"]];
  stats.forEach((st, i) => {
    const y = 1.35 + i * 1.18;
    s.addShape(pres.ShapeType.roundRect, { x: 7.15, y, w: 2.35, h: 1.05, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Carte chiffre ${i + 1}` });
    s.addText(st[0], { x: 7.3, y: y + 0.08, w: 2.1, h: 0.5, fontFace: "Cambria", fontSize: 28, bold: true, color: i === 1 ? C.accent2 : C.accent1, margin: 0, isTextBox: true });
    s.addText(st[1], { x: 7.3, y: y + 0.56, w: 2.1, h: 0.45, fontFace: "Calibri", fontSize: 11, color: C.text1, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Série horaire simulée (28 jours, pannes injectées), analysée et corrigée par le vrai moteur du code.", { x: 0.5, y: 4.9, w: 8.4, h: 0.3, fontFace: "Calibri", fontSize: 10, italic: true, color: C.accent5, margin: 0, isTextBox: true, objectName: "Source" });

  // 5 — Honnêteté + reprise
  pres.addSection({ title: "Limites et reprise" });
  s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Limites et reprise" });
  s.addText("Ce qui marche, ce qui reste à faire", { placeholder: "title", align: "left", valign: "top" });
  const col = (x, head, color, icn, items) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.4, w: 4.3, h: 3.3, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Carte ${head}` });
    circleIcon(s, ic[icn], x + 0.25, 1.6, 0.5, color, `Icône ${head}`);
    s.addText(head, { x: x + 0.9, y: 1.6, w: 3.2, h: 0.5, fontFace: "Cambria", fontSize: 20, bold: true, color: C.text1, margin: 0, valign: "middle", isTextBox: true });
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), { x: x + 0.25, y: 2.3, w: 3.85, h: 2.6, fontFace: "Calibri", fontSize: 14, color: C.text1, margin: 0, valign: "top", paraSpaceAfter: 6, isTextBox: true, objectName: `Liste ${head}` });
  };
  col(0.6, "Ça marche", C.accent2, "FaCheck", ["10 types d'anomalies détectés, seuils réglables", "Reconstruction avec repli en cascade", "Exécutable Windows/Linux, sans installation", "18 tests passés, historique des traitements"]);
  col(5.1, "Pas encore", C.accent3, "FaTimes", ["Le diagnostic « IA » est un jeu de règles, pas un modèle entraîné", "Pas de veille continue : CSV déposés à la main", "Défauts connus (audit) : import sur valeur vide, faux positifs en horaire", "Preuve sur données simulées"]);

  // 6 — Impact + suite
  pres.addSection({ title: "Impact et suite" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Impact et suite" });
  s.addText("Des décisions fondées sur des données saines", { x: 0.6, y: 0.4, w: 8.8, h: 0.7, fontFace: "Cambria", fontSize: 30, bold: true, color: C.background1, align: "left", valign: "top", margin: 0, isTextBox: true, objectName: "Titre" });
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.2, w: 8.8, h: 0.95, rectRadius: 0.08, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: "Bandeau impact" });
  s.addText("≈ 750 h / an", { x: 0.8, y: 1.2, w: 2.9, h: 0.95, fontFace: "Cambria", fontSize: 32, bold: true, color: C.text2, margin: 0, valign: "middle", isTextBox: true, objectName: "Chiffre impact" });
  s.addText("de correction manuelle évitées pour 1 000 compteurs. Hypothèses : 5 zones à traiter par compteur et par an, 10 min à la main contre 1 min avec l'outil.", { x: 3.75, y: 1.2, w: 5.5, h: 0.95, fontFace: "Calibri", fontSize: 14, color: C.text2, margin: 0, valign: "middle", isTextBox: true, objectName: "Hypothèses impact" });
  const cards = [
    ["FaBalanceScale", "Pour la Ville", "Moins de temps perdu à nettoyer, des consommations fiables pour piloter et décider"],
    ["FaGlobe", "Transposable", "Aucun fluide codé en dur : autres services, autres communes"],
    ["FaCodeBranch", "Reprenable", "Code ouvert (FastAPI, React, SQLite/PostgreSQL), Docker ou .exe"],
  ];
  cards.forEach((cd, i) => {
    const x = 0.6 + i * 3.0;
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.4, w: 2.8, h: 2.3, rectRadius: 0.08, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: `Carte ${cd[1]}` });
    circleIcon(s, ic[cd[0]], x + 0.25, 2.6, 0.55, C.accent1, `Icône ${cd[1]}`);
    s.addText(cd[1], { x: x + 0.25, y: 3.3, w: 2.4, h: 0.4, fontFace: "Cambria", fontSize: 18, bold: true, color: C.background1, margin: 0, isTextBox: true });
    s.addText(cd[2], { x: x + 0.25, y: 3.7, w: 2.4, h: 0.95, fontFace: "Calibri", fontSize: 14, color: "D5DCEA", margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Suite : détecter les ruptures communes à plusieurs compteurs d'un même automate.", { x: 0.6, y: 4.9, w: 8.8, h: 0.4, fontFace: "Calibri", fontSize: 14, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Suite" });

  // Notes (≈ 3 min, ~430 mots)
  const N = fs.readFileSync(path.join(__dirname, "notes.json"), "utf8");
  const notes = JSON.parse(N);
  pres.slides.forEach((sl, i) => sl.addNotes(notes[i]));

  const out = path.join(__dirname, "qualif-comptage-pitch.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("ok", out);
})();
