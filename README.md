# DBD Build Tool

La version hébergée utilise **GitHub Pages + Supabase** pour les comptes et les sauvegardes, avec une extension Chrome / Edge pour les statistiques Behaviour de chaque joueur. La configuration et les limites sont décrites dans [le guide de déploiement web](docs/HOSTING.md).

Le dépôt couvre actuellement les phases 1 à 9 du cahier des charges : audit, modèle de domaine, import/nettoyage, mapping des images, bibliothèque de perks, sélection du tueur, éditeur de build, analyse et sauvegarde locale.

## Première installation sous Windows

1. Utilisez Windows 10/11 en 64 bits, avec une connexion Internet et **App Installer / winget** disponible. Si nécessaire, installez App Installer depuis le Microsoft Store.
2. Clonez le dépôt avec Git : `git clone https://github.com/Thomas701/DBD_guide_tool.git`. Sans Git, utilisez **Code → Download ZIP** sur GitHub, puis extrayez complètement l’archive.
3. Dans le dossier obtenu, double-cliquez sur **Lancer Build Analyzer.bat**. Acceptez les éventuelles demandes d’installation de Windows.
4. Attendez le message **Build Analyzer prêt**, puis utilisez la page ouverte dans votre navigateur. Gardez la fenêtre du lanceur ouverte.

Le lanceur installe Node.js LTS s’il manque, les versions verrouillées des dépendances, le moteur Codex, Chromium pour les tests et Google Chrome s’il est absent. **Les statistiques utilisent exclusivement Google Chrome**, nécessaire à la connexion Behaviour ; Chromium ne le remplace pas. Aucun fichier `.env`, aucune clé API et aucune installation de VS Code ne sont nécessaires au lancement. Les connexions Behaviour et ChatGPT se font ensuite dans l’application, pour les fonctionnalités correspondantes.

Les historiques, profils de connexion et caches du dossier `.data/` restent propres à chaque installation et sont créés automatiquement. Ils ne font pas partie du dépôt. Les builds et préférences sont enregistrés dans le navigateur utilisé.

Si `winget` est indisponible, installez manuellement [Node.js LTS](https://nodejs.org/) en 64 bits et [Google Chrome](https://www.google.com/chrome/), puis relancez le fichier `.bat`. Une erreur réseau ou un port local occupé est indiquée par le lanceur ; corrigez la cause puis relancez-le.

## Commandes

Prérequis pour les commandes manuelles : Node.js 20 ou supérieur.

```sh
npm ci --include=dev --include=optional
npm run assistant:install-browser
npm run start:app
npm test
npm run import:data
npm run check
```

L’onglet **Statistique** vérifie d’abord silencieusement `stats.deadbydaylight.com/statistics/` avec le profil Chrome persistant. Une seule fenêtre Google Chrome s’ouvre si une connexion manuelle est nécessaire ; elle se ferme après la connexion et la lecture continue en arrière-plan. La session reste enregistrée dans `.data/dbd-statistics-chrome-profile/`. Ce profil est distinct du Chrome habituel : une connexion déjà active dans le navigateur par défaut n’est pas partagée. Le lien **Source** de l’application ouvre la page dans le Chrome contrôlé. Google Chrome peut être installé pour tout le système ou seulement pour l’utilisateur.

- `npm run dev` lance l’application React avec Vite.
- `npm run build` compile la couche de données et l’application de production.
- `npm test` compile TypeScript puis exécute les tests unitaires et d’intégration.
- `npm run import:data` régénère les JSON depuis les trois sources brutes.
- `npm run check` exécute les tests, confirme que les JSON sont à jour et construit l’application.

### Web App

L’application reste une interface web React, mais elle expose désormais les métadonnées nécessaires à une installation comme web app dans les navigateurs compatibles.

La web app fournit :

- un manifest web ;
- une icône d’application basée sur `DBDImages-main/DBDImages-main/images/logo/logo_dbd_build_analyser.png` ;
- un service worker minimal pour l’installation et le cache applicatif.

Sur Chrome, Edge et autres navigateurs compatibles, l’installation se fait depuis l’icône d’installation dans la barre d’adresse ou depuis le menu du navigateur.

### Lancement en double-clic

Sous Windows, double-cliquez sur **`Lancer Build Analyzer.bat`**. Le lanceur installe automatiquement Node.js LTS avec `winget` s’il est absent ou trop ancien, puis les dépendances verrouillées du projet, Chromium pour les tests et Google Chrome pour les statistiques si nécessaire. Il démarre ensuite Vite et le proxy local, puis ouvre `http://127.0.0.1:5173` dans votre navigateur par défaut.

`winget` est fourni par **App Installer** sur Windows 10/11. Si le poste ne le possède pas, le lanceur indique comment l’ajouter depuis le Microsoft Store.

Laissez la fenêtre du terminal ouverte tant que vous utilisez cette version locale. La web app installée depuis le navigateur s’exécute ensuite dans sa propre fenêtre côté navigateur.

Le lanceur surveille l’interface et le serveur de l’assistant, y compris lorsqu’ils étaient déjà ouverts au démarrage. Si un service disparaît ou ne répond plus, il est relancé automatiquement sur la même adresse. Attendez le message de rétablissement puis actualisez la page. Des échecs répétés arrêtent le lanceur avec un diagnostic. `Ctrl+C` arrête les processus démarrés par ce lanceur ; les services réutilisés restent ouverts. Le port web reste fixé à `5173` : un conflit de port est signalé, sans changement silencieux d’adresse.

La session courante est conservée dans le stockage local du navigateur : brouillon, personnage, perks, conditions, onglet, disposition des panneaux et historique du chat sont restaurés à la réouverture. Les modes tueur et survivant gardent chacun leur build sélectionné et leur brouillon, même après un changement de mode ou un redémarrage. L’ancienne session est reprise automatiquement pour son camp.

Les descriptions de perks sont suivies d’un bloc de définitions colorées lorsqu’elles mentionnent des statuts ou des termes de jeu du glossaire (Épuisement, Brisé, État critique, Insaisissable, etc.). Les définitions suivent la description affichée, y compris ses personnalisations ; elles ne sont pas ajoutées au texte enregistré de la perk. Le filtre de cooldown utilise lui aussi la description actuelle : un délai de réutilisation est distinct d’une durée d’effet, d’Épuisement ou d’une recharge de charges d’objet.

Les 148 perks tueurs disposent d’effets revus individuellement pour **Impact Analysis**, au rang III, d’après les descriptions natives et `statistiques_fixe.txt`. Les durées d’aura sont indiquées par activation ; aucune moyenne arbitraire par partie n’est ajoutée. Les scénarios à jetons précisent le nombre utilisé. Les cumuls de modificateurs compatibles suivent les rendements décroissants du patch live 9.6 ; les cumuls de modes/opérations opposés restent signalés comme non calculables. Les valeurs manquantes retenues comme estimations (flaques de sang, ramassage/lâcher, exemple de progression pour Semer la dévastation) sont marquées. Les précisions de rework proviennent notamment du [patch live 10.2](https://forums.bhvr.com/dead-by-daylight/kb/articles/560-10-2-0-mid-chapter) ; les descriptions personnalisées peuvent s’écarter de ces règles et nécessiter une révision des effets structurés.

Les **179 perks survivants** disposent également d’une analyse individuelle au rang III dans `src/data/survivor-perk-effects.ts`, conservée dans le catalogue généré à chaque import. Le panneau utilise les références de **Constantes** pour les soins, réparations, sauts, déplacements, crochets, coffres et totems. Les effets sur les alliés et le tueur adverse sont séparés des bonus personnels ; les conditions permettent de simuler santé, Épuisement, bénédiction et scénarios à jetons. Les révélations temporisées et les portées compatibles tiennent compte des Yeux de Belmont et de Main tendue.

Les précisions des reworks s’appuient sur les [notes live 10.2](https://forums.bhvr.com/dead-by-daylight/kb/articles/560-10-2-0-mid-chapter) et [10.1](https://forums.bhvr.com/dead-by-daylight/kb/articles/556-10-1-0-chorus-of-sin). Lorsqu’elles corrigent une description locale ancienne, l’analyse l’indique. Les animations sans durée de référence, la vitesse adverse inconnue, la récupération d’Épuisement et les libellés ambigus sont signalés comme estimés. Les effets aléatoires, réserves, soins instantanés et gains permanents sont expliqués sans leur attribuer un gain moyen de temps arbitraire. Modifier un texte de description ne recalcule pas automatiquement ses effets structurés ; ceux-ci doivent être revus si les règles changent. Les cumuls complexes non pris en charge restent signalés par le moteur.

### Mises à jour depuis GitHub

Dans **Paramètres**, l’application vérifie `origin/main` et active **Mettre à jour** uniquement lorsqu’un commit plus récent est disponible sur GitHub. La mise à jour applique seulement les nouveaux fichiers avec un fast-forward Git ; `npm ci --include=dev --include=optional` n’est relancé que si `package-lock.json` a changé. Les builds et préférences du navigateur sont conservés.

Le bouton fonctionne pour une copie clonée et lancée par **`Lancer Build Analyzer.bat`**. Si Git est absent sous Windows, le même bouton propose **Installer Git et mettre à jour** et l’installe automatiquement avec `winget`. Il reste désactivé si des fichiers suivis ont été modifiés localement, si la branche courante n’est pas `main` ou si l’historique a divergé, afin de ne rien écraser. Après une mise à jour qui modifie les dépendances, fermez puis relancez le lanceur une fois.

Pour publier une mise à jour, il suffit de valider les changements puis de les pousser sur la branche `main` du dépôt GitHub. Le numéro de `package.json` est affiché dans l’interface, tandis que la disponibilité repose sur les commits afin qu’un oubli de changement de version ne bloque pas les utilisateurs.

Avant de pousser, incluez les nouveaux fichiers source, images, tests et `.github/workflows/installation.yml` dans le commit ; les seuls fichiers modifiés déjà suivis ne suffisent pas. `git status --short` permet de repérer les fichiers `??` encore absents du prochain commit. Le dossier `.data/`, `.env`, `node_modules/`, `dist/` et les fichiers `.tmp-*` sont volontairement exclus.

À chaque push et pull request, le workflow **Installation depuis un clone neuf** réinstalle les dépendances sous Windows et Linux, exécute `npm run check`, vérifie le parcours de l’interface et lance les serveurs sur des ports isolés. Sous Windows, il teste aussi le lanceur avec `-PrepareOnly`. Attendez que ce workflow soit vert avant d’annoncer une version installable.

Après l’installation de cette fonctionnalité, le proxy local doit être relancé une fois afin d’exposer les routes de mise à jour. Les Paramètres indiquent explicitement ce redémarrage nécessaire au lieu d’afficher une erreur de route.

## Build Assistant

Trois modes sont disponibles : **Copier/Coller**, **Codex** et **Clé API**. L'assistant est utilisable sans personnage sélectionné.

### Copier/Coller

Écrivez une question puis cliquez sur **Copier** (ou appuyez sur Entrée). Le presse-papiers reçoit le prompt complet : catalogue des deux camps, descriptions affichées, pouvoirs, constantes, tier lists, build courant, builds sauvegardés et question. Collez-le dans votre GPT externe. Le contexte est reconstruit à chaque envoi.

### Codex

Le moteur officiel Codex est inclus dans les dépendances de l'application. Le lanceur **Lancer Build Analyzer.bat** le prépare automatiquement : aucune installation globale de Codex ni commande de connexion n'est nécessaire.

Dans **Build Assistant → Codex**, cliquez sur **Connecter Codex**, puis connectez-vous avec le compte de votre choix sur la page officielle ChatGPT. Le chat devient disponible automatiquement. **Déconnecter** termine uniquement la session Codex de l'application ; vous pouvez ensuite connecter un autre compte.

Le profil Codex de l'application est conservé dans `~/.dbd-build-tool/codex` (sous votre dossier utilisateur Windows). Il est distinct du profil de VS Code et fonctionne sans VS Code. Les identifiants existants de VS Code ne sont pas copiés : une première connexion propre à l'application est nécessaire après cette mise à jour. Les identifiants sont gérés par Codex et ne sont transmis ni à l'interface ni aux conversations.

À droite du titre, l'en-tête affiche le compte et son abonnement, le modèle sélectionné et les quotas restants. Le sélecteur reprend les modèles proposés par Codex pour la session, y compris les pages suivantes du catalogue. Le choix est enregistré dans le profil de l'application et le modèle affiché est celui envoyé aux prochaines requêtes. Le bouton d'actualisation recharge ces informations ; elles sont aussi actualisées toutes les 30 secondes lorsque le chat est ouvert et après chaque réponse. Le détail des quotas présente les différentes périodes et leurs dates de réinitialisation. Les quotas concernent le compte entier, y compris ses autres utilisations ; une donnée absente est indiquée comme non communiquée.

Pour le développement, `npm install` prépare aussi le moteur fourni ; `npm run start:app` démarre l'interface et son serveur local. `CODEX_CLI_PATH` permet de remplacer explicitement le moteur fourni par un autre exécutable. Sans choix enregistré, l'application utilise le modèle recommandé dans le catalogue de la session. `CODEX_ASSISTANT_MODEL` peut donner un choix initial s'il figure dans ce catalogue ; le choix de l'interface est prioritaire. Les erreurs Codex sont extraites du flux technique et affichées une seule fois dans la conversation. Les variables d'authentification du serveur et le profil Codex global ne sont pas réutilisés par le moteur dédié à l'application.

Codex produit une réponse structurée en lecture seule. L'application valide et applique les actions ; le modèle ne modifie pas directement les fichiers du projet.

### Clé API

Dans **Clé API → Connexion**, saisissez votre clé OpenAI et le modèle souhaité, puis cliquez sur **Connecter la clé**. Le serveur local vérifie l'accès au modèle. La clé reste uniquement en mémoire dans ce processus : elle n'est enregistrée ni dans les conversations ni dans le stockage du navigateur et disparaît à l'arrêt du serveur. Les requêtes API utilisent le compte associé à cette clé.

Une clé `OPENAI_API_KEY` et un modèle `OPENAI_MODEL` définis dans l'environnement du serveur restent également pris en charge. **Déconnecter** retire la clé de la session du serveur.

### Actions et conversations

Les modes Codex et Clé API peuvent répondre à des questions générales et, à la demande, modifier une description de perk, déplacer un tueur ou une perk dans la tier list, créer ou modifier plusieurs builds sauvegardés, ou équiper un brouillon dans l'éditeur. Les changements sont enregistrés dans le navigateur en mode local. Sur le site, les builds et tiers sont propres au compte ; les descriptions modifiées par un administrateur sont partagées avec tous les joueurs. Les descriptions sont nettoyées avant leur affichage ; les identifiants, camps, tiers et limites de perks sont vérifiés avant l'exécution du lot. Chaque action affiche son résultat.

Une demande explicite de création de builds demande des sauvegardes réelles : un `save_build` par build, avec le personnage et le camp demandés. Pour les demandes directes reconnues, si le modèle fournit moins de créations que demandé, le serveur demande une correction une seule fois avant toute application. Si les actions restent absentes, la demande échoue explicitement et aucune action de cette réponse n'est appliquée. « Créer » sauvegarde ; « équiper un brouillon » modifie seulement l'éditeur. Le gestionnaire et le compteur des builds n'affichent que les sauvegardes du camp actif ; les autres sauvegardes restent conservées.

Chaque mode connecté dispose de ses conversations : **Nouvelle**, sélection dans la liste, puis **Supprimer** pour retirer une conversation et son contenu. L'ancien historique est repris sous le dernier mode connecté ; son ancien stockage n'est retiré qu'après l'enregistrement réussi du nouvel historique. La suppression ne supprime pas les builds ni les modifications déjà appliquées.

Après une mise à jour du proxy, relancez l'application pour charger ses nouvelles routes. Le serveur écoute par défaut sur `http://127.0.0.1:8787`. Pour changer de port, définissez `OPENAI_ASSISTANT_PORT` et utilisez la même adresse dans **Connexion**.

## Tier lists

Le menu propose **Killer**, **Perk killer** et **Perk survivor**. Glissez-déposez un tueur ou une perk sur le tier voulu, ou dans le bloc **Non classés** sous chaque liste. Un clic ouvre ses détails à droite : statistiques et pouvoir du tueur, ou propriétaire, catégories et description effective de la perk. Le sélecteur du panneau permet aussi de déplacer une entrée au clavier ou sur écran tactile. Chaque joueur conserve sa propre tier list, synchronisée dans son compte sur le site et enregistrée dans son navigateur en mode local.

Les 148 perks tueurs et 179 perks survivants du catalogue sont classées par identifiant, indépendamment de leur traduction. La révision du 7 novembre 2026 évalue leur utilité générale au rang III en partie normale 1 contre 4, à partir des descriptions de l'application et des notes live citées dans **Critères du classement**. Le panneau précise les raisons de plusieurs réévaluations après rework. Ce classement éditorial ne prétend pas remplacer un classement spécialisé par tueur, objet ou équipe ; les déplacements personnalisés sont prioritaires et conservés lors des mises à jour.

`npm run test:workspace` vérifie le parcours complet dans Chromium avec un moteur Codex simulé : création des deux builds pour Jake, séparation et reprise des camps après rechargement, conservation d’un brouillon, glossaire, défilement des détails, déplacement des tiers et persistance. Il vérifie aussi les calculs affichés en mode survivant, les conditions de santé/Épuisement et les synergies de lecture d’aura. Le navigateur Playwright doit être installé (le lanceur de l'application s'en charge).

## Données générées

Le chat natif construit désormais son contexte directement depuis les données affichées par l’application et ne génère plus de fichier de connaissances. Lorsque le proxy est actif, `.data/current-build.json` conserve une représentation du build courant pour les outils locaux.

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

L’analyse utilise les opérations structurées compatibles et les références des constantes pour les deux camps ; elle explique les effets non numériques séparément. Elle ne simule pas intégralement une partie : un cumul mélangeant plusieurs types d’opération ou des contextes incompatibles reste non résolu tant que son ordre métier n’est pas vérifié. Les effets historiques importés sans révision restent marqués comme inférés. L’internationalisation complète et les phases ultérieures du cahier des charges restent à implémenter.
