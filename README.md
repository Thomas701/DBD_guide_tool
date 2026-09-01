# DBD Build Tool

Le dépôt couvre actuellement les phases 1 à 9 du cahier des charges : audit, modèle de domaine, import/nettoyage, mapping des images, bibliothèque de perks, sélection du tueur, éditeur de build, analyse et sauvegarde locale.

## Commandes

Prérequis : Node.js 20 ou supérieur.

```sh
npm install
npm run dev
npm test
npm run import:data
npm run check
```

- `npm run dev` lance l’application React avec Vite.
- `npm run build` compile la couche de données et l’application de production.
- `npm test` compile TypeScript puis exécute les tests unitaires et d’intégration.
- `npm run import:data` régénère les JSON depuis les trois sources brutes.
- `npm run check` exécute les tests, confirme que les JSON sont à jour et construit l’application.

### Lancement en double-clic

Sous Windows, double-cliquez sur **`Lancer Build Analyzer.bat`**. Le lanceur installe les dépendances si nécessaire, démarre Vite et le proxy local dans une seule fenêtre, puis ouvre `http://127.0.0.1:5173`. Laissez cette fenêtre ouverte pendant l’utilisation.

La session courante est conservée dans le stockage local du navigateur : brouillon, tueur, perks, conditions, onglet, disposition des panneaux et historique du chat sont restaurés à la réouverture.

## ChatGPT Browser Integration

Le Build Assistant propose cinq providers : moteur local, chat natif à copier, ChatGPT via Codex, ChatGPT via navigateur et OpenAI API. **ChatGPT via Codex** est le mode recommandé sans clé API : il utilise l’authentification officielle enregistrée par Codex CLI et ne dépend pas de l’interface web ni de ses CAPTCHA.

### Chat natif — copier/coller

Choisissez **Chat natif · copier/coller**, saisissez une question puis cliquez sur **Copier**. Le presse-papiers reçoit les connaissances DBD consolidées, le build courant et la question ; vous pouvez les coller dans un GPT distant.

### ChatGPT via Codex — recommandé

```powershell
codex login
npm run assistant:proxy
```

Dans **Build Assistant → Provider**, choisissez **ChatGPT via Codex · recommandé**, puis **Vérifier**. Les demandes sont exécutées avec `codex exec` en mode éphémère, lecture seule, et réutilisent votre connexion ChatGPT. Le proxy ne lit ni n’enregistre vos identifiants.

### Installation et première connexion

```powershell
npm install
npm run assistant:install-browser
npm run assistant:proxy
```

Dans **Build Assistant → Provider**, choisissez **Navigateur · expérimental**, conservez `http://127.0.0.1:8787`, puis cliquez sur **Configurer ChatGPT**. Chromium s’ouvre temporairement : connectez-vous vous-même à votre compte ChatGPT. L’application ne demande et ne stocke jamais votre mot de passe. Dès que la session est détectée, Chromium se ferme.

La session reste uniquement dans `.data/chatgpt-browser-profile/`, ignoré par Git. Pour les questions suivantes, Chromium fonctionne en arrière-plan avec `headless = true`. Le build calculé, les perks, leurs descriptions, leurs effets, les conditions et l’historique récent sont structurés dans le prompt envoyé à ChatGPT.

### Mode debug et dépannage

Pour voir Chromium pendant les requêtes :

```powershell
$env:CHATGPT_BROWSER_HEADLESS = "false"
npm run assistant:proxy
```

Les délais peuvent être ajustés avec `CHATGPT_BROWSER_TIMEOUT` et `CHATGPT_BROWSER_LOGIN_TIMEOUT` en millisecondes. Si la session expire ou si ChatGPT affiche un contrôle de sécurité, utilisez de nouveau **Configurer ChatGPT**. Si Chromium manque, relancez `npm run assistant:install-browser`. Le test d’intégration facultatif `npm run test:chatgpt-browser` vérifie une vraie session et n’est pas exécuté par `npm test`.

Le mode Browser dépend de l’interface web de ChatGPT et peut être bloqué par un CAPTCHA. L’application ne tente pas de contourner ces contrôles : utilisez alors ChatGPT via Codex. Le mode API utilise l’interface programmatique stable : définissez `OPENAI_API_KEY` avant `npm run assistant:proxy`, puis choisissez **OpenAI API**. La clé reste exclusivement dans le processus serveur.

Si un second lancement du proxy détecte celui qui écoute déjà sur `8787`, il affiche désormais `Build Assistant déjà actif` puis se termine normalement. Si une autre application occupe le port, définissez par exemple `$env:OPENAI_ASSISTANT_PORT = "8788"` et utilisez la même adresse dans l’interface.

## Données générées

`npm run data:export` crée les deux fichiers locaux utilisés par le chat natif :

- `.data/dbd-knowledge.json` : catalogue des tueurs et perks, statistiques fixes, règles du moteur, déroulement d’une partie et pouvoirs issus de `killers.txt` ;
- `.data/current-build.json` : représentation du build courant, mise à jour automatiquement pendant l’utilisation lorsque le proxy est actif.

Les sorties se trouvent dans `src/data/generated/` :

- `categories.json` : les 23 catégories canoniques ;
- `perks.json` et `killers.json` : les enregistrements validés ;
- `descriptions.json` : les 151 blocs français convertis en nœuds contrôlés ;
- `import-report.json` : erreurs, avertissements et liaisons non résolues.

Le référentiel explicite `src/data/catalog-aliases.ts` relie chaque entrée source à un identifiant stable, son nom anglais, son titre de description et son fichier PNG. L’import ne tente pas de fuzzy matching : les fichiers absents restent listés comme non résolus.

## Interface disponible

- choix initial du tueur avec recherche et tris par tier, difficulté, vitesse ou nom ;
- affichage du portrait et des statistiques de base ;
- bibliothèque responsive des perks de tueur ;
- recherche insensible aux accents sur les noms FR et EN ;
- filtres cumulables par personnage, catégories en modes ANY/ALL et cooldown ;
- panneau de détail avec description riche rendue à partir de nœuds contrôlés.
- éditeur de build limité à quatre perks, avec prévention des doublons ;
- analyse des modifications de vitesse et de rayon de terreur, conditions de simulation et états temporaires ;
- création, modification, chargement, duplication et suppression de builds dans le stockage local du navigateur ;
- protection contre la perte de modifications non sauvegardées et récupération explicite d'un stockage corrompu.

Les fichiers `source.txt` et `description_categories.txt` restent des sources brutes. Une ligne ambiguë est signalée ou mise en quarantaine ; elle n’est jamais réparée silencieusement. Les effets structurés issus de la syntaxe historique portent `interpretation: "inferred"` et ne sont donc pas présentés comme entièrement simulables.

L’audit détaillé est disponible dans `docs/PHASE_1_AUDIT.md`.

L'analyse numérique reste volontairement partielle : le moteur calcule les opérations structurées compatibles sur la vitesse et le rayon de terreur, et expose les autres effets comme non calculables au lieu de les inventer. Un cumul mélangeant plusieurs types d'opération reste lui aussi non résolu tant que son ordre métier n'est pas vérifié. Les effets issus de l'import restent marqués comme inférés. L'internationalisation complète et les phases ultérieures du cahier des charges restent à implémenter.
