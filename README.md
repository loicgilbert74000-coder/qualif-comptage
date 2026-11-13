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

## Exécutable autonome (sans Docker)

Un pipeline GitHub Actions (`.github/workflows/build-desktop.yml`) construit
à chaque push un exécutable autonome, pour Windows et pour Linux : l'API, le
moteur de qualité et le frontend déjà compilé sont empaquetés en un seul
fichier avec PyInstaller. Aucune installation requise (pas de Docker, pas de
Node, pas de PostgreSQL) : les données sont stockées dans une base SQLite
locale, sous le profil de l'utilisateur
(`%LOCALAPPDATA%\QualifComptage` sur Windows).

Double-clique sur `QualifComptage.exe` : un serveur local démarre et le
navigateur par défaut s'ouvre automatiquement sur l'application. Fermer la
fenêtre de la console arrête l'application.

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
