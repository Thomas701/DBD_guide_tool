# Design QA — perk card

- Source visual truth: capture intégrée au message utilisateur (390 × 187 px, densité affichée 1×).
- Implementation screenshot: `design-qa-perk-card.png` (486 × 144 px, capture du composant à 1×).
- Browser viewport: 1440 × 900 CSS px, device scale factor 1.
- State: onglet Perks, Le Piégeur sélectionné, perk Agitation, action « Ajouter au build ».
- Console: aucune erreur.

## Full-view comparison evidence

La capture source montrait le portrait comme une bande indépendante à droite : sa bordure coupait visuellement la carte et il recouvrait l'extrémité du bouton. Dans la capture d'implémentation, le portrait est une couche de fond interne, fondue dans le panneau, découpée par le rayon de 9 px de la carte. Le bouton reste au premier plan sur toute sa largeur utile.

## Focused region comparison evidence

La carte elle-même constitue la région ciblée. Mesures calculées : portrait `z-index: 0`, bouton `z-index: 2`, carte `overflow: hidden`, rayon `9px`. Le bouton traverse bien la zone occupée par le portrait sans être masqué. Aucun autre recadrage n'était nécessaire.

## Fidelity surfaces

- Fonts and typography: tailles, graisses, centrage et libellés existants conservés.
- Spacing and layout rhythm: dimensions de carte et marges du bouton conservées ; portrait élargi uniquement dans sa couche de fond.
- Colors and visual tokens: palette existante conservée ; un dégradé sombre raccorde le portrait au fond de carte.
- Image quality and asset fidelity: portrait réel existant réutilisé, sans étirement, avec `object-fit: cover` et découpage par la carte.
- Copy and content: noms de perk, propriétaire et action inchangés.

## Findings

Aucune différence P0, P1 ou P2 restante pour le correctif demandé.

## Comparison history

1. P1 initial : portrait rendu comme une colonne séparée avec bordure gauche et placé au-dessus du bouton.
2. Correctif : portrait passé en arrière-plan absolu, suppression de sa bordure, ajout du découpage parent et élévation du contenu/bouton.
3. Preuve après correctif : `design-qa-perk-card.png`, aucune erreur console, superposition et rayons conformes.

## Follow-up polish

Aucun ajustement P3 requis pour cette demande ciblée.

final result: passed
