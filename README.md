# CraftBot PVP — Installation

## Prérequis
- Node.js 18+ (https://nodejs.org)

## Installation
```bash
npm install
```

## Lancement
```bash
node bot.js
```

## Commandes (chat in-game ou terminal)
| Commande | Description |
|----------|-------------|
| `pvp 1`  | Mode Facile — attaque directe épée |
| `pvp 2`  | Mode Moyen — strafe + bouclier + critiques |
| `pvp 3`  | Mode Maître — combo + potions + critiques |
| `pvp 4`  | Mode Pro — Elytra + roquettes + one-shot |
| `stop`   | Arrête le bot |
| `status` | Affiche HP / kills / mode |

## Mode PVP 4 — Elytra
Le bot monte à +20 blocs au-dessus de la cible, active l'elytra,
fonce en dive attack et frappe avec la hache (brise bouclier).

## Totem Logic
Si le joueur survit grâce à un Totem of Undying :
1. Bot détecte la régénération du totem
2. Recule 3 secondes
3. Re-attaque pour le kill final
