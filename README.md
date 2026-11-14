# Qualification des données de comptage

Application de **contrôle, qualification et reconstruction par simulation** de
données de compteurs, quel que soit le type de compteur (électricité, gaz,
eau, chaleur, mazout, granulés, sous-compteurs, livraisons…). L'interface
reprend fidèlement la maquette fournie (contrôle, qualification et
préparation des données de compteurs des bâtiments).

## Ce que fait l'application

1. **Importer** un fichier CSV ou un dossier de fichiers CSV de relevés de
   compteurs, quel que soit le fluide mesuré. Le mapping des colonnes
   (horodatage, id_compteur, valeur, unité…) est détecté automatiquement à
   partir des en-têtes les plus courants, en français ou en anglais.
2. **Qualifier et analyser** : détection automatique des valeurs manquantes
   (trous dans la série), des incohérences (pics, chutes, valeurs négatives,
   paliers suspects / compteur bloqué) et calcul d'un score de qualité par
   compteur et par import.
3. **Valider, traiter et reconstruire** : en un clic, les valeurs manquantes
   sont comblées et les incohérences lissées par **simulation**, à partir
   d'un profil type appris sur l'historique propre du compteur (même
   heure/jour de semaine/mois selon la granularité détectée), avec repli sur
   une interpolation linéaire puis un report de la valeur la plus proche.
   Chaque action (analyse, réanalyse, refus, validation) est tracée dans
   l'historique des traitements.

## Architecture

```
backend/   FastAPI + SQLAlchemy + PostgreSQL
  app/
    models/      Bâtiments, compteurs, imports, relevés, anomalies, historique, paramètres
    services/    Parsing CSV générique, moteur de qualité, moteur de reconstruction/simulation
    routers/     API REST (/api/imports, /api/buildings, /api/history, /api/settings)
  tests/         Tests du moteur de qualité et de reconstruction (pytest)

frontend/  React + TypeScript + Vite + Tailwind + Recharts
  src/pages/        Les 5 pages de la barre latérale
  src/components/   Graphique, tableaux, indicateur d'étapes, etc.
```

Le modèle de données ne code en dur aucun type de fluide : `fluid_type`,
`unit` et `role` sont des champs libres sur chaque compteur, renseignés à
partir du fichier importé (ou déduits du code du compteur). Un nouveau type
de compteur n'exige donc aucune modification du schéma ou du code.

À l'import, le classificateur combine les colonnes explicites (`fluide`,
`mesure`, `unite`), les suffixes d'identifiant et le nom du fichier. Il
sépare le vecteur (`électricité`, `chaleur`, `froid`, `gaz`, `eau froide`,
`ECS`, `granulés`, `bois`, `fuel`) du rôle (`consommation`, `production`,
`injection`, `livraison`, sous-compteur chaud/froid/ECS, CAD ou FAD). Une
unité seule comme `kWh` ou `m³` ne suffit pas à déterminer le fluide.

La nature de la mesure est classée séparément : `consommation` pour une
quantité sur une période, `index` pour une valeur cumulée, `livraison` pour
un apport ponctuel, `niveau_stock` pour une jauge, ou `indéterminé` quand les
indices du fichier ne suffisent pas. Une mise à niveau légère ajoute cette
colonne aux bases SQLite et PostgreSQL déjà créées.

Sur les exports Rive-Claire, les identifiants sont notamment interprétés ainsi :
`*-EL` = soutirage électrique, `*-PV` = production photovoltaïque,
`*-EL-INJ` = injection électrique, `*-CAD` = chaleur du réseau CAD,
`*-CH-PAC` = chaleur produite par PAC, `*-GZ` = gaz et `*-EAU` = eau froide.
Les fichiers d'un même dossier sont détectés séparément, car leurs colonnes de
date et de valeur peuvent différer (quart d'heure, heure ou jour).

Les en-têtes `index` et les libellés tels que `Index Gaz 1` sont reconnus comme
index. Les en-têtes `consommation_kwh`, `variation_kwh`, `volume_m3` et
`energie_kwh` indiquent une quantité par période. La série `valeur_acquisition`
du fichier `cas2-gaz-sig-horaire` est traitée comme une consommation en m³,
conformément au guide de ce jeu de données, malgré son unité affichée erronée.

### Critères de détection et exemples

Les seuils comparent chaque mesure à l'historique du même mois et du même
créneau d'usage (jour de semaine/heure). Si l'historique comparable est trop
court, le moteur n'invente pas de référence et ne déclenche pas les règles
saisonnières.

| Critère | Règle | Exemple illustratif |
|---|---|---|
| Index en baisse | Toute valeur d'index inférieure à la précédente est signalée. Un index remis à zéro n'est exempté que si `service_start` confirme un remplacement ce jour-là. | `12 540 → 87` sans remplacement déclaré : anomalie à vérifier. |
| Index plat en saison active | Au moins 4 pas consécutifs sans hausse, alors que 3 pas comparables ou plus ont déjà augmenté dans ce créneau saisonnier. | Index identique à `102,4` pendant quatre quarts d'heure d'un créneau où les hivers précédents progressaient. |
| Valeur nulle | Une ligne présente dont la valeur est vide/nulle est distinguée d'un relevé entièrement absent. | `2025-02-03 10:00;` : `valeur_nulle`; une ligne manquante à 10:15 : `absence_releve`. |
| Horodatage irrégulier | Les intervalles observés sont comparés au pas le plus fréquent. Un écart égal à plusieurs pas devient un manque; un décalage fractionnaire est un horodatage irrégulier. Les pas de 15 et 30 minutes sont reconnus. | Pas attendu de 15 min : `00:00, 00:15, 00:32` est décalé; `00:00, 00:15, 00:45` indique le quart d'heure manquant. |
| Consommation négative | Une consommation négative est signalée, selon le réglage existant `allow_negative_values`. | `-2,3 kWh` sur une période. |
| Zéro en saison active | Un zéro est suspect si au moins 4 observations comparables de ce mois/créneau sont positives. Les nuits/week-ends habituellement nuls servent de référence séparée. | Même lundi à 08:00 en janvier : historique `8,1; 7,7; 8,5; 8,0 kWh`, mesure `0`. |
| Consommation anormalement basse/haute | Il faut au moins 6 références comparables. Le seuil haut est `max(médiane + 6×1,4826×MAD, 3×médiane)`; le seuil bas est médiane moins six écarts robustes (plancher à zéro; si l'historique est parfaitement constant, seuil à 50 % de la médiane). | Historique stable médian `10 kWh` et MAD `0` : `3 kWh` est bas (<5), `35 kWh` est haut (>30). |

Une baisse d'index est volontairement présentée comme « remise à zéro ou
remplacement à vérifier », pas comme une erreur certaine : pour accepter la
rupture comme remplacement de compteur, il faut renseigner sa date de mise en
service (`service_start`). Ces règles repèrent des points à contrôler; elles
ne remplacent pas la validation métier, notamment pour les profils saisonniers
ou les changements d'horaires d'exploitation.

Les seuils sont réglables dans la fenêtre **Critères de détection** de la
barre latérale. Les paramètres statistiques configurables sont le nombre
minimum de références comparables, le multiplicateur MAD, le ratio extrême,
le nombre de valeurs positives nécessaire pour considérer un créneau actif,
et la tolérance d'horodatage. Les changements s'appliquent au prochain import
ou à la prochaine réanalyse.

Cette analyse historique peut révéler un profil inhabituel d'un compteur.
L'étape suivante pour mieux suspecter une panne de chaîne d'acquisition est
de rechercher des changements persistants de profil et des ruptures communes
à plusieurs compteurs partageant un même automate ou horodatage. Ces alertes
doivent rester des signaux à examiner : une météo atypique, une fermeture,
un changement d'occupation ou une consigne modifiée peuvent aussi changer le
profil mesuré.

## Exécutable autonome (sans Docker)

Un pipeline GitHub Actions (`.github/workflows/build-desktop.yml`) construit
à chaque push un exécutable autonome, pour Windows et pour Linux : l'API, le
moteur de qualité et le frontend déjà compilé sont empaquetés en un seul
fichier avec PyInstaller. Aucune installation requise (pas de Docker, pas de
Node, pas de PostgreSQL) : les données sont stockées dans une base SQLite
locale, sous le profil de l'utilisateur
(`%LOCALAPPDATA%\QualifComptage` sur Windows).

Double-clique sur `QualifComptage-Windows-<version>.exe` : une fenêtre
d'application native s'ouvre (via [pywebview](https://pywebview.flowrl.com/),
sans barre d'adresse de navigateur), pendant qu'un petit serveur tourne en
arrière-plan sur ta machine. Fermer la fenêtre arrête l'application.

Sur Windows 10/11 récents, le moteur d'affichage (WebView2) est déjà
installé par défaut. Sur un Windows plus ancien ou sans WebView2, l'appli se
rabat automatiquement sur ton navigateur par défaut (comportement identique
à l'ancienne version). En cas de souci au démarrage, un journal est écrit
dans `%LOCALAPPDATA%\QualifComptage\app.log` — à consulter ou à transmettre
pour diagnostic.

La version exacte du build est visible en bas de la barre latérale de
l'application, et dans le nom du fichier téléchargé.

Télécharge le dernier exécutable depuis l'onglet **Actions** du dépôt
(artefact `QualifComptage-Windows` ou `QualifComptage-Linux` du dernier run
de "Build standalone desktop executable"), ou récupère-le directement
auprès de la personne qui te l'a envoyé.

## Lancer en local (Docker)

### Option A — images déjà construites (le plus rapide)

Chaque push sur `main` déclenche un pipeline GitHub Actions qui construit les
images backend et frontend et les publie sur GitHub Container Registry. Le
dépôt étant privé, les images le sont aussi : connecte-toi d'abord à GHCR
avec un [Personal Access Token](https://github.com/settings/tokens) ayant le
scope `read:packages` (`write:packages` si tu veux aussi en publier) :

```bash
docker login ghcr.io -u <ton-user-github> -p <ton-PAT>
docker compose -f docker-compose.images.yml up -d
```

Images publiées : `ghcr.io/loicgilbert74000-coder/qualif-comptage-backend`
et `...-frontend`, tag `latest` et tag par commit (sha).

### Option B — build local

```bash
docker compose up --build
```

- Frontend : http://localhost:8080
- API : http://localhost:8000/api/health
- PostgreSQL : localhost:5432 (qualif / qualif / qualif_comptage)

Les tables sont créées automatiquement au démarrage du backend (pas de
migration Alembic nécessaire pour ce MVP — à ajouter avant une mise en
production).

## Développement sans Docker

Backend :

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export QC_DATABASE_URL=postgresql+psycopg2://qualif:qualif@localhost:5432/qualif_comptage
uvicorn app.main:app --reload
```

Frontend :

```bash
cd frontend
npm install
npm run dev
```

Le serveur de dev Vite proxifie `/api` vers `http://localhost:8000` (voir
`vite.config.ts`).

## Tests

```bash
cd backend
pip install -r requirements.txt pytest
pytest
```

Les tests couvrent le parsing générique des CSV, la détection des quatre
types d'anomalies (pic, chute, valeur négative, palier suspect), la
détection des valeurs manquantes et la reconstruction par simulation.

## Format de fichier attendu

CSV en UTF-8, séparateur `;` ou `,`. Colonnes reconnues automatiquement
(variantes courantes acceptées) :

| Champ logique | En-têtes reconnus |
|---|---|
| horodatage | `horodatage`, `date`, `mois`, `heure_deduite`, `timestamp`, `periode` |
| id_compteur | `id_compteur`, `compteur`, `meter_id` |
| valeur | `valeur`, `value`, `releve`, `energie_kwh` |
| unite *(optionnel)* | `unite`, `unit` |
| id_batiment *(optionnel)* | `id_batiment`, `id_site`, `batiment`, `site` |
| fluide *(optionnel)* | `fluide`, `vecteur`, `energie` |

Si `id_batiment` est absent, le bâtiment est déduit du préfixe du code
compteur (ex. `S04-PAC` → bâtiment `S04`).

## Prochaines étapes suggérées

- Migrations Alembic pour la production (actuellement `create_all` au démarrage).
- Authentification / autorisations (actuellement ouvert, à usage interne).
- Mapping de colonnes manuel depuis l'interface pour les fichiers aux
  en-têtes non standard (le backend l'accepte déjà via le paramètre
  `column_mapping`, il manque l'écran de configuration).
- Export du rapport de qualification et de l'historique (PDF/Excel).
