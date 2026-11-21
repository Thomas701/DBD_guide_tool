# Version web : GitHub Pages et Supabase

Le site utilise GitHub Pages pour l’interface, Supabase Auth pour la connexion et PostgreSQL pour les données privées. Le mode local reste disponible lorsque les variables Supabase sont absentes.

## Publication

1. Créer un projet Supabase gratuit dans une organisation gratuite, en région Europe.
2. Exécuter `supabase/migrations/202611210001_accounts_and_statistics.sql` dans l’éditeur SQL du nouveau projet. La migration crée les tables, les règles de lecture par propriétaire et les fonctions de sauvegarde et de collecte. Ne pas la réexécuter intégralement sur un projet où les tables existent déjà.
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

- Les builds, le brouillon, les préférences, tiers et personnalisations sont regroupés par utilisateur dans `user_workspaces`.
- Le cache du navigateur est également séparé par compte. Les anciennes données du mode local sont conservées et ne sont pas automatiquement attribuées au premier compte connecté.
- Une sauvegarde en échec reste en attente dans le cache et peut être reprise. La connexion du compte doit avoir été restaurée avant de charger ses données en ligne.
- Chaque sauvegarde vérifie sa version. Si un autre appareil a enregistré des changements, l’interface demande d’exporter les changements locaux avant de recharger la version distante.
- Les statistiques et parties sont stockées séparément dans `player_statistics` et `player_matches`. Les parties supprimées restent marquées comme supprimées pour ne pas réapparaître au prochain import. Les corrections manuelles sont préservées.
- Les règles RLS empêchent un utilisateur de lire les données d’un autre. L’administrateur du projet Supabase peut gérer l’ensemble des données.

Les snapshots de préférences et builds sont limités à 5 Mo par compte. Les historiques de parties sont enregistrés en lignes séparées et ne sont pas soumis à cette limite de document. L’offre Supabase gratuite ne fournit pas les sauvegardes automatiques du plan Pro : prévoir des exports réguliers si les données deviennent importantes.

## Statistiques Behaviour

Chaque joueur télécharge **la même extension Chrome / Edge**, la charge une seule fois depuis `chrome://extensions` ou `edge://extensions`, puis utilise **Statistique → Connecter mes statistiques**. L’installation détaillée est disponible sur `extension-installation.html` et dans le ZIP.

L’extension associe le navigateur au compte Supabase connecté avec un jeton aléatoire révocable. Ce jeton n’autorise que le collecteur de statistiques ; il ne fournit pas la session Supabase ni l’accès aux builds. Le serveur déduit toujours le compte propriétaire du jeton. Le jeton n’est pas embarqué dans le ZIP distribué.

Le joueur se connecte à Behaviour dans son navigateur normal. Toutes les cinq minutes, l’extension ouvre des onglets inactifs pour lire les pages officielles, puis ferme uniquement ceux qu’elle a créés. Le site Behaviour gère lui-même le renouvellement de ses jetons à l’ouverture de ses pages. Les mots de passe, cookies et jetons Behaviour ne sont pas envoyés à Supabase. Seule l’identité stable du JWT est lue et hachée localement pour détecter un changement de compte.

La collecte fonctionne lorsque le navigateur est ouvert, même si Build Analyzer est fermé. Elle s’arrête si le navigateur est fermé. Aucune application ne peut garantir une session perpétuelle si Behaviour expire ou révoque son autorisation : la prochaine synchronisation indiquera qu’une reconnexion est requise.

Un profil Chrome / Edge est associé à un seul compte Build Analyzer à la fois. Chaque joueur doit utiliser son propre profil sur un ordinateur partagé. L’extension bloque l’envoi si elle détecte une autre identité Behaviour. Cliquer sur **Désactiver la synchronisation** révoque son jeton ; la simple déconnexion du site laisse le collecteur actif sur cet appareil personnel.

Les parseurs sont partagés avec le collecteur local pour conserver les mêmes identifiants de parties. Le premier import traite les parties encore accessibles sur les pages officielles, par lots de vingt parties détaillées, dans une fenêtre de deux cents cartes. Les parties incomplètes sont retentées. Une modification du format du site peut nécessiter une mise à jour de l’extension. Un historique non encore importé que Behaviour ne montre plus ne peut pas être récupéré.

## Assistant et fonctionnement local

La version GitHub Pages fournit le mode Copier/Coller de l’assistant. Les modes Codex et Clé API nécessitent toujours le serveur de la version locale. La version web n’expose pas ce serveur local, son compte Codex ou ses clés à tous les visiteurs.

Pour préparer une version web localement, utiliser les variables de `.env.example`, puis `npm run build:site`. Le ZIP de l’extension est créé dans `dist/dbd-statistics-extension.zip`. Pour tester uniquement le mode local, laisser les variables Supabase absentes et `VITE_HOSTED_APP=false`.

## Vérifications

`npm run check` vérifie les données, les tests et la compilation. `npm run test:cloud` utilise un Supabase simulé dans Chromium pour vérifier les changements de compte, la reprise du cache, le renouvellement des sessions et les erreurs réseau. `npm run test:extension` construit et charge réellement l’extension dans un Chromium isolé, sur des pages de test.

Les tests SQL de `tests/database` s’exécutent dans une base PostgreSQL vierge et isolée, avec `bootstrap.sql`, la migration puis `accounts.sql`. Le bootstrap imite uniquement l’identité Supabase pour ces tests et ne doit jamais être exécuté dans le projet Supabase réel.
