"""Génère fiche-projet.docx (une page) sur le modèle EIAK-Fiche-Projet-v1."""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROWS = [
 ("Nom de l'équipe", "", "Pas de nom d'équipe — projet « Qualif-Comptage »"),
 ("Membres (prénoms)", "", "Saleh, Stéphane, Loïc, Sébastien"),
 ("Défi traité", "numéro et titre", "Défi 3 : L'IA gardienne de la donnée"),
 ("Notre réponse, en une phrase", "", "Un outil qui repère les erreurs des données de compteurs (trous, pics, index en baisse, compteur bloqué), propose une correction que la personne valide ou refuse, et garde la trace de chaque décision."),
 ("Ce que nous avons construit", "ce que fait le prototype, comment l'utiliser",
  "Application web (ou exécutable Windows/Linux). On importe un CSV de relevés, quel que soit le fluide ; l'outil calcule un score de qualité par compteur et liste les zones à traiter. Pour chaque zone : diagnostic, aperçu de la correction sur la courbe (profil type, interpolation ou report), validation ou refus, puis export CSV/JSON. Tout est inscrit dans l'historique."),
 ("Les données utilisées", "jeux du défi, autres sources, ce que nous en avons fait",
  "Fichiers CSV de relevés du défi (électricité, gaz, eau, chaleur…), lus avec détection automatique des colonnes et du type de mesure. Pour la preuve chiffrée : une série horaire de gaz simulée sur 28 jours, avec pannes injectées. [À confirmer : jeux du défi effectivement chargés]"),
 ("Outils et assistants d'IA employés", "à déclarer au rendu (règlement, art. 5.4)",
  "Claude (Anthropic) via Claude Code : support de pitch, notes et script de simulation. [À compléter : autres assistants utilisés pour le code]"),
 ("Ce qui marche, ce qui ne marche pas encore", "soyez honnêtes : c'est un critère",
  "Marche : détection de 10 types d'anomalies à seuils réglables (50/50 anomalies injectées détectées sur le benchmark synthétique de l'audit), reconstruction avec repli en cascade, historique, export. Pas encore : diagnostic « IA » = règles, pas un modèle entraîné ; pas de veille continue ; défauts connus (import qui plante sur une valeur vide, faux positifs en pas horaire), voir docs/AUDIT_DEFI3.md ; preuves sur données simulées ; pas d'authentification."),
 ("Ce que ça change", "kWh, CO₂, temps, argent — un ordre de grandeur suffit",
  "Des consommations fiables pour piloter la sortie du fossile, et moins de temps perdu à nettoyer les données à la main. Sur la série simulée : 21 points corrigés, écart moyen de 3,3 % avec la vraie valeur. Ordre de grandeur (hypothèse : 5 zones/compteur/an, 10 min à la main contre 1 min) : ≈ 750 h/an évitées pour 1 000 compteurs."),
 ("Pour que la Ville le reprenne", "licence, technologies, ce qu'il faudrait pour continuer",
  "Technologies courantes : Python (FastAPI), React, SQLite ou PostgreSQL, Docker. Aucun fluide codé en dur. Licence MIT. Pour continuer : données réelles, authentification, export de rapports."),
 ("Code source", "lien vers le dépôt", "https://github.com/loicgilbert74000-coder/qualif-comptage  (dépôt public, licence MIT)"),
]
HEIGHTS = {}
d = Document()
sec = d.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(1.5); sec.top_margin = Cm(1.2); sec.bottom_margin = Cm(1.0)
st = d.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(9)
st.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")

def para(text, size, bold=False, color=None, align=None, italic=False, after=2):
    p = d.add_paragraph(); r = p.add_run(text); r.font.size = Pt(size); r.bold = bold; r.italic = italic
    if color: r.font.color.rgb = RGBColor.from_string(color)
    if align: p.alignment = align
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.space_before = Pt(0)
    return p
para("ÉNERG-IACK · ÉDITION 2026 · FICHE PROJET", 9, True, "0B3D91", WD_ALIGN_PARAGRAPH.CENTER)
para("Fiche projet", 20, True, "14213D", WD_ALIGN_PARAGRAPH.CENTER, after=6)

t = d.add_table(rows=0, cols=2); t.style = "Table Grid"; t.autofit = False
def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr(); s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear"); s.set(qn("w:fill"), hexcolor); tcPr.append(s)
for label, hint, text in ROWS:
    c = t.add_row().cells
    c[0].width, c[1].width = Cm(4.6), Cm(13.4)
    shade(c[0], "EEF2F7")
    p = c[0].paragraphs[0]; r = p.add_run(label); r.bold = True; r.font.size = Pt(10)
    p.paragraph_format.space_after = Pt(0)
    if hint:
        p2 = c[0].add_paragraph(); r2 = p2.add_run(hint); r2.italic = True; r2.font.size = Pt(7.5)
        r2.font.color.rgb = RGBColor.from_string("64748B"); p2.paragraph_format.space_after = Pt(0)
    q = c[1].paragraphs[0]; rr = q.add_run(text); rr.font.size = Pt(10); q.paragraph_format.space_after = Pt(0)
t.columns[0].width, t.columns[1].width = Cm(4.6), Cm(13.4)
para("", 4, after=0)
para("Une page au plus : le jury n'en lira pas davantage.", 8, italic=True, color="64748B")
d.save("fiche-projet.docx")
