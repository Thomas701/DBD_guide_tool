# Phase 1 — Audit de l’état initial

Ce document décrit le dépôt avant toute implémentation des phases 2 et 3. Le cahier des charges de référence est `docs/PROJECT_SPEC.md`.

## 1. Dépôt et stack

Le dépôt initial ne contient aucune application ni stack déclarée :

- aucun `package.json`, `tsconfig`, `pyproject.toml`, lockfile ou fichier de build ;
- aucun dossier `src`, modèle de domaine, importeur ou test ;
- aucun dépôt Git initialisé à la racine.

L’existant se limite à `source.txt`, `description_categories.txt`, `docs/PROJECT_SPEC.md` et au paquet d’images `DBDImages-main/`. Il n’existe donc pas d’architecture applicative à préserver. Compilation et tests sont inapplicables au baseline faute de code et de commande de test ; cela ne constitue pas un résultat de test positif.

## 2. `source.txt`

Le fichier compte 332 lignes et mélange perks, catégories, tiers, killers et notes libres.

| Donnée | Total | Conforme au nombre de colonnes | Non conforme |
|---|---:|---:|---:|
| Perks candidates | 144 | 129 à 8 colonnes | 15 |
| Killers | 42 | 41 à 6 colonnes | 1 |

Les perks malformées se trouvent aux lignes 20, 44, 45, 55, 101, 126, 130, 131, 141, 156, 186, 190, 191, 233 et 237. La ligne 288 de la Harpie contient 7 colonnes et deux difficultés (`normal;nightmare`). L’en-tête `COCHON;` et plusieurs en-têtes sans `:` interdisent un simple découpage de toutes les lignes contenant un point-virgule.

Autres constats :

- 140 perks ont explicitement `side=1` ; le champ est décalé ou absent sur 4 lignes ;
- les 129 lignes strictement valides ont toutes `icon=null` et `description=null` ;
- 2 effets valides sont `null` et 3 utilisent une valeur inconnue `+x` ou `-x` ;
- les effets emploient des crochets, parenthèses imbriquées et listes internes : un découpage naïf sur les virgules détruirait les données ;
- `le clowb` ne correspond à aucun killer déclaré ;
- `avidité humaine` contient deux fois la catégorie `aura` ;
- `hubris` porte la catégorie `recharge`, mais son cooldown vaut `null` ;
- `survivant_transport` apparaît sur 33 perks ; 32 possèdent déjà `hook`, donc la normalisation demandée doit être suivie d’une déduplication ;
- les 144 noms de perks sont uniques après une normalisation conservatrice.

Les nombres des effets ne distinguent pas de manière fiable durée, distance, pourcentage, rayon ou statut. La source contient souvent uniquement la valeur du dernier tier : les valeurs manquantes ne peuvent pas être inventées.

## 3. `description_categories.txt`

Le fichier contient :

- 1 800 lignes ;
- 151 débuts de blocs de description probables et 151 noms normalisés uniques ;
- 237 lignes vides ;
- 197 lignes avec tabulations ;
- 438 lignes contenant une référence `.png` ;
- aucun balisage HTML.

Les deux premiers champs des 151 blocs répètent le même nom français : ils ne constituent pas un couple FR/EN. Des noms de personnages, citations et références d’icônes sont parfois accolés au texte. Les paragraphes peuvent être partiellement conservés grâce aux sauts de ligne, mais la mise en forme riche du wiki ne peut pas être reconstruite avec certitude.

Seulement 46 noms correspondent directement, après normalisation conservatrice, aux 144 noms de `source.txt`. Les autres incluent de nombreuses traductions ou variantes du même concept ; ils nécessitent des alias explicites ou une validation manuelle. Un fuzzy matching ne peut servir que de suggestion.

## 4. Images

Le paquet contient 1 302 images. Pour le périmètre Killer :

- 119 icônes de perks, toutes valides, uniques, en PNG `256×256` ARGB ;
- 42 portraits de killers, tous en `512×512` ;
- 51 portraits Survivor également présents mais hors priorité actuelle.

Avec 144 perks source pour 119 icônes, au moins 25 perks ne peuvent pas recevoir une icône unique par simple cardinalité. Les noms des fichiers sont des noms anglais concaténés et ne fournissent aucun lien direct avec les noms français.

Les ensembles de killers divergent : les portraits contiennent `cenobite` et `shape`, tandis que `source.txt` contient `le jugement` et `le slasher`. Le README des images annonce un snapshot DBD 9.4.0, le dossier `powers` est vide et aucun fichier `LICENSE` n’est fourni.

## 5. Écarts avec les phases 1 à 3

| Phase | État au baseline | Écart principal |
|---|---|---|
| 1 — Audit | Sources brutes et images présentes | Aucun inventaire, diagnostic ou rapport n’existait |
| 2 — Modèle de données | Absent | Aucun modèle `Perk`, `Killer`, `Category`, `Effect`, `Condition` ou `Build`, aucun identifiant stable ni registre de catégories |
| 3 — Import/nettoyage | Absent | Aucun parseur tolérant, validateur, normalisateur, rapport JSON, donnée générée ou test d’import |

Les données existantes restent réutilisables comme sources brutes. Elles ne doivent pas être considérées comme validées : chaque enregistrement doit pouvoir être importé indépendamment, et toute ambiguïté doit être signalée sans bloquer les autres données.
