# Glossary: player-facing words

French is the reference; English mirrors it. These are the only words the UI uses for these ideas. Code ids and save keys keep their old names (`surge`, `evasive`, `gauntlet`, `draft`, `tank`…); only the displayed words changed. Icons are `icon(name)` from `src/app/icons.js` unless noted.

| FR | EN | Pour un enfant de 11 ans | Icon |
| --- | --- | --- | --- |
| **PV**, **K.O.** | **HP**, **K.O.** | La vie de ta créature. À 0 PV, elle est K.O. et ne peut plus combattre. | `heart` |
| **Type** (Super efficace ×2 · Peu efficace ×0,5) | **Type** (Super effective ×2 · Not very effective ×0.5) | Suis la flèche : ×2. À l'envers : ×0,5. Entre les triangles : ×1. (The one wording, in École, L'essentiel and Aide: `academy.core.3.desc`.) | type disc (`affinityIcon`) |
| **Technique** | **Move** | Une action de ta créature. Chacune en connaît trois. | `sword` |
| **Signature ✦** | **Signature ✦** | Chaque action remplit ta jauge ✦. Pleine ? Lance ta super-technique ! | `sparkle`; in copy, ✦ is drawn by the one-glyph font `fonts/sparkle.woff` (same path) |
| **Changer** | **Switch** | Fais entrer une autre créature. Celle qui entre reçoit le coup du rival. | `swap` |
| **Barrière** | **Barrier** | Un bouclier qui prend les dégâts avant tes PV. | `shield` |
| **Talent** | **Talent** | Un pouvoir que ta créature a toujours, sans utiliser son tour. | talent glyph (`src/data/passives.js`) |
| **Bonus** / **Malus** | **Boost** / **Penalty** | Les bons effets (▲) t'aident, les mauvais (▼) te gênent. Ils durent quelques tours. | status icons (`src/battle/statuses.js`); badge corner mark `arrow-up` / `arrow-down` (`src/app/status-badge.js`) |
| **Marqué** · **Combo** | **Marked** · **Combo** | Une créature Marquée prend plus de dégâts au prochain coup : c'est un Combo. | `target-lock` status icon |
| **Sonné** · **Esquive** · **Ricochet** | **Dazed** · **Dodge** · **Ricochet** | Sonné : plus lent et frappe moins fort. Esquive : la prochaine attaque te rate. Ricochet : une part du prochain coup reçu repart sur l'attaquant. | `dizzy-stars` · `ghost` · `shield-arrow` status icons |
| **Coups** (multi-coups) | **Hits** (multi-hit) | Une technique qui frappe plusieurs fois montre le total et, dessous, « 3 coups ». Jamais « ×3 » : le × est réservé aux multiplicateurs (COMBO ×1,3, Super efficace ×2). | readout words under the number (`battle.hitCount`) |
| **Météo de l'arène** | **Arena weather** | Chaque arène rend un type plus fort et un autre plus faible, pour les deux équipes. | `map` |
| **Classe** : Défenseur, Rapide, Soutien, Stratège, Attaquant, Polyvalent | **Class**: Defender, Speedster, Support, Tactician, Attacker, All-Rounder | La façon de jouer d'une créature. Elle ne change jamais les dégâts. | class icon (`classIcon`, `src/data/classes.js`) |
| **Badges** | **Badges** | Gagne un combat de Ligue pour gagner son badge. Les badges ouvrent de nouveaux modes. | `badge` |
| **Pouvoir d'As** | **Ace Power** | Le coup spécial d'un rival quand il ne lui reste qu'une créature. | `crown` |
| **Expédition** · **Pioche du jour** | **Expedition** · **Daily Pick** | Expédition : trois combats d'affilée avec des faveurs. Pioche du jour : une équipe surprise, chaque jour. | `mountain` · `calendar` |
| **Nouveau** | **New** | Un mode qui vient de s'ouvrir et auquel tu n'as pas encore joué (tuile Défis et sa ligne). | gold tab (`.new-pill`) |
| **Chromatique** | **Chromatic** | Une couleur spéciale pour une créature que tu maîtrises (maîtrise 5). Tu choisis de la montrer ou non. Seules tes créatures la montrent, jamais celles du rival. | creature sprite (`battle-shiny.png`) |
| **Bestiaire** | **Bestiary** | Les 30 créatures, leurs fiches et **Mes stats** (tes exploits). | `book` |
| **Ton équipe** | **Your team** | Les trois créatures que tu emmènes au combat. Le jeu te tutoie : jamais « Mon équipe ». | `team` |
| **Journal du combat** | **Battle Log** | La liste écrite des dernières actions du combat. Ce n'est pas un replay. | `scroll` |

Stats read **PV · Attaque · Défense · Vitesse** (EN **HP · Attack · Defense · Speed**): full words everywhere, sheets and prose alike, because an 11-year-old reads them faster than abbreviations. Narration reads "**X utilise Y !**" and "**X est K.O. !**" (EN "X uses Y!", "X is K.O.!"); journal lines start with a word, never a symbol. Trial and Circuit rule names are proper names in title case (**Sur le Fil**).

## Writing rules

- Decision surfaces (move buttons, the info sheet in simple mode, switch rows) use ten words or fewer and no numbers. Exact numbers live in `move.effectDetail.*` and other `*Detail` keys, shown only with **Détails tactiques** (`save.expertMode`).
- French typography is automatic: `frenchTypography()` in `src/i18n.js` puts a narrow no-break space (U+202F) before `! ? : ; »` and after `«`, and a no-break space before `%` when it loads the French dictionary. Type ordinary spaces in `src/i18n/fr.js`.
- Use generic genre words (Feu, Eau, PV, K.O., Super efficace). Never copy a franchise's full catchphrases, and never reuse a monster franchise's move, talent, item or creature name, in either language: that is why Farfombre's move reads **Tison furtif** / **Sly Cinder**, Orakyn's talent **Regard d'oracle** / **Oracle's Gaze**, Lumivox's **Bis !** / **Once More!**, Mossaur's Signature **Secousse sylvestre** / **Forest Tremor**, the status **Ricochet** (was Riposte / Counter), the Ace Power **Nouveau souffle** / **Second Wind**, the rival **Muraille de Fer** / **Iron Wall**, Farfombre's **Mue obscure** / **Shadow Molt** and the talent **Dernier bastion** / **Final Bastion**. Type names (Psy / Psychic…), Barrière / Barrier, Esquive / Dodge and UI words (Retour, Soin, Météo) are genre vocabulary, not names.
- Retired words must not return: Éclat, Surge, Déchaîner, Insaisissable, GRD, emblème, Draft, Traversée, the old class names (Rempart, Assassin, Soigneur, Contrôleur, Briseur, Duelliste) and the franchise names above (Séisme, Riposte, Counter, Second souffle, Mur de Fer, Shadow Shed, Last Bastion). `test/i18n-save.test.js` fails if a dictionary value uses one.
