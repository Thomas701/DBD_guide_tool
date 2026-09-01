# Projet — Dead by Daylight Build Creator / Build Analyzer

## 1. Objectif général

Je souhaite développer une application permettant de **créer, sauvegarder, analyser et comparer des builds pour Dead by Daylight**.

L'objectif n'est pas simplement d'afficher quatre perks.

L'application doit comprendre les effets des perks afin de pouvoir montrer dynamiquement leur impact sur les caractéristiques du tueur selon différentes situations de jeu.

Exemple :

* vitesse de base du tueur : `4.6 m/s`
* une perk donne `+5 % de vitesse`
* l'application doit pouvoir afficher :

  * vitesse de base : `4.6 m/s`
  * bonus : `+5 %`
  * vitesse finale : `4.83 m/s`

Même principe pour :

* rayon de terreur ;
* vitesse de déplacement ;
* vitesse de franchissement ;
* vitesse de destruction ;
* vitesse de transport d'un survivant ;
* vitesse de récupération d'une attaque ;
* blocage de générateur ;
* lecture d'aura ;
* indétectable ;
* exposé ;
* épuisement ;
* soins ;
* etc.

Une grande partie des effets sont **conditionnels**.

Exemples :

* uniquement pendant une poursuite ;
* hors poursuite ;
* après avoir accroché un survivant ;
* lorsqu'on transporte un survivant ;
* à proximité d'un générateur terminé ;
* après avoir détruit un générateur ;
* pendant Bloodlust ;
* pendant X secondes ;
* avec un cooldown ;
* après l'activation d'un totem ;
* uniquement sur l'Obsession.

L'application doit donc être pensée comme un **Build Analyzer**, et pas seulement comme une bibliothèque de perks.

---

# 2. Première étape : analyser le projet existant

Avant d'écrire du code :

1. analyser l'ensemble de l'arborescence du projet ;
2. identifier la stack déjà utilisée ;
3. identifier les composants et données déjà présents ;
4. analyser :

   * `source.txt`
   * `description_categories.txt`
   * le dossier d'images DBD ;
5. ne pas remplacer inutilement une architecture existante si elle est correcte ;
6. réutiliser les composants et conventions existantes autant que possible.

Ne commence pas par coder l'interface sans avoir déterminé comment les données doivent être structurées.

---

# 3. Données actuellement disponibles

## source.txt

Le fichier `source.txt` contient actuellement une première tentative de structuration des données.

Le format théorique d'une perk est :

```text
name;side;category;character;icon;description;effect;recharge
```

Signification :

```text
name
Nom de la perk.

side
0 = survivant
1 = tueur

category
Liste des catégories auxquelles appartient la perk.

character
Nom du personnage auquel appartient la perk.
null = perk générale.

icon
Chemin/référence vers l'icône.

description
Description complète de la perk.

effect
Effets exploitables par le moteur de calcul.

recharge
Cooldown en secondes.
null = aucun cooldown.
```

IMPORTANT :

`source.txt` a été écrit manuellement et contient potentiellement :

* des colonnes manquantes ;
* des colonnes décalées ;
* des fautes de frappe ;
* des valeurs manquantes ;
* des lignes mal formées ;
* des doublons ;
* des catégories répétées ;
* des incohérences dans les noms de personnages ;
* des effets difficiles à interpréter.

Il ne faut donc PAS considérer ce fichier comme un CSV parfaitement valide.

Créer un **script d'import et de validation**.

Le script doit :

1. parser les données ;
2. détecter les anomalies ;
3. normaliser les données connues ;
4. générer un rapport des lignes problématiques ;
5. ne jamais inventer silencieusement une donnée manquante ;
6. permettre de corriger progressivement la base.

Exemple de sortie souhaitée :

```text
import-report.json

{
  "imported": 150,
  "warnings": [...],
  "errors": [...],
  "unresolvedIcons": [...],
  "unresolvedCharacters": [...],
  "unparsedEffects": [...]
}
```

---

# 4. Normalisation importante des catégories

Dans `source.txt`, deux catégories sont actuellement utilisées pour pratiquement le même concept :

```text
hook
survivant_transport
```

Je souhaite désormais conserver uniquement :

```text
hook
```

Lors de l'import :

```text
survivant_transport -> hook
```

Supprimer `survivant_transport` de la liste finale des catégories.

ATTENTION :

Cela concerne principalement le **tag de catégorie**.

Les mécaniques internes doivent rester suffisamment précises pour distinguer par exemple :

```text
hook.transport_speed
hook.hook_speed
hook.drop_speed
hook.wiggle
hook.unhook
```

Il ne faut donc pas perdre l'information métier simplement parce que les deux catégories générales sont fusionnées.

---

# 5. Catégories finales

Utiliser les catégories suivantes :

```text
speed
terror_rayon
destruction
hability_test
blood_trace
chase
aura
recharge
generator
hook
blind
indetectable
care
action
sound
totem
be_one_shot
exhausted
bloodlust
cave
exit_door
obsession
locker
```

Créer si nécessaire un fichier centralisé du type :

```text
categories.ts
```

ou :

```text
categories.json
```

afin d'éviter les chaînes écrites en dur partout dans l'application.

---

# 6. Modèle de données des perks

Je ne veux pas que les effets restent éternellement stockés sous forme de chaînes comme :

```text
+18%[speed],+12[terror_rayon]
```

Cette syntaxe peut servir comme **format d'import temporaire**, mais le moteur de l'application doit utiliser une représentation structurée.

Proposer et implémenter un modèle propre.

Exemple conceptuel :

```ts
interface Perk {
  id: string;

  name: {
    fr: string;
    en: string;
  };

  side: "killer" | "survivor";

  categories: PerkCategory[];

  characterId: string | null;

  icon: string | null;

  description: {
    fr: RichDescription | null;
    en: RichDescription | null;
  };

  effects: PerkEffect[];

  cooldown: number | null;
}
```

Pour les effets, prévoir quelque chose de suffisamment flexible.

Exemple :

```ts
interface PerkEffect {
  stat: string;

  operation:
    | "add"
    | "multiply"
    | "set"
    | "reveal"
    | "block"
    | "apply_status";

  value?: number;

  unit?:
    | "percent"
    | "meters"
    | "seconds"
    | "boolean";

  condition?: EffectCondition;

  duration?: number | null;

  cooldown?: number | null;

  target?: string;

  tierValues?: [number, number, number];
}
```

Exemple :

```json
{
  "stat": "killer.speed",
  "operation": "multiply",
  "value": 1.05,
  "condition": {
    "type": "near_completed_generator",
    "distance": 16
  },
  "duration": 5
}
```

L'objectif est que le système soit extensible.

Ne pas créer une énorme suite de `if/else` spécifiques à chaque perk.

---

# 7. Gestion des conditions

Créer un système générique permettant d'activer/désactiver des conditions.

Exemples de conditions :

```text
in_chase
not_in_chase
carrying_survivor
after_hook
survivor_hooked
obsession_hooked
generator_completed
near_completed_generator
generator_damaged
bloodlust_active
survivor_injured
survivor_downed
inside_terror_radius
outside_terror_radius
totem_active
hex_active
exit_gates_powered
exit_gate_open
perk_triggered
```

Une perk peut avoir plusieurs conditions.

Le moteur doit pouvoir expliquer **pourquoi un bonus est actuellement actif ou inactif**.

Exemple :

```text
Piles incluses

+5 % vitesse

Condition :
À moins de 16 mètres d'un générateur terminé.

État actuel :
ACTIVE

4.60 m/s -> 4.83 m/s
```

---

# 8. Les tueurs

Le format actuellement prévu est :

```text
name;speed;terror_rayon;size;tierlist;difficulty
```

Exemple de modèle :

```ts
interface Killer {
  id: string;

  name: {
    fr: string;
    en: string;
  };

  speed: number;

  terrorRadius: number;

  size:
    | "small"
    | "normal"
    | "big";

  tier:
    | "S+"
    | "S-"
    | "A+"
    | "A-"
    | "B+"
    | "B-"
    | "C+"
    | "C-"
    | "D";

  difficulty:
    | "easy"
    | "normal"
    | "difficult"
    | "nightmare";
}
```

Tier list :

```text
S+
S-
A+
A-
B+
B-
C+
C-
D
```

Le script d'import doit également valider les données des killers et signaler les lignes ayant un nombre de colonnes incorrect.

---

# 9. Icônes des perks

Les icônes se trouvent notamment dans :

```text
DBDImages-main\DBDImages-main\images\perks\killer
```

Problème :

les noms des fichiers sont principalement basés sur les **noms anglais des perks**, tandis que l'interface doit pouvoir afficher les noms français.

Créer une vraie liaison entre :

```text
perk id
nom anglais
nom français
nom du fichier PNG
```

Exemple conceptuel :

```json
{
  "id": "agitation",
  "name": {
    "en": "Agitation",
    "fr": "Agitation"
  },
  "icon": "/images/perks/killer/agitation.png"
}
```

Pour les perks dont les noms FR et EN diffèrent :

```json
{
  "id": "nurses-calling",
  "name": {
    "en": "A Nurse's Calling",
    "fr": "Vocation de l'infirmière"
  },
  "icon": "/images/perks/killer/aNursesCalling.png"
}
```

Créer un système de normalisation des noms :

* minuscules ;
* accents ;
* apostrophes ;
* espaces ;
* tirets ;
* caractères spéciaux.

Mais ne pas se baser exclusivement sur un fuzzy matching dangereux.

Créer si nécessaire une table explicite :

```text
perk-aliases.json
```

Toutes les icônes non résolues doivent apparaître dans le rapport d'import.

---

# 10. Descriptions des perks

Les descriptions longues ne sont pas correctement intégrées dans `source.txt`.

Le fichier `description_categories.txt` contient une source brute de nombreuses descriptions de perks.

Ces données proviennent initialement de :

```text
https://deadbydaylight.wiki.gg/wiki/Perks
```

Problème actuel :

la récupération sous forme de texte brut détruit une partie de la mise en page du wiki.

Je souhaite conserver autant que possible la structure visuelle de la description :

* paragraphes ;
* retours à la ligne ;
* listes ;
* valeurs ;
* mots importants ;
* effets d'état ;
* références à une aura ;
* citations ;
* éventuelles petites icônes intégrées.

Ne pas simplement faire :

```text
element.innerText
```

Si les données doivent être récupérées depuis le HTML, créer plutôt un convertisseur contrôlé :

```text
HTML wiki
     ↓
parser
     ↓
rich description interne
     ↓
renderer React/UI
```

Ne jamais injecter directement du HTML externe non nettoyé.

Utiliser une whitelist stricte des éléments autorisés.

Par exemple :

```text
p
br
strong
em
ul
ol
li
span sémantique
```

Les images provenant du wiki doivent si possible être transformées en références internes plutôt qu'en HTML distant.

---

# 11. Français / Anglais

L'application doit proposer un changement de langue :

```text
FR | EN
```

Le changement doit concerner au minimum :

* nom des perks ;
* description ;
* catégories affichées ;
* interface ;
* noms des tueurs lorsque nécessaire ;
* états et conditions.

L'identifiant d'une perk ne doit jamais dépendre de la langue.

Exemple :

```text
id = nurses-calling

FR = Vocation de l'infirmière
EN = A Nurse's Calling
```

L'application continue donc de fonctionner exactement de la même manière lorsqu'on change de langue.

Éviter de faire une traduction automatique à chaque affichage.

Les traductions doivent être stockées dans les données/locales.

Si une traduction manque :

1. utiliser la langue disponible ;
2. signaler éventuellement la donnée comme incomplète ;
3. ne pas inventer silencieusement une traduction présentée comme officielle.

---

# 12. Écran principal — sélection du tueur

Le parcours principal doit commencer par :

```text
Choisir un tueur
```

Afficher les tueurs sous forme de cartes ou grille.

Chaque tueur peut afficher :

* portrait si disponible ;
* nom ;
* vitesse ;
* rayon de terreur ;
* taille ;
* tier ;
* difficulté.

Ajouter :

* recherche ;
* éventuellement filtres ;
* tri par tier ;
* tri par difficulté ;
* tri par vitesse.

Une fois le tueur sélectionné, ouvrir le **Build Builder**.

---

# 13. Build Builder

Disposition souhaitée, adaptée si nécessaire à l'écran :

```text
┌─────────────────────────────────────────────────────┐
│ Killer sélectionné                                  │
│ Ghost Face                                          │
│ 4.6 m/s | TR 24 m | Tier D | Difficult              │
└─────────────────────────────────────────────────────┘

┌──────────────────┐   ┌──────────────────────────────┐
│ Filtres          │   │ Build                        │
│                  │   │                              │
│ recherche        │   │ [perk] [perk] [perk] [perk] │
│ catégories       │   │                              │
│ personnage       │   └──────────────────────────────┘
│ cooldown         │
│ etc.             │   ┌──────────────────────────────┐
└──────────────────┘   │ Analyse du build             │
                       │                              │
┌──────────────────┐   │ Vitesse                     │
│ Liste perks      │   │ Base     4.60 m/s           │
│                  │   │ Actuelle 4.83 m/s           │
│ icon             │   │ +5 %                        │
│ name             │   │                              │
│ categories       │   │ Rayon de terreur            │
│ description      │   │ Base     24 m               │
└──────────────────┘   │ Actuel   32 m               │
                       └──────────────────────────────┘
```

Ce wireframe est indicatif.

Faire une interface propre et moderne inspirée visuellement de Dead by Daylight sans sacrifier la lisibilité.

---

# 14. Sélection des perks

Un build Dead by Daylight contient au maximum :

```text
4 perks
```

Permettre :

* clic pour ajouter ;
* clic pour retirer ;
* éventuellement drag & drop ;
* remplacer facilement une perk ;
* empêcher les doublons ;
* vider le build.

Afficher clairement les quatre slots.

---

# 15. Filtres des perks

Créer un système de filtres cumulables.

Minimum :

### Recherche

Recherche par :

* nom français ;
* nom anglais.

### Personnage

Exemple :

```text
Tous
Générales
Piégeur
Infirmière
Ghost Face
...
```

### Catégories

Exemple :

```text
☐ Speed
☐ Terror Radius
☐ Generator
☐ Aura
☐ Chase
☐ Hook
☐ Totem
☐ Indetectable
...
```

Prévoir les modes :

```text
MATCH ANY
MATCH ALL
```

Exemple :

```text
generator + aura

MATCH ANY :
perk avec generator OU aura

MATCH ALL :
perk possédant generator ET aura
```

Ajouter également si pertinent :

```text
Avec cooldown
Sans cooldown
```

Le moteur de filtrage doit rester performant même avec toutes les perks du jeu.

---

# 16. Carte d'une perk

Une perk affichée dans la bibliothèque doit montrer au minimum :

```text
[ICON]

Nom de la perk
Personnage

Badges :
Aura
Generator
Hook
...

Cooldown : 30 s
```

Au clic ou au survol, afficher davantage d'informations.

Possibilité d'utiliser :

* tooltip ;
* popover ;
* panneau latéral ;
* modal.

Pour la description détaillée, préférer un panneau lisible plutôt qu'un tooltip minuscule.

---

# 17. Analyse du build

C'est une partie centrale du projet.

Pour le tueur sélectionné, afficher :

```text
BASE
```

puis :

```text
BUILD ACTUEL
```

Exemple :

```text
VITESSE

Base
4.60 m/s

Build
4.83 m/s

Différence
+0.23 m/s
+5 %
```

Même chose pour le rayon de terreur :

```text
RAYON DE TERREUR

Base
24 m

Build
32 m

Différence
+8 m
```

---

# 18. Scénarios / conditions

Ajouter une zone :

```text
Conditions de simulation
```

Les conditions affichées doivent idéalement dépendre des perks actuellement équipées.

Exemple :

```text
☐ En poursuite
☐ Transporte un survivant
☐ Un survivant vient d'être accroché
☐ Proche d'un générateur terminé
☐ Bloodlust actif
☐ Obsession blessée
☐ Portes alimentées
```

Lorsqu'une condition est activée :

* recalculer immédiatement le build ;
* afficher les perks devenues actives ;
* afficher les statistiques modifiées.

Exemple :

```text
Vitesse : 4.60 m/s

Active "Proche d'un générateur terminé"

Piles incluses ACTIVE
+5 %

Vitesse : 4.83 m/s
```

---

# 19. Explication détaillée du calcul

L'utilisateur doit pouvoir comprendre d'où vient chaque modification.

Exemple :

```text
Vitesse finale : 4.83 m/s

4.60 m/s
+ Piles incluses : +5 %
-------------------------
4.83 m/s
```

Pour plusieurs perks :

```text
Rayon de terreur

Base : 32 m

Agitation :
+12 m
condition : transporte un survivant

Inquiétant :
+30 %

Résultat :
...
```

IMPORTANT :

Ne pas supposer arbitrairement l'ordre de cumul des effets.

Le moteur doit distinguer :

```text
addition absolue
bonus multiplicatif
set d'une valeur
cap
effet temporaire
effet permanent
```

et rendre le calcul traçable.

---

# 20. Perks actives / inactives

Dans le build, indiquer visuellement :

```text
ACTIVE
INACTIVE
COOLDOWN
```

Exemple :

```text
Poursuite furtive
ACTIVE — 12 s restantes

Ténèbres révélées
COOLDOWN — 18 s

Piles incluses
INACTIVE
Condition manquante :
être à moins de 16 m d'un générateur terminé
```

Un véritable timer interactif n'est pas indispensable pour le premier MVP, mais l'architecture doit permettre son ajout.

---

# 21. Sauvegarde des builds

Permettre de :

```text
Créer un build
Nommer le build
Sauvegarder
Modifier
Dupliquer
Supprimer
```

Exemple :

```text
Ghost Face — Terror Radius

Killer:
Ghost Face

Perks:
- ...
- ...
- ...
- ...
```

Pour un MVP local, `localStorage` ou IndexedDB peut être acceptable si aucune base de données n'existe déjà.

Mais isoler cette logique derrière une couche de repository/service afin de pouvoir passer plus tard facilement à :

* SQLite ;
* API ;
* compte utilisateur ;
* synchronisation cloud.

Exemple conceptuel :

```ts
interface Build {
  id: string;
  name: string;
  killerId: string;
  perkIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

---

# 22. Architecture recommandée

Séparer clairement :

```text
/data
/import
/domain
/services
/components
/features
/locales
```

Exemple :

```text
src/
  data/
    perks/
    killers/
    categories/

  domain/
    perk.ts
    killer.ts
    build.ts
    effects.ts
    conditions.ts

  services/
    buildCalculator.ts
    perkFilter.ts
    descriptionParser.ts

  features/
    killer-selector/
    perk-browser/
    build-editor/
    build-analyzer/
    saved-builds/

  locales/
    fr/
    en/
```

Adapter cette structure à la stack existante plutôt que de l'imposer si le projet possède déjà une architecture cohérente.

---

# 23. Moteur de calcul

Créer un moteur indépendant de l'UI.

Conceptuellement :

```ts
calculateBuild({
  killer,
  perks,
  scenario
})
```

Retour souhaité :

```ts
{
  baseStats,
  finalStats,
  deltas,
  activeEffects,
  inactiveEffects,
  explanations
}
```

Exemple :

```json
{
  "speed": {
    "base": 4.6,
    "final": 4.83,
    "delta": 0.23,
    "effects": [
      {
        "perkId": "batteries-included",
        "value": 5,
        "unit": "percent",
        "active": true
      }
    ]
  }
}
```

Ce moteur doit être testable indépendamment des composants graphiques.

---

# 24. Tests

Ajouter des tests unitaires au minimum pour :

### Import

```text
survivant_transport -> hook
```

### Calcul de vitesse

```text
4.6 + 5 % = 4.83
```

### Rayon de terreur

Tester :

```text
bonus fixe
bonus %
set de valeur
condition active
condition inactive
```

### Filtres

Tester :

```text
MATCH ANY
MATCH ALL
personnage
recherche FR
recherche EN
```

### Données incorrectes

Une ligne invalide dans `source.txt` ne doit pas faire planter toute l'importation.

---

# 25. Gestion des erreurs de données

Je veux une philosophie stricte :

```text
Ne jamais deviner silencieusement.
```

Si une donnée est ambiguë :

```text
warning
```

Si elle est impossible à parser :

```text
unresolved
```

Exemple :

```json
{
  "perk": "murmures",
  "field": "effect",
  "raw": "+x[sound]",
  "status": "unresolved"
}
```

L'application peut continuer de fonctionner même si toutes les perks n'ont pas encore un effet calculable.

Une perk peut donc avoir :

```text
description disponible
icon disponible
categories disponibles
effects partiellement inconnus
```

et rester affichable.

---

# 26. Important : ne pas bloquer le projet à cause des données

Il y aura forcément des données incomplètes.

Séparer :

```text
Perk affichable
```

de :

```text
Perk entièrement simulable
```

Exemple :

une perk dont l'effet n'est pas encore compris doit tout de même apparaître dans la bibliothèque et pouvoir être ajoutée à un build.

Afficher éventuellement :

```text
Analyse partielle
```

si certaines perks du build ne sont pas encore supportées par le moteur de calcul.

---

# 27. Priorité actuelle : Killer Builder

Même si le champ :

```text
side
```

permet à terme de gérer :

```text
killer
survivor
```

le premier objectif est de réaliser correctement la partie :

```text
KILLER
```

L'architecture doit cependant être compatible avec l'ajout futur du système Survivor sans nécessiter de réécrire tout le projet.

---

# 28. UX attendue

Je veux que l'application soit :

* rapide ;
* claire ;
* visuelle ;
* agréable à utiliser ;
* proche de l'univers Dead by Daylight ;
* utilisable sur desktop ;
* responsive ;
* adaptée à de nombreuses perks ;
* simple pour comparer plusieurs builds.

Éviter :

* les énormes formulaires ;
* les descriptions affichées partout simultanément ;
* trop de texte sans hiérarchie ;
* les filtres occupant la moitié de l'écran ;
* les modales à répétition.

Utiliser :

* cartes ;
* icônes ;
* badges ;
* tooltips lorsque pertinent ;
* panneaux repliables ;
* sidebar ;
* recherche instantanée ;
* feedback visuel sur les perks sélectionnées.

---

# 29. Ordre de travail

Procéder dans cet ordre :

## Phase 1 — Audit

Analyser :

```text
projet
source.txt
description_categories.txt
images
stack existante
```

Identifier les problèmes.

## Phase 2 — Modèle de données

Créer :

```text
Perk
Killer
Category
Effect
Condition
Build
```

## Phase 3 — Import

Créer les scripts permettant de transformer les fichiers actuels en données propres et validées.

## Phase 4 — Icônes

Créer le mapping :

```text
FR <-> EN <-> PNG
```

## Phase 5 — Bibliothèque

Créer :

```text
liste perks
recherche
filtres
descriptions
```

## Phase 6 — Killer selector

Créer la sélection du tueur.

## Phase 7 — Build editor

Créer les quatre slots de perks.

## Phase 8 — Build analyzer

Créer :

```text
base stats
conditions
active effects
final stats
explanation
```

## Phase 9 — Sauvegarde

Ajouter la gestion des builds.

## Phase 10 — Internationalisation

Finaliser :

```text
FR
EN
```

---

# 30. Ce que j'attends de toi

Je ne veux pas uniquement une proposition théorique.

Tu dois :

1. analyser les fichiers et le code existants ;
2. choisir une architecture cohérente avec le projet ;
3. corriger/nettoyer la couche de données ;
4. créer le système d'import ;
5. mettre en place le modèle de données ;
6. développer l'interface ;
7. créer le moteur de calcul ;
8. ajouter les filtres ;
9. ajouter la sauvegarde des builds ;
10. ajouter les tests nécessaires ;
11. vérifier que l'application compile et fonctionne.

Lorsque tu rencontres une donnée ambiguë dans `source.txt`, ne bloque pas tout le développement.

Fais le meilleur choix architectural possible, marque la donnée comme non résolue et continue.

À la fin, fournis un résumé indiquant :

```text
- fichiers créés
- fichiers modifiés
- architecture retenue
- données importées
- anomalies détectées
- fonctionnalités terminées
- fonctionnalités partielles
- éléments restant à compléter
```

---

# 31. Critère principal de réussite

Je dois pouvoir :

1. ouvrir l'application ;
2. choisir un tueur ;
3. voir ses statistiques de base ;
4. parcourir les perks avec leurs icônes ;
5. rechercher et filtrer les perks ;
6. sélectionner jusqu'à quatre perks ;
7. activer différentes conditions de jeu ;
8. voir immédiatement quelles perks sont actives ;
9. voir comment elles modifient la vitesse, le rayon de terreur ou d'autres statistiques ;
10. comprendre d'où vient chaque modification ;
11. sauvegarder mon build ;
12. changer l'application entre français et anglais.

Le point le plus important est :

> **l'application doit permettre de comprendre concrètement ce que change un build sur le tueur sélectionné et dans quelles conditions ces changements s'appliquent.**
