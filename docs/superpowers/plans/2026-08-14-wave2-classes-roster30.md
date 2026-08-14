# WAVE 2 ITEM D — Six classes lisibles et roster de 30

## Résultat visé et décisions verrouillées

Faire passer le roster final de **26 créatures / 78 techniques / 26 talents** (après Deuilastre et Aubéastre) à **30 créatures / 90 techniques / 30 talents**, avec exactement cinq créatures dans chacun des six types canoniques et seulement six classes immédiatement compréhensibles.

- Remplacer le champ trompeur `role` et ses quinze libellés par `classId` et six classes : `tank`, `assassin`, `healer`, `controller`, `breaker`, `duelist`.
- Ne pas déduire une classe de l'ancien nom. La migration ci-dessous part des quatre statistiques et des verbes réels de chaque kit.
- Garder les ids de types internes `flame/tide/grove/force/mind/shadow`, les huit statuts existants et la grammaire actuelle des techniques. Aucun type, statut, jauge ou format de sauvegarde supplémentaire.
- Ajouter Flambélier (`flame`, Duelliste), Maréclat (`tide`, Duelliste), Xylocorne (`grove`, Briseur) et Pactigon (`force`, Soigneur). Avec les deux légendaires déjà planifiés, la distribution finale est 5/5/5/5/5/5 par type.
- La distribution finale des classes est 5 Remparts, 6 Assassins, 5 Soigneurs, 6 Contrôleurs, 5 Briseurs et 3 Duellistes. Aucune classe orpheline; la plus petite en compte trois.
- Les classes sont d'abord reconnues par leur pictogramme SVG et leur mot, puis seulement par une couleur volontairement sourde. Les couleurs de type restent les accents dominants des cartes et des combats.
- Item D doit être exécuté après, ou réconcilié explicitement avec, Item C (`2026-08-14-wave2-new-creatures.md`). La recommandation single-type et `dire_pinion.power: 22` de son addendum reste autoritaire. Ne pas réimplémenter différemment Deuilastre/Aubéastre.
- Le travail de visuels de statuts en cours est une dépendance de lecture, pas une zone à réécrire. Au démarrage de l'exécution, relire les versions alors présentes de `statuses.js` et des CSS, puis ajouter les classes autour de leur API finale.

## 1. Taxonomie finale

### 1.1 Contrat enfant-facing et identité visuelle

Créer `src/data/classes.js` avec `CLASS_ORDER`, `CLASSES` et un renderer `classIcon()` construit sur le même contrat que `affinityIcon()`: géométrie SVG originale en `viewBox="0 0 24 24"`, `currentColor`, libellé visible adjacent ou `<title>` localisé quand l'icône porte seule le sens. Ne pas utiliser d'emoji comme icône de production; les symboles de la table ne sont que des raccourcis de plan.

| id | FR / EN | Ce que cela veut dire pour Noam | Motif d'icône | Couleur d'accent sourde | Garde-fou d'usage |
|---|---|---|---|---|---|
| `tank` | **Rempart / Tank** | « Il encaisse et se protège : beaucoup de PV ou de Garde. » | `⬢` bouclier épais à deux couches | `#687686` ardoise | Bouclier + mot toujours visibles; la teinte ne remplace jamais l'icône. |
| `assassin` | **Assassin / Assassin** | « Il joue vite et frappe avant de disparaître, mais il tombe vite. » | `⌁` lame courte avec deux traits de vitesse | `#7D6C82` prune grisée | Silhouette de lame, jamais le seul violet de la carte. |
| `healer` | **Soigneur / Healer** | « Il rend des PV, enlève des malus ou donne des barrières aux alliés. » | `✚` cœur anguleux contenant un plus | `#647F73` sauge grisée | Plus médical géométrique, distinct de l'œil Focused et du bouclier Countering. |
| `controller` | **Contrôleur / Controller** | « Il gêne l'ennemi avec Marqué, Sonné, Enraciné ou Brûlure. » | `◎` trois anneaux reliés par une traverse | `#6B748D` bleu orage grisé | Ne pas reprendre la cible carrée du statut Marqué. |
| `breaker` | **Briseur / Breaker** | « Il prépare un très gros coup et traverse les défenses ou les bonus. » | `◫` marteau frappant une plaque fendue | `#8A6F65` argile grisée | La fissure rend le sens lisible sans rouge/orange saturé. |
| `duelist` | **Duelliste / Duelist** | « Il sait attaquer et se défendre sans gros point faible. » | `⚔` deux lames courtes croisées dans un cercle ouvert | `#817A63` bronze grisé | Cercle ouvert distinct du bouclier plein du Rempart. |

Ces six hexadécimales ne dupliquent aucune des couleurs de types actuelles (`#FF6B4A`, `#4DA6FF`, `#55C878`, `#F2B84B`, `#E879C6`, `#9B8CFF`) ni aucune des huit couleurs de statuts (`#1DA1F2`, `#C6FF00`, `#304FFE`, `#00E0A4`, `#AD1457`, `#FFEA70`, `#9C5B32`, `#F4511E`). Elles restent volontairement proches en saturation : la forme SVG, le libellé et l'ordre stable portent l'information. Dans une carte, le type conserve le fond/liseré saturé; la classe apparaît dans une petite puce neutre, contour 2 px `--class-color`, icône monochrome et texte. En contraste élevé, toutes les puces passent à `currentColor` noir/blanc avec leurs formes intactes. Tester les six motifs à 16, 20, 24 et 32 px, en niveaux de gris, à 200 % de zoom et avec les simulations de déficiences rouge-vert et bleu-jaune.

### 1.2 Méthode de profilage

La table suivante est l'audit de la base **actuelle de 24**, avant les deux légendaires en attente. Pour chaque statistique, `valeur/Pxx` est le percentile empirique mid-rank parmi ces 24 : minimum P0, maximum P100, ex æquo au rang moyen. Les verbes sont directement lus dans `src/data/moves.js`; `pose` vise l'ennemi, `gagne` vise soi, `barrière`, `soin`, `purge`, `perce`, `draine`, `recul`, `Combo` et les scalings correspondent aux champs moteur existants. Les percentiles ne deviennent pas des données de jeu : ils documentent et testent le choix de classe.

### 1.3 Reclassement des 24 créatures actuelles

| Créature | Ancien → nouveau | PV / Attaque / Garde / Vitesse | Verbes de kit réellement observés | Pourquoi cette classe correspond aux données |
|---|---|---|---|---|
| Orakyn | Contrôle → **Contrôleur** | 90/P30 · 92/P48 · 76/P43 · 88/P48 | Marque; Sonne; Combo; barrière 18; Concentré + Esquive; retire 1 malus | Statistiques médianes et deux techniques de gêne : son identité vient du contrôle, pas des dégâts. |
| Lumivox | Maestro → **Briseur** | 86/P17 · 99/P61 · 72/P37 · 96/P61 | 3 coups; Enracine; gagne Hâte; Signature 57/Combo à priorité −1 | Corps fragile, bon tempo et énorme finale préparée : c'est un canon à charge, pas une classe musicale isolée. |
| Mnemora | Mystique → **Contrôleur** | 98/P52 · 84/P28 · 82/P52 · 82/P39 | Draine; Sonne 3 tours; Esquive + Riposte + Concentré; barrière; cleanse | Ses dégâts sont faibles; elle ralentit le duel et se donne le temps de recommencer. |
| Prismage | Briseur → **Briseur** | 84/P13 · 108/P80 · 70/P26 · 91/P52 | Perce barrière; Esquive + barrière; purge 2; Marque; Signature 42 | Attaque haute, corps fragile et deux réponses directes aux défenses : le libellé actuel est déjà juste. |
| Kordane | Duelliste → **Duelliste** | 100/P57 · 105/P74 · 85/P57 · 100/P65 | Scaling Vitesse; gros coup 54 avec auto-Marqué; Concentré + Hâte | Les quatre statistiques sont bonnes sans extrême et le kit alterne prise de risque, préparation et frappe. |
| Brontusk | Avant-garde → **Rempart** | 114/P87 · 96/P57 · 94/P85 · 55/P13 | Recul; Sonne; barrière 17; puissance sur PV manquants | Très robuste et lent; son retour de dégâts arrive après avoir encaissé. |
| Ferrax | Assassin → **Assassin** | 82/P9 · 104/P70 · 69/P17 · 124/P96 | 3 coups prioritaires; gagne Hâte; scaling Vitesse; consomme Hâte | Le profil verre-canon rapide est presque textbook. |
| Monolith | Sentinelle → **Rempart** | 122/P91 · 82/P17 · 108/P91 · 43/P4 | Sonne; barrière 14; Signature lente 47 qui perce et Combo | PV/Garde presque maximaux et vitesse presque minimale : Sentinelle et Rempart décrivaient la même chose. |
| Abyssar | Rempart → **Rempart** | 125/P96 · 76/P7 · 118/P96 · 56/P17 | Barrière sur attaque; Sonne + Enracine; barrière 30; cleanse perso/équipe | Le corps le plus défensif et la plus grosse barrière justifient sans ambiguïté Rempart. |
| Riptalon | Assassin → **Assassin** | 88/P26 · 103/P65 · 70/P26 · 119/P91 | Priorité; Marque; Hâte; Signature 44/Combo | Très rapide, fragile et orienté ouverture/cash-out. |
| Nymbloom | Soigneur → **Soigneur** | 108/P80 · 72/P0 · 89/P70 · 78/P30 | Soin d'équipe 6,5 %; Marque + petite barrière; drain + cleanse | Attaque minimale et trois formes de survie alliée/personnelle : aucune ambiguïté. |
| Voltide | Perturbateur → **Contrôleur** | 92/P39 · 108/P80 · 72/P37 · 102/P72 | Marque prioritaire; 3 coups + Sonne; Signature Sonne/Combo | Ses stats pourraient attaquer, mais chaque bouton prépare ou prolonge un malus; Perturbateur fusionne donc avec Contrôleur. |
| Calderoc | Artillerie → **Briseur** | 95/P48 · 120/P96 · 70/P26 · 75/P26 | Brûle; Signature 59 lente avec auto-Marqué; soin + Concentré | Attaque quasi maximale, Garde basse et salve lente : l'orphelin Artillerie devient le Briseur lourd évident. |
| Pyrolynx | Assassin → **Assassin** | 80/P0 · 112/P87 · 62/P0 · 126/P100 | Priorité + scaling PV pleins; Marque + Brûle; 5 coups/Combo | Minimum de PV/Garde, maximum de Vitesse, forte Attaque : référence visuelle de la classe. |
| Magmoth | Avant-garde → **Rempart** | 108/P80 · 84/P28 · 94/P85 · 52/P9 | Barrière + Riposte; recul + Brûlure; auto-soin 18 % + cleanse | Lent, solide et doté de deux boutons défensifs; Avant-garde masquait un Rempart de survie. |
| Solflare | Berserker → **Briseur** | 91/P35 · 125/P100 · 66/P11 · 94/P57 | Perce; Hâte + Concentré; Signature 67, purge totale, recul 28 % | Son attaque est maximale mais sa vitesse seulement P57 : il prépare le plus gros impact, donc Briseur plutôt qu'Assassin. |
| Virelia | Soutien → **Soigneur** | 105/P74 · 76/P7 · 90/P74 · 85/P43 | Attaque-soin équipe; soin perso 23 %; barrières/soin/cleanse équipe | Soutien et Soigneur recouvraient la même promesse; Virelia remplit les trois verbes de la nouvelle définition. |
| Mossaur | Rempart → **Rempart** | 134/P100 · 78/P13 · 121/P100 · 39/P0 | Drain; barrière 17 + Riposte; gros coup lent avec auto-Sonné/Enraciné | Les deux maxima défensifs et la vitesse minimale en font l'autre référence de Rempart. |
| Florafae | Mystique → **Soigneur** | 102/P65 · 91/P43 · 86/P63 · 102/P72 | Sonne; soin 8 % + cleanse d'équipe; scaling sur malus | Son bouton central soigne tout le trio; le contrôle sert le soin et ne justifie pas une classe Mystique séparée. |
| Thornox | Contrôle → **Contrôleur** | 101/P61 · 94/P52 · 91/P78 · 73/P22 | Brûle; Enracine + Riposte; Combo + drain | Deux malus persistants et un finisher conditionnel définissent le piègeur. |
| Farfombre | Ruse → **Assassin** | 81/P4 · 86/P35 · 66/P11 · 104/P78 | Marque prioritaire; Sonne + Esquive; fuite Esquive/Hâte/barrière/cleanse | L'Attaque est modeste, mais le corps P4/P11 et la priorité-évasion décrivent un assassin harceleur qui frappe puis disparaît; garder « Ruse » créerait encore un singleton. |
| Nocturnyx | Contrôle → **Contrôleur** | 94/P43 · 83/P22 · 77/P48 · 106/P83 | multi-coup + Sonne; support qui Sonne; Signature Combo | Faible Attaque, haute Vitesse et deux moyens de Sonner : le kit gagne par interdiction. |
| Umbrawl | Assassin → **Assassin** | 87/P22 · 118/P91 · 65/P4 · 115/P87 | priorité + scaling PV pleins; Esquive + Hâte; exécution sous 30 % | Fragile, très rapide, très offensif et doté d'un execute : autre référence de la classe. |
| Hexalune | Mystique → **Contrôleur** | 103/P70 · 90/P39 · 86/P63 · 80/P35 | Brûle; drain + recul; Marque + Sonne + barrière | Le double malus de sa Signature et la Brûlure portent plus son identité que ses dégâts moyens. |

### 1.4 Les deux légendaires en attente

| Créature | Ancien plan → nouveau | Profil de données déjà verrouillé | Justification |
|---|---|---|---|
| Deuilastre | Briseur → **Assassin** | 79 PV, 124 Attaque, 64 Garde, 122 Vitesse; priorité, Marqué, Sonné, Brûlure, purge d'équipe | C'est explicitement le verre-canon le plus rapide et fragile du plan Item C. La purge est son outil d'assassinat, pas une raison de conserver Briseur. |
| Aubéastre | Soutien → **Soigneur** | 79 PV, 73 Attaque, 64 Garde, 122 Vitesse; zéro attaque, soins, barrières, cleanses, relève protégée | Son tour sert toujours à sauver ou préparer un allié; Soutien/Soigneur fusionnent sans perte d'information. |

### 1.5 Appartenance finale des 30

| Classe | Membres finaux | Nombre |
|---|---|---:|
| **Rempart** | Brontusk, Monolith, Abyssar, Magmoth, Mossaur | **5** |
| **Assassin** | Ferrax, Riptalon, Pyrolynx, Farfombre, Umbrawl, Deuilastre | **6** |
| **Soigneur** | Nymbloom, Virelia, Florafae, Aubéastre, Pactigon | **5** |
| **Contrôleur** | Orakyn, Mnemora, Voltide, Thornox, Nocturnyx, Hexalune | **6** |
| **Briseur** | Lumivox, Prismage, Calderoc, Solflare, Xylocorne | **5** |
| **Duelliste** | Kordane, Flambélier, Maréclat | **3** |

Test de contrat obligatoire : `CLASS_ORDER.length === 6`, chaque `classId` est connu, chaque classe a au moins deux membres, la somme des membres vaut 30, et la distribution exacte triée vaut `[3,5,5,5,6,6]`. Les classes ne modifient directement aucun calcul de dégâts ou règle de combat; elles expliquent les kits et servent à chercher/composer.

## 2. Quatre nouvelles créatures

Les quatre fiches utilisent seulement les verbes déjà présents dans `moves.js` (`power`, `priority`, `cooldown`, `hits`, `targetStatuses`, `selfStatuses`, `barrier`, `teamBarrier`, `teamHealRatio`, `teamCleanse`, `cleanse`, `drain`, `purge`, `ignoreBarrier`, `combo`, `scaling`, `scaleAmount`) et les huit ids de statut actuels. Leurs talents nécessitent quatre petits hooks déterministes, mais aucune nouvelle grammaire de technique.

### 2.1 Flambélier — Feu / Duelliste

Fantasy : un bélier de braise qui provoque l'adversaire, pare une frappe, puis gagne le duel quand ses propres forces baissent. Il remplit la classe la plus mince sans concurrencer Pyrolynx (Assassin), Calderoc/Solflare (Briseurs) ou Magmoth (Rempart).

```js
flambelier: {
  id: 'flambelier',
  affinity: 'flame',
  classId: 'duelist',
  passive: 'burning_code',
  maxHp: 103,
  attack: 102,
  guard: 88,
  speed: 91,
  moves: ['ember_feint', 'red_horn', 'last_spark_duel'],
},
```

Les statistiques sont volontairement centrales : aucun nouveau maximum, assez de Garde/PV pour utiliser Riposte, et pas assez de Vitesse/Attaque pour usurper la lecture Assassin.

```js
ember_feint: {
  id: 'ember_feint', owner: 'flambelier', affinity: 'flame', kind: 'damage',
  power: 23, priority: 1, cooldown: 1,
  selfStatuses: [{ id: 'countering', duration: 2 }],
  visual: 'ember_feint',
},
red_horn: {
  id: 'red_horn', owner: 'flambelier', affinity: 'flame', kind: 'damage',
  power: 34, priority: 0, cooldown: 1,
  selfStatuses: [{ id: 'marked', duration: 2 }],
  visual: 'red_horn',
},
last_spark_duel: {
  id: 'last_spark_duel', owner: 'flambelier', affinity: 'flame', kind: 'damage',
  power: 45, priority: 0, cooldown: 2,
  scaling: 'missingHp', scaleAmount: 0.55, cleanse: 1,
  visual: 'last_spark_duel', signature: true,
},
```

| Technique | FR | EN | Lecture mécanique |
|---|---|---|---|
| `ember_feint` | **Feinte de braise** — « Prioritaire. Gagne Riposte pendant 2 tours. » | **Ember Feint** — “Priority. Gains Countering for 2 turns.” | Attaque légère de posture; son cooldown empêche Riposte permanente. |
| `red_horn` | **Corne rouge** — « Frappe lourde; se Marque pendant 2 tours. » | **Red Horn** — “Heavy hit; Marks itself for 2 turns.” | Risque lisible en échange du meilleur bouton normal. |
| `last_spark_duel` | **Duel de la dernière étincelle** — « Signature : plus puissant blessé; retire un malus. » | **Last Spark Duel** — “Signature: stronger while hurt; removes one penalty.” | Retour de duel : le scaling existe déjà, mais aucune Signature ne le combine aujourd'hui à une cleanse offensive. |

Talent dans `passives.js` : `burning_code: { icon: '⟐' }`.

**Code brûlant / Burning Code** : quand Riposte de Flambélier se déclenche et renvoie des dégâts, l'attaquant survivant reçoit `burning` pendant 2 tours, au maximum une fois par tour. Le statut arrive après les dégâts réfléchis; aucun proc si l'attaque rate, inflige 0 PV direct ou met Flambélier K.O. avant le hook Countering. Émettre l'événement de talent puis l'événement de statut ordinaires.

Lore FR :

> Les jeunes Flambéliers choisissent une pierre noire et la défendent jusqu'à ce qu'elle rougisse sous leurs sabots. Ils ne chargent jamais un adversaire à terre : leur feu ne brûle vraiment que lorsqu'un duel est encore indécis. On raconte qu'un Flambélier qui respecte cent combats peut rallumer un volcan d'un seul coup de corne.

Lore EN :

> Young Flambéliers choose one black stone and defend it until it glows beneath their hooves. They never charge a fallen opponent: their fire burns brightest while a duel is still undecided. Stories say one that honors a hundred battles can relight a volcano with a single horn strike.

Brief prêt pour `art/briefs/flambelier.json` :

```json
{
  "id": "flambelier",
  "seed": 814203,
  "image_size": { "width": 128, "height": 128 },
  "no_background": true,
  "description": "Original fire-type ram creature named Flambelier, a compact non-humanoid quadruped duelist with an athletic charcoal-black body, cloven obsidian hooves, a short proud muzzle, and two large asymmetrical spiral horns shaped like heated fencing guards. Ember-red cracks glow inside the horns and along small shoulder plates; a narrow flame crest and a few sparks trail backward without obscuring the silhouette. Alert side-on battle stance facing right, one forehoof raised as if inviting a duel, sturdy rather than bulky and clearly distinct from a tank. Rich premium fantasy pixel art matching the Arene de Noam roster and Orakyn style anchor: crisp deliberate pixel clusters, dense selective cluster shading, subtle dithered gradients, controlled dark outline weight, readable face and horn silhouette at thumbnail size. Full body centered with generous padding, transparent background. No armor clothing, rider, handheld weapon, text, logo, gore, extra limbs, photorealism, or resemblance to an existing franchise creature."
}
```

### 2.2 Maréclat — Eau / Duelliste

Fantasy : une crevette-mante escrimeuse dont les pinces translucides font office de fleurets. Elle esquive, revient avec le reflux et se soigne par une Signature à deux touches. Elle est plus équilibrée et endurante que l'Assassin Riptalon.

```js
mareclat: {
  id: 'mareclat',
  affinity: 'tide',
  classId: 'duelist',
  passive: 'perfect_ebb',
  maxHp: 99,
  attack: 100,
  guard: 84,
  speed: 107,
  moves: ['foam_foil', 'ebb_cut', 'mirror_tide'],
},
```

```js
foam_foil: {
  id: 'foam_foil', owner: 'mareclat', affinity: 'tide', kind: 'damage',
  power: 22, priority: 1, cooldown: 1,
  selfStatuses: [{ id: 'evasive' }],
  visual: 'foam_foil',
},
ebb_cut: {
  id: 'ebb_cut', owner: 'mareclat', affinity: 'tide', kind: 'damage',
  power: 28, priority: 0, cooldown: 0, drain: 0.15,
  visual: 'ebb_cut',
},
mirror_tide: {
  id: 'mirror_tide', owner: 'mareclat', affinity: 'tide', kind: 'damage',
  power: 19, hits: 2, priority: 0, cooldown: 2,
  drain: 0.25, cleanse: 1,
  selfStatuses: [{ id: 'haste', duration: 2 }],
  visual: 'mirror_tide', signature: true,
},
```

| Technique | FR | EN | Lecture mécanique |
|---|---|---|---|
| `foam_foil` | **Fleuret d'écume** — « Prioritaire. Gagne Esquive; recharge 1 tour. » | **Foam Foil** — “Priority. Gains Evasive; recharges for 1 turn.” | Une parade proactive coûte un tour de recharge et une puissance basse. |
| `ebb_cut` | **Taille de reflux** — « Draine 15 % des dégâts infligés. » | **Ebb Cut** — “Drains 15% of damage dealt.” | Bouton stable de duel, moins explosif que les Assassins Eau. |
| `mirror_tide` | **Marée miroir** — « Signature : frappe deux fois, draine 25 %, retire un malus. » | **Mirror Tide** — “Signature: hits twice, drains 25%, removes one penalty.” | Première Signature multi-hit de sustain qui cleanse et prépare Hâte; pas de Marqué/Combo. |

Talent : `perfect_ebb: { icon: '≍' }`.

**Reflux parfait / Perfect Ebb** : quand l'Esquive de Maréclat est consommée par une attaque adverse, Maréclat gagne `haste` pendant 2 tours, au maximum une fois par tour. L'Esquive doit réellement annuler l'attaque; une purge qui retire Esquive sans miss ne déclenche rien. Le hook se place dans la branche moteur qui consomme déjà `evasive`, après l'événement de miss.

Lore FR :

> Maréclat polit ses pinces contre les récifs jusqu'à y voir le reflet des nuages. Elle ne nage jamais en ligne droite : chaque vague devient une feinte, chaque recul un nouvel angle d'attaque. Les pêcheurs la saluent en croisant deux rames, et elle répond parfois d'une étincelle turquoise.

Lore EN :

> Maréclat polishes its claws against reefs until clouds shine in their reflection. It never swims in a straight line: every wave becomes a feint and every retreat opens a new angle. Fishers salute it with crossed oars, and sometimes it answers with a turquoise spark.

Brief prêt pour `art/briefs/mareclat.json` :

```json
{
  "id": "mareclat",
  "seed": 814204,
  "image_size": { "width": 128, "height": 128 },
  "no_background": true,
  "description": "Original water-type mantis-shrimp creature named Mareclat, an elegant small non-humanoid aquatic duelist with a curved segmented teal-and-deep-blue shell, four short swimming legs, a fan tail, bright attentive eyes on compact stalks, and two long translucent foreclaws shaped naturally like narrow fencing foils. Pearly cyan edges, coral-pink joint accents, and tiny suspended foam beads suggest fast tidal motion. Three-quarter side battle stance facing right, one claw extended and the other held in guard, agile but not a glass cannon. Rich premium fantasy pixel art matching the Arene de Noam roster and Orakyn style anchor: crisp deliberate pixel clusters, dense selective cluster shading, subtle dithered gradients, selective navy outline weight, clean readable silhouette at thumbnail size. Full body centered with generous padding, transparent background. No humanoid hands, clothing, literal metal swords, text, logo, gore, extra eyes beyond the intended pair, photorealism, or resemblance to an existing franchise creature."
}
```

### 2.3 Xylocorne — Plante / Briseur

Fantasy : un scarabée-cerf taillé dans le bois vivant, dont la corne est un coin de bûcheron. Il attaque les barrières, immobilise sa cible dans la résine et abat une Signature qui profite de la préparation. Il donne à Plante un vrai gros impact sans refaire Mossaur ou Thornox.

```js
xylocorne: {
  id: 'xylocorne',
  affinity: 'grove',
  classId: 'breaker',
  passive: 'heartwood_wedge',
  maxHp: 97,
  attack: 117,
  guard: 78,
  speed: 66,
  moves: ['heartwood_breach', 'resin_vise', 'falling_rings'],
},
```

```js
heartwood_breach: {
  id: 'heartwood_breach', owner: 'xylocorne', affinity: 'grove', kind: 'damage',
  power: 29, priority: 0, cooldown: 0, ignoreBarrier: true,
  visual: 'heartwood_breach',
},
resin_vise: {
  id: 'resin_vise', owner: 'xylocorne', affinity: 'grove', kind: 'damage',
  power: 18, priority: 0, cooldown: 1,
  targetStatuses: [
    { id: 'rooted', duration: 2 },
    { id: 'marked', duration: 2 }
  ],
  visual: 'resin_vise',
},
falling_rings: {
  id: 'falling_rings', owner: 'xylocorne', affinity: 'grove', kind: 'damage',
  power: 45, priority: -2, cooldown: 2,
  scaling: 'targetStatuses', scaleAmount: 0.12,
  purge: 2, combo: true,
  visual: 'falling_rings', signature: true,
},
```

| Technique | FR | EN | Lecture mécanique |
|---|---|---|---|
| `heartwood_breach` | **Brèche de cœurbois** — « Ignore les barrières. » | **Heartwood Breach** — “Ignores barriers.” | Pression de siège régulière, moins puissante que la lance de Prismage malgré l'Attaque haute. |
| `resin_vise` | **Étau de résine** — « Enracine et Marque pendant 2 tours. » | **Resin Vise** — “Roots and Marks for 2 turns.” | Faible puissance, deux préparations existantes, cooldown obligatoire. |
| `falling_rings` | **Chute des cernes** — « Signature Combo : grandit avec les malus; retire deux bonus. » | **Falling Rings** — “Combo Signature: grows with penalties; removes two boosts.” | Gros cash-out lent; le scaling et Combo rendent tout buff de puissance très risqué à surveiller. |

Talent : `heartwood_wedge: { icon: '⋈' }`.

**Coin du cœur / Heartwood Wedge** : la première technique de dégâts de Xylocorne, chaque tour, qui vise un ennemi ayant une barrière positive détruit **6** points de cette barrière après la transaction de dégâts. Cela fonctionne même si `ignoreBarrier` a laissé la barrière intacte; cela ne touche jamais les PV, ne descend pas sous zéro et émet `barrier-break` avec `source: 'passive'`. Capturer `barrierBefore > 0` avant la transaction, puis résoudre après Countering/recul et seulement si Xylocorne a effectivement exécuté la technique. Une Esquive adverse évite les dégâts mais pas le coup de coin contre la barrière visible; cette règle doit être dite dans le talent et testée.

Lore FR :

> Xylocorne dort au centre des arbres tombés et compte les années dans leurs cernes. Quand une forêt est menacée, sa corne se glisse dans la plus petite fissure et l'élargit jusqu'à faire céder pierre, métal ou peur. Après le combat, il rebouche le bois blessé avec une résine couleur de miel.

Lore EN :

> Xylocorne sleeps inside fallen trees and counts the years in their rings. When a forest is threatened, its horn finds the smallest crack and widens it until stone, metal, or fear gives way. After battle, it seals wounded wood with honey-colored resin.

Brief prêt pour `art/briefs/xylocorne.json` :

```json
{
  "id": "xylocorne",
  "seed": 814205,
  "image_size": { "width": 128, "height": 128 },
  "no_background": true,
  "description": "Original grass-type stag-beetle creature named Xylocorne, a broad low non-humanoid siege insect built from living heartwood rather than metal. Six sturdy bark-jointed legs, layered dark walnut wing cases with visible golden growth rings, small moss patches and two fresh leaf shoots, amber resin glowing at the joints, and one enormous wedge-shaped forked horn made of pale split wood with a clean cracked silhouette. Three-quarter side battle view facing right, horn lowered for a deliberate heavy breach, powerful but not tank-round. Rich premium fantasy pixel art matching the Arene de Noam roster and Orakyn style anchor: crisp deliberate pixel clusters, dense selective cluster shading, subtle bark dithering, selective dark outline weight, readable horn and six-leg silhouette at thumbnail size. Full body centered with generous padding, transparent background. No axe, handheld tool, armor, humanoid face, text, logo, gore, photorealism, or resemblance to an existing franchise creature."
}
```

### 2.4 Pactigon — Combat / Soigneur

Fantasy : un petit animal cuirassé de dalles hexagonales qui frappe le sol pour partager un souffle régulier avec son équipe. Il soigne en restant actif, relie les gardes du trio et offre au type Combat un soutien sans devenir un deuxième Aubéastre.

```js
pactigon: {
  id: 'pactigon',
  affinity: 'force',
  classId: 'healer',
  passive: 'shared_breath',
  maxHp: 111,
  attack: 79,
  guard: 96,
  speed: 69,
  moves: ['pulse_punch', 'linked_guard', 'unbroken_circle'],
},
```

```js
pulse_punch: {
  id: 'pulse_punch', owner: 'pactigon', affinity: 'force', kind: 'damage',
  power: 20, priority: 0, cooldown: 0, teamHealRatio: 0.02,
  visual: 'pulse_punch',
},
linked_guard: {
  id: 'linked_guard', owner: 'pactigon', affinity: 'neutral', kind: 'support',
  power: 0, priority: 2, cooldown: 1,
  teamBarrier: 4, teamCleanse: 1,
  visual: 'linked_guard',
},
unbroken_circle: {
  id: 'unbroken_circle', owner: 'pactigon', affinity: 'neutral', kind: 'heal',
  power: 0, priority: 2, cooldown: 3,
  teamHealRatio: 0.07, teamBarrier: 6, teamCleanse: 'all',
  visual: 'unbroken_circle', signature: true,
},
```

| Technique | FR | EN | Lecture mécanique |
|---|---|---|---|
| `pulse_punch` | **Poing pulsé** — « Blesse; soigne chaque allié de 2 %. » | **Pulse Punch** — “Deals damage; heals every ally by 2%.” | Petit entretien offensif; Virelia soigne 3 %, mais Pactigon a moins d'Attaque et son talent redistribue une garde ciblée. |
| `linked_guard` | **Garde liée** — « Donne 4 Barrière et retire un malus à tous. » | **Linked Guard** — “Grants 4 barrier and removes one penalty from everyone.” | Protection fréquente mais plafonnée par cooldown et faible valeur unitaire. |
| `unbroken_circle` | **Cercle incassable** — « Signature : soigne 7 %, donne 6 Barrière, retire tous les malus. » | **Unbroken Circle** — “Signature: heals 7%, grants 6 barrier, removes every penalty.” | Sauvetage d'équipe complet; aucun Focused, switch protégé ou gros soin perso comme les autres Soigneurs. |

Talent : `shared_breath: { icon: '⬡' }`.

**Souffle partagé / Shared Breath** : après une technique de Pactigon qui rend effectivement des PV à au moins deux alliés conscients, l'allié conscient au plus faible ratio de PV gagne **4** de barrière, une fois par technique. Les soins à 0 parce que tout le monde est plein ne comptent pas. En cas d'égalité, utiliser l'ordre stable du trio; le bénéficiaire peut être Pactigon. Résoudre après tous les soins mais avant les `teamBarrier` de la même technique, afin que le journal raconte d'abord le talent puis la garde générale et que le cap de 35 reste déterministe.

Lore FR :

> Les Pactigons se rassemblent en cercle quand l'orage fait trembler les falaises. Chacun frappe une dalle différente, mais leurs cœurs finissent toujours par battre au même rythme et même les plus faibles restent debout. Une dalle dorée sur leur dos conserve le souvenir de tous ceux qu'ils ont protégés.

Lore EN :

> Pactigons gather in a circle when storms shake the cliffs. Each strikes a different stone, yet their hearts always find the same rhythm and even the weakest stays standing. One golden plate on their back keeps the memory of everyone they have protected.

Brief prêt pour `art/briefs/pactigon.json` :

```json
{
  "id": "pactigon",
  "seed": 814206,
  "image_size": { "width": 128, "height": 128 },
  "no_background": true,
  "description": "Original fighting-type support creature named Pactigon, a friendly non-humanoid armadillo-like quadruped with a compact body covered by interlocking hexagonal stone plates, four broad padded forepaws made for rhythmic ground strikes, a short tapered tail, warm determined eyes, and one small golden memory plate centered on the back. Muted sandstone, graphite and cream body colors with restrained amber pulse lines traveling between the plates; a few geometric dust rings under one raised paw suggest shared heartbeat energy. Three-quarter side battle stance facing right, sturdy and helpful rather than aggressive or tank-massive. Rich premium fantasy pixel art matching the Arene de Noam roster and Orakyn style anchor: crisp deliberate pixel clusters, dense selective cluster shading, subtle stone dithering, selective dark outline weight, clear hex-plate silhouette at thumbnail size. Full body centered with generous padding, transparent background. No clothing, boxing gloves, humanoid anatomy, medical symbol, text, logo, gore, photorealism, or resemblance to an existing franchise creature."
}
```

### 2.5 Contrats communs des quatre entrants

- Ajouter leurs douze ids à `moves.js`, quatre talents à `passives.js`, les quatre fiches à la fin de `creatures.js` après les deux légendaires. L'ajout en fin préserve l'ordre des 24 ids historiques et leurs tie-breaks de favoris/sauvegardes.
- Chaque créature a trois techniques uniques, exactement une Signature, un `visual` unique et aucun fingerprint mécanique identique à une technique existante ou à une autre nouvelle technique.
- Tous les `targetStatuses`, `selfStatuses` et effets de talents restent dans `STATUS_DEFINITIONS`; ajouter un test de sweep explicite sur les huit ids.
- Les ratios et puissances ci-dessus sont des valeurs de départ. Les leviers de tuning gardent l'identité : baisser d'abord puissance/ratio/barrière, ensuite une durée; ne pas supprimer le verbe distinctif.
- Ajouter noms, effets courts, talent et lore dans les deux dictionnaires effectifs de `i18n.js`. Les douze effets restent à 12 mots maximum; conserver les décimales localisées dans toute copie ajoutée ultérieurement.
- `classId` est purement descriptif. Aucun talent ne lit la classe et aucun move ne reçoit de bonus « si Duelliste/Soigneur ».

## 3. Carte d'intégration

### 3.1 Données, moteur et IA

| Surface | Changement requis |
|---|---|
| `src/data/classes.js` (nouveau) | Définir les six classes, l'ordre stable, couleurs et paths SVG originaux. Exporter `CLASS_IDS`; valider unicité des paths/couleurs et non-collision exacte avec types/statuts. |
| `src/data/creatures.js` | Remplacer les 24 `role` par les `classId` audités; appliquer Assassin/Soigneur aux deux légendaires Item C; ajouter les quatre fiches; commentaire 24/26→30. |
| `src/data/moves.js` | Conserver les six techniques Item C, ajouter les douze ci-dessus : total 90, trois par propriétaire, un `visual` chacun. |
| `src/data/passives.js` | Conserver les deux talents légendaires, ajouter les quatre hooks ci-dessus : total 30 talents assignés distincts. |
| `src/battle/engine.js` | Implémenter `burning_code`, `perfect_ebb`, `heartwood_wedge`, `shared_breath` aux points d'ordre précisés. Réutiliser `barrier-break` d'Item C. Garder les événements, previews clonées et replay déterministes. |
| `src/battle/ai.js` | Les champs standard font entrer automatiquement les moves dans le score. Ajouter une valeur board-state aux quatre talents seulement si nécessaire; surtout empêcher l'IA de survaloriser Garde liée/Cercle incassable à équipe pleine et Feinte d'écume quand Esquive est déjà présente. |
| `src/data/team-profile.js` | Les verbes standard alimentent les axes. Recalibrer les échelles avec 30 créatures; compter `teamCleanse: 'all'` plus haut qu'un cleanse 1 et la destruction de barrière de Xylocorne sous pressure/control. Ne pas ajouter un cinquième axe « classe ». |
| `src/data/combos.js` | Aucun special-case : Résine pose Marqué et Chute des cernes est un finisher Combo. Tester une route croisée Xylocorne→coéquipier et interdire l'auto-route. |
| `src/data/draft.js` | La permutation est data-driven. Vérifier offres/ennemi légaux et sans doublons sur le pool de 30; ne pas changer les trois offres de trois ni l'équipe ennemie de trois. |
| `src/save.js` | Garder v15. `classId` n'est pas persisté; la validation des équipes/records/mastery doit accepter les six nouveaux ids (légendaires inclus) via `CREATURE_IDS` et tolérer les anciennes sauvegardes sans champs pour eux. |

#### Remix intelligent et légalité

`remixTeam()` passe de C(24,3)=2 024 à C(30,3)=4 060 trios, ce qui reste petit. Remplacer `Object.keys(CREATURES)` par `CREATURE_IDS` pour un ordre autoritaire. Ajouter `new Set(team.map(id => CREATURES[id].classId)).size` comme **petit tie-break** de diversité (maximum +6, soit +2 par classe distincte), derrière diversité de types, routes Combo et matchup; il ne doit pas imposer une classe ou battre une vraie lecture de type. Conserver `REMIX_DITHER_MAX <= 5`.

Les tests doivent vérifier sur plusieurs adversaires et graines que chaque résultat contient exactement trois ids finaux distincts, que le lead appartient au trio, qu'aucun `undefined` n'arrive dans `affinityMultiplier`, que la même graine est déterministe, que les nouvelles créatures sont éligibles et qu'au moins trois résultats distincts apparaissent. Ne pas exiger que chaque graine expose chaque nouveau venu : le remix reste un conseiller tactique, pas un tirage uniforme.

### 3.2 Filtres de classes et présentation

#### Team Select

- Remplacer `selection.filter` par deux états transitoires `filterAffinity: 'all'` et `filterClass: 'all'`; ils ne sont pas sauvegardés.
- Rendre deux rangées compactes et nommées : **Types** (six icônes saturées) puis **Classes** (six icônes sourdes). Un bouton « Tous » dans chaque rangée affiche le total dynamique, jamais le littéral 24/26/30.
- Les deux filtres se combinent avec AND. Exemple : Feu + Duelliste montre seulement Flambélier; Tous types + Rempart en montre cinq. La sélection actuelle reste conservée même si une carte sélectionnée est masquée.
- Sur chaque carte, remplacer « Type · ancien rôle » par une puce type et une puce classe, chacune avec icône et mot. Ajouter le motif classe dans le showcase du lead, les rangées choisies et les options adverses compactes quand l'espace le permet; les lecteurs d'écran annoncent « Feu, Duelliste ».
- Mobile : chaque rangée scroll horizontalement indépendamment, boutons ≥44 px, état `aria-pressed`, focus visible; ne pas créer une matrice 6×6.

#### Bestiaire

- Dans `installBestiaryFilters()`, ajouter `data-class` à chaque carte et une rangée `[data-bestiary-class]` sous les types. Conserver recherche + type + classe en AND.
- Le compteur est toujours `${visible.length} / ${CREATURE_IDS.length}`. Le bouton Tout et l'eyebrow utilisent le même total dynamique.
- Les cartes et leur résumé montrent le badge de classe; l'expansion détaillée ajoute la définition enfant-facing via `class.effect.<id>`.
- Les 30 cartes, les 90 triggers de Théâtre et les deux familles de filtres restent navigables au clavier. En filtrant Briseur, cinq cartes restent visibles; Duelliste en montre trois; chaque type en montre cinq.

#### Autres surfaces qui affichent l'ancien rôle

- `src/screens/draft.js`: puce de classe sur les offres; `draft.archetype.*` reste une lecture de kit séparée et ne doit pas être renommée automatiquement.
- `src/screens/results.js`: remplacer `role.*` par l'icône + `class.*` dans le rapport de créature.
- `src/battle-ui/hud.js` et `controller.js`: ajouter la classe uniquement dans les détails/selector où le nom du type apparaît déjà; ne pas encombrer les plaques compactes en permanence.
- `src/screens/academy.js`: ajouter sous les deux triangles une bande « 6 classes, 6 façons de jouer » avec les six icônes et définitions. Ne pas en faire un neuvième statut ni modifier les huit cartes essentielles.
- `src/app/context.js`: importer/exporter `CLASSES`, `CLASS_ORDER`, `CLASS_IDS`, `classIcon`, `className`; centraliser l'échappement et l'accessibilité comme pour les types.
- CSS : ajouter les règles de puces/filters dans les fichiers de sélection et bestiaire qui existent après le merge du travail concurrent. Les classes ne doivent pas recolorer les FX, statuts ou arènes.

### 3.3 Restructuration i18n

Supprimer les anciennes clés effectives `role.controller`, `role.duelist`, `role.trickster`, `role.tank`, `role.artillery`, `role.support`, `role.maestro`, `role.mystic`, `role.breaker`, `role.vanguard`, `role.assassin`, `role.sentinel`, `role.healer`, `role.disruptor`, `role.berserker` dans les sections de base **et** les `Object.assign` tardifs. Ajouter une seule famille autoritaire par locale :

| Clé | FR | EN |
|---|---|---|
| `class.tank` | Rempart | Tank |
| `class.assassin` | Assassin | Assassin |
| `class.healer` | Soigneur | Healer |
| `class.controller` | Contrôleur | Controller |
| `class.breaker` | Briseur | Breaker |
| `class.duelist` | Duelliste | Duelist |
| `class.effect.tank` | Encaisse et se protège. | Takes hits and protects itself. |
| `class.effect.assassin` | Joue vite, frappe, puis disparaît. | Acts fast, strikes, then vanishes. |
| `class.effect.healer` | Soigne, nettoie ou protège les alliés. | Heals, cleanses, or protects allies. |
| `class.effect.controller` | Pose des malus pour gêner l'ennemi. | Applies penalties to disrupt the enemy. |
| `class.effect.breaker` | Prépare de gros coups contre les défenses. | Builds heavy hits against defenses. |
| `class.effect.duelist` | Équilibré entre attaque, défense et vitesse. | Balances offense, defense, and speed. |

Ajouter aussi `filter.types`, `filter.classes`, `filter.allTypes`, `filter.allClasses`, les 4× créature, 12× move, 12× effect, 4× passive, 4× passive.effect et 4× lore par langue. `validateDictionaries()` doit garantir l'égalité exacte FR/EN, l'absence de placeholder et l'absence de toute clé `role.*` restante.

### 3.4 Rivaux, modes et découverte

Ne pas changer les équipes de Ligue, les huit squads débutants, les Trials ou les Gauntlet stages : introduire six nouveaux kits simultanément dans le parcours initial rendrait la comparaison de balance et l'apprentissage trop bruyants.

Réutiliser les champs `circuitTeam` / `circuitLead` introduits par Item C, uniquement en post-game :

| Rival Circuit | Trio recommandé | Pourquoi |
|---|---|---|
| Undertide | `['mareclat', 'nymbloom', 'voltide']`, lead 0 | Montre le nouveau Duelliste Eau avec un soutien et un Contrôleur connus. |
| Wildheart | `['xylocorne', 'virelia', 'thornox']`, lead 0 | Résine/Marqué puis Combo, sans retirer le duo pédagogique Virelia/Thornox. |
| Ironwall | `['pactigon', 'monolith', 'kordane']`, lead 0 | Fait découvrir le Soigneur Combat dans une équipe robuste mais pas triple-Rempart. |
| Inferno | `['flambelier', 'magmoth', 'solflare']`, lead 0 | Présente le Duelliste entre le Rempart et le Briseur Feu. |
| Crown | Conserver exactement l'override Item C `['deuilastre', 'aubeastre', 'prismage']` et son lead prévu | Les deux légendaires restent une révélation de Champion Circuit. |

Les sept autres rivaux Circuit héritent de leur équipe normale. Ajouter la validation des overrides optionnels et un E2E léger qui rencontre au moins un des quatre trios par injection contrôlée du nombre de victoires Circuit; ne pas allonger un parcours complet.

### 3.5 Tous les comptes 24/26/72/78 à faire converger vers 30/90

Les sources sont aujourd'hui à 24/72; Item C peut les avoir portées à 26/78 avant Item D. L'exécuteur doit accepter les deux états de départ et produire un seul état final. Préférer `CREATURE_IDS.length`, `Object.keys(MOVES).length` et interpolation; réserver les assertions exactes 30/90 aux tests de contrat.

| Fichier / contexte | État final |
|---|---|
| `src/data/creatures.js` | Commentaire 30 fantasmes; 30 ids. |
| `src/screens/title.js` | Eyebrow via `title.rosterLine` interpolé `{creatures: 30, moves: 90}`, sans chaîne française codée en dur. |
| `src/screens/academy.js` | Eyebrow dynamique `30 · 90 · 3v3`; bouton localisé « Explorer les 90 techniques ». |
| `src/screens/team-select.js` | Bouton Tous = `CREATURE_IDS.length`; six filtres types à 5 chacun; filtres classes 5/6/5/6/5/3. |
| `src/screens/bestiary.js` | Eyebrow dynamique `30 / 30`; 30 cartes, 90 techniques. |
| `src/app/shell.js` | Les trois littéraux 24 du filtre/compteur deviennent le total dynamique; ajouter le filtre classe. |
| `src/i18n.js` | Mettre à jour toutes les occurrences effectives de `academy.openBestiary`, `title.rosterLine`, `app.tagline`, `bestiary.subtitle` et toute copie 24/26/72/78 en 30/90, en base comme en override tardif. FR : « trente », EN : “thirty” quand la phrase l'exige. |
| `README.md` | Overview, Bestiary/Move Theater et description de `moves.js` : 30 créatures, 90 techniques; mentionner six classes. |
| `AUTONOMOUS_GAME_BUILD_BRIEF.md` | Si ce brief reste une documentation produit vivante, corriger uniquement ses comptes globaux 24/72 et son tableau roster; ne pas réécrire les valeurs historiques de balance. |
| `styles/screens/progression.css` | Commentaire d'ouverture 24/26→30 seulement; aucun nombre CSS visuel n'est un compte roster. |
| `test/data-ai.test.js` | Titre 30; contrats 30/90/30; 90 visuals/fingerprints; distribution classes exacte; distribution types exacte; **9** Signatures non-damage attendues après Item C + Pactigon (les 7 actuelles, Aubéastre et Pactigon); overrides Circuit légaux; sustain snapshots incluent les nouveaux champs. |
| `test/i18n-save.test.js` | Titre “ninety”; sweep 90 noms/effets; 30 créatures/talents/lore; six classes bilingues; zéro `role.*`; sauvegarde v15 historique et nouveaux ids. |
| `test/presentation-contract.test.js` | Titre “ninety”; boucle dynamique exigeant les 90 `.move-<id>`; unicité des six icônes/couleurs de classes et collisions types/statuts. |
| `e2e/progression-responsive.spec.js` | Titre roster 30; cartes 30; chaque type 5; Academy 90; triggers 90; compteur `5 / 30` pour Combat; filtres Briseur 5 et Duelliste 3; Trial selection 30. |
| `e2e/gameplay.spec.js` | `.scout-read` 30; ajouter seulement les interactions ciblées des nouveaux talents qui exigent le navigateur. |
| `tools/simulate-balance.mjs` | Déjà data-driven pour roster/moves; conserver sortie `${CREATURE_IDS.length}` et ajouter les cohortes des six entrants, pas de littéral 30 dans la boucle. |

Ne pas remplacer en masse les autres 24/26/72/78. Restent intentionnels : +24 Éclat de Relay Rush, soin de camp 24 %, seuils de tours, puissances/ratios de moves, graines 24/72, tempos audio, fréquences, géométrie SVG `24 24`, particules, pixels, pourcentages/alpha CSS et PV de départ 72 %. Les anciens plans datés sous `docs/superpowers/plans/` sont des archives de décision et gardent leurs comptes au moment de rédaction; le présent plan et Item C expliquent la transition.

## 4. Stratégie de simulation et risques des six entrants

Les deux légendaires et les quatre créatures de cet item doivent être évalués comme une seule cohorte de six, car ajouter 25 % du roster en une fois change la fréquence des types, des soins, des purges et des matchups même si chaque fiche semble raisonnable isolément.

### 4.1 Instrumentation à ajouter

- Rapporter pour chacun des six nouveaux : apparitions, win rate, tours moyens, K.O., dégâts, soins, barrière créée/détruite, fréquence de chaque move, fréquence et premier tour de Signature.
- Ajouter des agrégats par classe et par type, sans en faire des gates d'égalité parfaite. Une classe est une explication, pas une faction censée gagner à 50 %.
- Conserver la matrice pairwise globale et imprimer une matrice ciblée 6×30 avec nombre de rencontres. Signaler les cellules avec moins de 50 observations avant toute conclusion.
- Instrumenter les verbes définissants : proc de Mauvais/Bienveillant Augure, valeur de purge Deuilastre, relays utiles Aubéastre, Burning Code, Perfect Ebb, barrière détruite par Heartwood Wedge, soins/procs Shared Breath.
- Ajouter un rapport de composition : nombre de trios à 0/1/2/3 Soigneurs ou Remparts et leurs cap rates. Les boucles Pactigon + Aubéastre + Virelia sont le risque principal de durée.
- Le naive player doit comprendre seulement la légalité; sa politique peut rester « plus gros forecast de dégâts », mais les bandes par difficulté restent un gate. Ajouter un second diagnostic support-aware non bloquant si Pactigon/Aubéastre ne sont jamais choisis par la politique naïve.

### 4.2 Gates ordonnés

1. **Gate déterministe de données** : 30/90/30, six types ×5, classes `[3,5,5,5,6,6]`, huit statuts, aucune technique clone, previews sans mutation, tous les nouveaux talents rejouables avec la même histoire.
2. **Gate de smoke balance** : graine fixe, environ 600 combats Champion-vs-Champion. Chercher bugs de légalité, one-shots normaux, boucle infinie, move jamais choisi. Ne pas tuner un win rate individuel sur cet échantillon.
3. **Gate ciblé nouveaux entrants** : round-robin forcé des six entrants contre les 24 historiques et entre eux, avec permutations de partenaires neutres et de leads. Au moins 100 observations par paire ciblée avant de modifier une puissance.
4. **Gate global** : `ARENA_BALANCE_SAMPLES=5000` minimum, graine enregistrée. Acceptation : moyenne **[12,17] tours**, décisions au cap **<5 %**, chaque créature dans **[30 %,70 %]**, aucun one-shot normal neutre, one-shots normaux super-efficaces **<8 %**.
5. **Gate de cadence Signature ±30 %** : conserver la référence Stage 3, soit **0,7–2,6 Signatures par côté-bataille**, médiane de première Signature sur l'action **3–5**, et vérifier que chacun des six nouveaux utilise sa Signature dans une fréquence non nulle. Une faible fréquence de purge/relay doit être diagnostiquée par valeur de board, pas compensée en donnant des dégâts gratuits.
6. **Gate naïf** : avec au moins 1 000 samples par tier, garder les bandes actuelles Apprentice **65–100 %**, Standard **40–60 %**, Champion **20–45 %** pour le joueur naïf. Rapporter séparément les trios contenant un nouveau Soigneur.
7. **Gate final de variance** : relancer le global sur au moins une deuxième graine si un entrant est à moins de 3 points d'une borne ou si une paire dépasse 70/30. Ne pas accepter un 69,9 % provenant de moins de rencontres que les autres.

### 4.3 Risques et ordre des leviers

| Entrant | Risque principal | Ordre de mitigation sans perdre l'identité |
|---|---|---|
| Deuilastre | Polarité Ténèbres→Psy, purge d'équipe et Attaque 124. | Respecter d'abord Plume 22; Signature 48→46→44; Attaque 124→121; durée de Glas 2→1. Garder la purge. |
| Aubéastre | Stall et entrées protégées d'Assassins. | Halo barrière 5→4, soins 2,5→2 %, Rosée 6→5,5 %, puis relay cleanse all→2. Garder la relève différée. |
| Flambélier | Riposte + Burning trop rentable, ou comeback Signature trop haut. | Burning 2→1 tour; `scaleAmount` .55→.45; puissance Signature 45→42; enfin Garde 88→85. |
| Maréclat | Chaîne Esquive/Hâte frustrante et drain multi-hit. | Cooldown Fleuret 1→2; Hâte du talent 2→1; drain Signature .25→.20; puissance par hit 19→18. Garder l'escrime d'esquive. |
| Xylocorne | Scaling malus × Combo × avantage Plante provoque des K.O. trop polaires. | Signature 45→42; scaling .12→.08; talent détruit 6→4 barrière; Attaque 117→113. Garder Brèche qui ignore. |
| Pactigon | Triple sustain prolonge les combats et profite trop aux bancs. | Cercle soin 7→6 %, barrière 6→5; Garde liée cooldown 1→2; Poing soin 2→1,5 %; talent barrière 4→3. Garder le soin offensif. |

Ne jamais tuner les six en bloc au nom de leur nouveauté. Si le rythme global est trop long mais que seuls les trios à deux Soigneurs posent problème, corriger Pactigon/Aubéastre ou le scoring de switch, pas les dégâts de Xylocorne/Flambélier.

## 5. Tests ciblés à prévoir

### Données et classes

1. Exactement 30 créatures, 90 moves, 30 talents assignés distincts; trois moves propriétaires, une Signature et un `visual` unique par créature.
2. Six `classId` seulement, aucune propriété `role`, aucun `role.*` localisé, chaque classe ≥2, distribution exacte finale et tables de type 5 chacune.
3. Six paths SVG de classe uniques, non vides et originaux; six couleurs uniques qui ne dupliquent aucun type/statut; renderer accessible/décoratif selon contexte.
4. Les douze moves utilisent seulement les huit statuts, passent le fingerprint unique et respectent les budgets de drain, barrière, soin et Esquive existants après extension explicite des fixtures.
5. Les 30 noms, talents, effets et lores existent en FR/EN; 90 effets ≤12 mots; définitions de classes présentes et dictionnaires strictement symétriques.

### Moteur et IA

6. Burning Code ne proc que sur une vraie Riposte, une fois par tour, après réflexion; Brûlure sur survivant et replay déterministe.
7. Perfect Ebb proc quand Esquive cause un miss, pas quand purge/cleanse retire le statut, une fois par tour.
8. Heartwood Wedge mémorise la barrière pré-hit, détruit exactement min(6, barrière restante), fonctionne avec `ignoreBarrier`, émet `barrier-break`, ne touche pas les PV et ne proc pas deux fois le même tour.
9. Shared Breath compte les soins effectifs et les alliés conscients, choisit le plus faible ratio avec tie stable, respecte le cap, ne proc pas à équipe pleine et s'ordonne avant `teamBarrier`.
10. Preview/AI ne mutent jamais l'état source avec ces talents; mêmes actions + graine produisent même état/histoire.
11. IA Champion préfère Cercle/Garde quand plusieurs alliés sont blessés/malussés, les évite à board vide, n'empile pas Esquive, et sait valoriser Chute des cernes avec des malus sans la lancer automatiquement à 100 Éclat.
12. Combo : Résine crée des routes vers un finisher différent; Chute peut consommer un setup d'un allié; aucune auto-assist ou route vers une pure technique de support.

### UI et E2E

13. Team Select : 30 cartes, deux rangées de 7 boutons (Tous + six), chaque type 5, Briseur 5, Duelliste 3, combinaison Feu+Duelliste 1; sélection masquée conservée; aria/focus corrects.
14. Bestiaire : 30 cartes, 90 triggers, recherche/type/classe combinés, compteurs dynamiques, badges de classes avec icônes, clavier et mobile.
15. Academy : 30/90, six cartes de classes, deux triangles et huit statuts inchangés; aucun chevauchement à 390×844, zoom 200 %, EN long labels.
16. Move Theater/presentation : douze nouveaux sélecteurs `.move-*`, effets lisibles avec reduced motion/high contrast; les six selectors Item C restent présents pour total 90.
17. Circuit : les quatre overrides et Crown sont légaux, uniquement en Circuit; Ligue, Trials, Gauntlet et huit squads restent byte-for-byte équivalents dans leur contenu d'équipe.
18. Sauvegarde v15 : une ancienne sauvegarde 24-créatures se charge sans migration, conserve records/mastery, puis peut enregistrer les six nouveaux ids; ids inconnus toujours rejetés.

## 6. Checklist d'exécution

### Une session `gpt-5.6-sol` en effort high — code, données, UI et tests

1. **Préflight de dépendances.** Relire l'état final d'Item C et du travail status-visuals. Faire une matrice « déjà livré / encore à livrer » pour Deuilastre, Aubéastre, `barrier-break`, `allySwitch`, les compteurs 26/78 et les CSS de statuts. Ne pas écraser leurs changements.
2. **Installer le contrat classes.** Ajouter `classes.js`, paths SVG, exports context/i18n, puis migrer les 26 fiches présentes de `role` vers `classId`. Mettre les tests de taxonomy au vert avant d'ajouter les quatre créatures.
3. **Ajouter les données des quatre créatures.** Fiches, douze moves, quatre talents, traductions FR/EN et lore. Vérifier immédiatement 30/90/30, types ×5, classes finales et fingerprints.
4. **Implémenter les quatre hooks moteur.** Respecter les ordres d'événements documentés, réutiliser les primitives status/barrier et ajouter les tests déterministes avant toute UI.
5. **Intégrer IA, profile, Combo, remix et Circuit.** Board-state scoring, class diversity tie-break léger, overrides post-game et validations. Lancer le smoke sim 600 à ce point; corriger seulement bugs/one-shots flagrants.
6. **Migrer toutes les surfaces `role.*`.** Team Select, Draft, Bestiaire, Results, détails HUD/switch; supprimer les quinze clés legacy et vérifier zéro recherche `role.` hors anciens plans.
7. **Ajouter les filtres et l'Academy.** Deux axes de filtres AND, compteurs data-driven, badges accessibles, six définitions. Tester mobile/keyboard avant les raffinements CSS.
8. **Faire converger 24/26/72/78 vers 30/90.** Utiliser la table d'audit; mettre à jour README/brief vivant/commentaire, tests et E2E. Effectuer une recherche finale ciblée et classer chaque nombre restant comme mécanique, seed, géométrie, style ou archive.
9. **Ajouter la chorégraphie code-native des douze moves.** `fx.js`/CSS/théâtre/playback/sound générique, avec sélecteur unique, forme lisible sans couleur, reduced-motion et high-contrast. Ne pas modifier les assets raster dans cette session.
10. **Passer les gates.** Unit/data/presentation d'abord, sim ciblée, global 5 000, naive 1 000/tier, puis E2E. Tuner un entrant à la fois selon l'ordre des leviers; enregistrer graines, samples, rates, moyenne, p90, cap share et cadence Signature.
11. **QA finale.** Vérifier FR/EN, 390×844, desktop, zoom 200 %, clavier/gamepad, lecteurs d'écran des filtres, aucun sprite manquant (les placeholders art peuvent attendre l'orchestrateur uniquement si la branche n'est pas déclarée terminée).

### Étapes d'orchestrateur pour l'art PixelLab

1. Créer exactement les quatre JSON de brief de ce plan sous `art/briefs/`; ne jamais mettre le token ou `.dev.vars` dans le journal.
2. Lancer séparément :

   ```sh
   node tools/generate-pixellab.mjs art/briefs/flambelier.json
   node tools/generate-pixellab.mjs art/briefs/mareclat.json
   node tools/generate-pixellab.mjs art/briefs/xylocorne.json
   node tools/generate-pixellab.mjs art/briefs/pactigon.json
   ```

3. Inspecter chaque candidat à 128×128 natif puis en nearest-neighbor agrandi. Choisir une silhouette distincte des 26 existantes; rejeter matte, coins non transparents, membres illisibles, arme/armure littérale ou look de franchise.
4. Promouvoir les candidats choisis vers `assets/monsters/<id>/battle.png`; ajouter modèle/job/seed/source/final dans `assets/asset-manifest.json` sans changer Orakyn comme `styleAnchor`.
5. Vérifier les quatre en carte Team Select, filtre de classe, Bestiaire, Draft, selector de switch, Theater et des deux côtés du combat sur arènes claire/sombre; contrôler miroir, clipping, contraste élevé et reduced motion.
6. Relancer le contrat présentation et les smoke E2E après promotion. L'art n'influence aucune valeur de balance; une régénération ne doit pas relancer la phase de tuning mécanique complète.

## 7. Critères d'acceptation

- 30 créatures complètes, 90 techniques, 30 talents, six types à cinq membres et six classes sans singleton.
- Un enfant peut répondre au premier regard « tank, assassin, soigneur, contrôleur, briseur ou duelliste » grâce au mot + pictogramme; la couleur n'est qu'un accent secondaire.
- Les 24 anciens sont reclassés conformément à leurs stats/kits; Deuilastre est Assassin et Aubéastre Soigneur; aucun ancien label de rôle n'apparaît dans l'UI ou i18n effective.
- Les quatre nouveaux kits sont distincts, utilisent seulement les huit statuts et la grammaire de moves existante, avec effets/talents/lore complets en FR/EN et art PixelLab traçable.
- Les filtres type/classe fonctionnent en AND sur Team Select et Bestiaire, avec comptes dynamiques, clavier, mobile et accessibilité.
- Seuls les overrides de Champion Circuit adoptent les six nouveaux; le parcours initial et les contenus authored débutants restent stables.
- Save v15, deux triangles, flat Éclat, Combo unifié, Coach et règles 2/0,5/1 restent inchangés.
- Sims : moyenne 12–17, cap <5 %, chaque créature 30–70 %, naive bands conservées, cadence Signature dans la référence ±30 %, résultats des six entrants suffisamment échantillonnés.

## Résumé final — exactement 8 lignes

Rempart · bouclier `⬢` · `#687686` · 5/30
Assassin · lame rapide `⌁` · `#7D6C82` · 6/30
Soigneur · cœur-plus `✚` · `#647F73` · 5/30
Contrôleur · anneaux liés `◎` · `#6B748D` · 6/30
Briseur · plaque fendue `◫` · `#8A6F65` · 5/30
Duelliste · lames croisées `⚔` · `#817A63` · 3/30
Flambélier · Feu · Duelliste | Maréclat · Eau · Duelliste
Xylocorne · Plante · Briseur | Pactigon · Combat · Soigneur
