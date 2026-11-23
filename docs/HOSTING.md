# Version web : GitHub Pages et Supabase

Le site utilise GitHub Pages pour l’interface, Supabase Auth pour la connexion et PostgreSQL pour les données privées. Le mode local reste disponible lorsque les variables Supabase sont absentes.

## Publication

1. Créer un projet Supabase gratuit dans une organisation gratuite, en région Europe.
2. Exécuter les fichiers de `supabase/migrations/` dans l’ordre de leur nom dans l’éditeur SQL du nouveau projet, jusqu’à `202611220006_behaviour_nickname.sql`. Ne pas réexécuter les migrations déjà appliquées sur un projet existant. Appliquer les nouvelles migrations avant de publier cette version de l’interface et du collecteur.
3. Dans Supabase, configurer **Authentication → URL Configuration** : Site URL et URL de redirection `https://thomas701.github.io/DBD_guide_tool/`. Les URL locales `http://127.0.0.1:5173/` et `http://localhost:5173/` peuvent être ajoutées pour le développement.
4. Dans GitHub, ouvrir **Settings → Pages**, choisir **GitHub Actions**.
5. Dans **Settings → Secrets and variables → Actions → Variables**, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. La seconde valeur est la clé **Publishable**, jamais une clé `sb_secret_` ni `service_role`.
6. Pousser les changements sur `main`. Le workflow `pages.yml` teste le code, construit le site et le ZIP de l’extension, puis publie l’application. Le workflow `database.yml` vérifie les permissions sur une base PostgreSQL de test isolée.

L’URL prévue est `https://thomas701.github.io/DBD_guide_tool/`. Le workflow déduit le chemin et l’URL du site à partir de GitHub Pages. Pour une autre adresse, mettre à jour également les URL autorisées dans Supabase. L’extension construite reprend l’URL de publication.

## Connexion des utilisateurs

La connexion est conservée dans le navigateur et renouvelée automatiquement par le SDK Supabase. Les refresh tokens tournent normalement ; il ne faut ni désactiver cette protection ni allonger excessivement la durée des access tokens. Une déconnexion explicite ne déconnecte que l’appareil courant. La révocation, la suppression du stockage du navigateur ou certaines modifications de sécurité peuvent nécessiter une reconnexion.

Pour **Google**, créer un client OAuth Web dans Google Cloud, autoriser le callback `https://<project-ref>.supabase.co/auth/v1/callback`, puis renseigner le Client ID et le Client Secret dans **Supabase → Authentication → Sign In / Providers → Google**. Ces secrets restent dans Supabase. Utiliser uniquement les autorisations de connexion de base. Un projet OAuth laissé en test n’autorise que les testeurs inscrits ; terminer sa configuration avant un lancement public.

La version publiée utilise **Google** par défaut. Pour proposer aussi **email / mot de passe**, configurer un SMTP externe dans Supabase pour les confirmations et les réinitialisations, puis ajouter la variable GitHub `VITE_EMAIL_AUTH_ENABLED=true` et republier. L’envoi intégré de Supabase est limité aux adresses de l’équipe et ne convient pas aux inscriptions publiques. Conserver la confirmation des emails. Une offre SMTP gratuite peut suffire pour dix personnes, mais son quota est distinct de celui de Supabase.

## Données et conflits

Les comptes présents dans `app_administrators` peuvent modifier les descriptions et catégories des perks, corriger ou supprimer leurs propres parties et ouvrir l’onglet **Administration**. Son tableau affiche l’email, la création du compte, les droits administrateur, l’association Behaviour et la dernière connexion. L’icône œil permet de consulter les builds, tier lists et statistiques d’un joueur en lecture seule. Les conversations de l’assistant et les autorisations Behaviour sont exclues de cette consultation. Ces droits sont vérifiés dans Supabase, y compris pour les appels directs à l’API. Les imports de statistiques sont réservés au collecteur serveur. Les métadonnées modifiables par l’utilisateur ne donnent aucun droit.

Les descriptions modifiées par un administrateur sont communes à tous les comptes et rechargées au retour sur la fenêtre et toutes les trente secondes. La migration reprend les anciennes descriptions des administrateurs ; les versions les plus récentes sont prioritaires. Les tier lists restent privées et synchronisées par compte, avec un bloc **Non classés** pour les tueurs et chaque camp de perks.

L’onglet **Classement** est accessible à tous les comptes connectés. Il publie uniquement le pseudo, le MMR estimé et les nombres de victoires et défaites, par pages de cinquante. Le pseudo est celui du bloc officiel `data-cy="nav-user-nickname"` : nom de la plateforme sélectionnée, ou nom Behaviour lorsque la progression partagée est activée. Le collecteur lit les mêmes données auprès de l’API Behaviour et actualise le profil à chaque synchronisation, sans réinstallation de l’extension. Le pseudo initial ne contient pas l’email. Un nom absent ou invalide conserve le dernier nom connu. Les filtres reprennent les modes MMR de l’application et proposent les tueurs présents dans les parties du mode choisi. Le calcul utilise les parties archivées non supprimées et les mêmes variations de ±9 MMR que la vue MMR personnelle. Les victoires survivant correspondent aux évasions ; leur MMR dépend du score comparé à celui des autres survivants. Pour un tueur, trois éliminations ou plus donnent une victoire, deux un nul et zéro ou une une défaite.

La migration `202611220003_administrators.sql` attribue ce rôle au compte confirmé `mynoteet@gmail.com` s’il existe déjà. Pour une nouvelle installation, après création et confirmation du compte, exécuter depuis l’éditeur SQL administrateur : `insert into public.app_administrators(user_id) select id from auth.users where lower(email) = 'mynoteet@gmail.com' and email_confirmed_at is not null on conflict do nothing;`. L’ajout d’autres administrateurs suit le même principe ; les utilisateurs ne peuvent pas s’attribuer le rôle eux-mêmes. Le mode local conserve les possibilités d’édition du propriétaire de l’installation.

- Les builds, le brouillon, les préférences, tiers et personnalisations sont regroupés par utilisateur dans `user_workspaces`.
- Le cache du navigateur est également séparé par compte. Les anciennes données du mode local sont conservées et ne sont pas automatiquement attribuées au premier compte connecté.
- Une sauvegarde en échec reste en attente dans le cache et peut être reprise. La connexion du compte doit avoir été restaurée avant de charger ses données en ligne.
- Un délai dépassé côté Supabase conserve les changements sur l’appareil et entraîne une nouvelle tentative. Si la réponse s’est perdue après validation, la même sauvegarde et sa version sont reconnues avant de signaler un conflit, y compris au rechargement.
- Chaque sauvegarde vérifie sa version. Si un autre appareil a enregistré des changements, l’interface demande d’exporter les changements locaux avant de recharger la version distante.
- Les statistiques et parties sont stockées séparément dans `player_statistics` et `player_matches`. Les parties supprimées restent marquées comme supprimées pour ne pas réapparaître au prochain import. Les corrections manuelles sont préservées.
- Les règles RLS empêchent un joueur de lire les données privées d’un autre. Les administrateurs de l’application disposent de la consultation décrite ci-dessus ; le classement expose seulement ses colonnes publiques. L’administrateur du projet Supabase peut gérer l’ensemble des données.

Les snapshots de préférences et builds sont limités à 5 Mo par compte. Les historiques de parties sont enregistrés en lignes séparées et ne sont pas soumis à cette limite de document. L’offre Supabase gratuite ne fournit pas les sauvegardes automatiques du plan Pro : prévoir des exports réguliers si les données deviennent importantes.

## Statistiques Behaviour

Chaque joueur utilise **Statistique → Installer l’extension et connecter Behaviour**. Après confirmation dans la boutique, l’extension active les onglets déjà ouverts sans rechargement et le site poursuit automatiquement l’association. La page officielle de connexion Behaviour est ouverte si nécessaire ; une session existante peut être réutilisée. Chrome, Edge, Opera et les navigateurs Chromium compatibles sur ordinateur sont visés. Le site reste consultable sur les autres navigateurs après association.

L’installation simplifiée nécessite une fiche approuvée dans le Chrome Web Store. Son URL réelle est renseignée dans `public/extension-store.json`. Tant que cette URL n’est pas renseignée, le bouton ouvre le guide d’installation manuelle provisoire. Le ZIP et les informations de publication sont préparés par `npm run build:extension` et `docs/EXTENSION_STORE.txt`. Le navigateur impose une confirmation d’installation ; le site ne peut pas la contourner. Edge peut aussi demander d’autoriser les extensions d’une autre boutique.

La version 0.4.1 détecte l’installation à chaud, reprend l’intention d’association du compte courant et attend une première synchronisation réussie avant d’annoncer son activation. L’intention est conservée dans la session de l’onglet, sans jeton d’authentification. Les scripts empaquetés n’agissent que sur le site de Build Analyzer et le site officiel de statistiques. Les onglets de connexion créés par l’extension sont distingués des onglets personnels du joueur.

Le site contacte en priorité l’identifiant réel du Chrome Web Store, `cljdeckobhfikpiecnpjlhmlbaeoalgh`, sans dépendre de l’injection de la passerelle dans l’onglet. La clé publique du manifeste de développement donne le même identifiant pour reproduire ce parcours dans les tests. Le ZIP destiné au Store exclut cette clé publique. Une correction de cette détection côté site ne nécessite pas de réinstaller l’extension.

L’extension associe le navigateur au compte Supabase connecté avec un jeton aléatoire révocable. Ce jeton n’autorise que le collecteur de statistiques ; il ne fournit pas la session Supabase ni l’accès aux builds. Le serveur déduit toujours le compte propriétaire du jeton. Le jeton n’est pas embarqué dans le ZIP distribué.

Le joueur se connecte une fois à Behaviour dans son navigateur normal. L’extension transmet les jetons d’accès et de renouvellement à la fonction Supabase, avec le fuseau horaire du navigateur. Ils sont conservés chiffrés dans Supabase Vault, sans accès de lecture pour les utilisateurs. La fonction les renouvelle automatiquement et sauvegarde le renouvellement avant de collecter les parties. L’extension efface sa copie après la transmission et n’ouvre aucun onglet automatiquement. Les mots de passe et cookies ne sont pas transmis. L’empreinte de l’identité Behaviour bloque un changement de joueur involontaire.

La collecte fonctionne côté serveur, même navigateur fermé et PC éteint. Supabase Cron appelle la fonction toutes les cinq minutes. Les demandes manuelles utilisent la session Supabase du joueur et fonctionnent sans extension. Une autorisation Behaviour expirée ou révoquée nécessite une nouvelle connexion. L’offre gratuite et les API Behaviour ne garantissent pas une disponibilité permanente.

Un profil Chrome / Edge est associé à un seul compte Build Analyzer à la fois. Chaque joueur doit utiliser son propre profil sur un ordinateur partagé. **Désactiver la synchronisation** révoque le collecteur et supprime les jetons Behaviour de Vault ; une tâche en cours ne peut plus importer de données. La simple déconnexion du site ou la fermeture du navigateur laisse la collecte distante active.

Le calcul des identifiants reste partagé avec le collecteur local ; le serveur conserve le fuseau initial pour éviter les doublons. Chaque synchronisation récupère les trente dernières parties fournies par l’API officielle, avec les équipements et emblèmes des participants. Une évolution de l’API peut nécessiter une mise à jour du collecteur. Un historique plus ancien doit être restauré depuis l’archive locale ; les parties déjà enregistrées dans Supabase restent conservées.

Déploiement : appliquer `202611220002_remote_statistics.sql` après la première migration. Exécuter `npm run build:sync`, puis déployer `.tmp-cloud-function/index.ts` comme fonction `sync-statistics`. Désactiver **Verify JWT with legacy secret** : le code vérifie lui-même le JWT utilisateur, le jeton du collecteur ou le jeton dédié du cron. La clé `SUPABASE_SERVICE_ROLE_KEY` reste fournie uniquement dans l’environnement Supabase. Exécuter ensuite `supabase/setup-statistics-cron.sql` (adapter son URL si le projet change). Le cron utilise un secret aléatoire stocké dans Vault, sans clé administrateur dans GitHub ou le navigateur. Les sessions sont réclamées par lots de dix avec un verrou de deux minutes. Au-delà de dix joueurs actifs, adapter le nombre de collectes par exécution ou la fréquence pour conserver une cadence de cinq minutes par joueur.

Pour migrer une ancienne installation, sauvegarder `.data/dbd-statistics.json` et exporter uniquement les clés de sauvegarde de l’application depuis l’ancienne origine du navigateur. Exporter également `user_workspaces`, `player_statistics` et `player_matches` du compte connecté avant la fusion. `scripts/migrate-local-data.mjs` prépare une transaction à exécuter dans l’éditeur SQL Supabase avec les droits administrateur : `node scripts/migrate-local-data.mjs archive-locale.json sauvegarde-compte.json espace-local.json import.sql`. L’export du compte a le format `{data: {table: {status: 200, rows: [...]}}}`. L’espace local est un dictionnaire de clés de sauvegarde, sans session ni clé d’authentification. Ne jamais committer les exports ou le SQL généré. La transaction refuse un compte modifié depuis l’export, conserve les modifications et suppressions distantes, applique les corrections locales aux parties non corrigées en ligne, fusionne les builds par identifiant et protège les préférences distantes existantes. Conserver les fichiers sources après vérification.

## Assistant et fonctionnement local

La version GitHub Pages fournit le mode Copier/Coller de l’assistant. Les modes Codex et Clé API nécessitent toujours le serveur de la version locale. La version web n’expose pas ce serveur local, son compte Codex ou ses clés à tous les visiteurs.

Pour préparer une version web localement, utiliser les variables de `.env.example`, puis `npm run build:site`. Le ZIP de l’extension est créé dans `dist/dbd-statistics-extension.zip`. Pour tester uniquement le mode local, laisser les variables Supabase absentes et `VITE_HOSTED_APP=false`.

## Vérifications

`npm run check` vérifie les données, les tests et la compilation du site et du collecteur. Les tests du serveur vérifient l’authentification, plusieurs joueurs, le renouvellement et les pannes. `npm run test:cloud` vérifie les comptes dans Chromium. `npm run test:extension` vérifie la transmission initiale, sa reprise en cas d’échec, l’effacement des jetons locaux et l’absence d’onglets créés.

Les tests SQL de `tests/database` s’exécutent dans une base PostgreSQL vierge et isolée : `bootstrap.sql`, première migration, `remote-bootstrap.sql`, migrations suivantes dans l’ordre, `accounts.sql`, `administrators.sql`, `community.sql`, `behaviour-nickname.sql`, `remote-statistics.sql`. Les bootstraps imitent uniquement l’identité Supabase et l’API Vault pour les tests ; ne jamais les exécuter dans le projet réel. Le chiffrement Vault et le déclenchement du cron doivent aussi être vérifiés sur Supabase.
