const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const readline = require('readline')

// ══════════════════════════════════════
//  CONFIG — modifie ici
// ══════════════════════════════════════
const CONFIG = {
  host: 'play.mycraft.net',   // adresse du serveur
  port: 25565,
  username: 'CraftBot_01',    // username du bot
  version: '1.20.1',
}

// ══════════════════════════════════════
//  CRÉATION DU BOT
// ══════════════════════════════════════
const bot = mineflayer.createBot(CONFIG)
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)

let pvpMode = 0         // 0=off, 1=facile, 2=moyen, 3=maitre, 4=elytra
let currentTarget = null
let totemDetected = false
let waitingAfterTotem = false
let kills = 0
let totems = 0

// ══════════════════════════════════════
//  EVENTS DE BASE
// ══════════════════════════════════════
bot.once('spawn', () => {
  log('ok', 'Bot connecté à ' + CONFIG.host)
  log('ok', 'Tape "pvp 1" à "pvp 4" pour activer un mode')
  setupPathfinder()
  startTickLoop()
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const msg = message.toLowerCase().trim()

  if (msg === 'pvp 1') { setPvpMode(1, username); return }
  if (msg === 'pvp 2') { setPvpMode(2, username); return }
  if (msg === 'pvp 3') { setPvpMode(3, username); return }
  if (msg === 'pvp 4') { setPvpMode(4, username); return }
  if (msg === 'stop')  { stopBot(); return }
  if (msg === 'status') { sendStatus(); return }
})

bot.on('entityHurt', (entity) => {
  if (entity === bot.entity) {
    if (bot.health < 6) healSelf()
  }
})

// Détection du totem : le joueur survit avec exactement 1 HP
bot.on('entityEffect', (entity, effect) => {
  if (currentTarget && entity.username === currentTarget.username) {
    // ID 5 = Regeneration (activé par le totem)
    if (effect.id === 5 || effect.id === 10) {
      if (!waitingAfterTotem) {
        totemDetected = true
        totems++
        log('warn', `TOTEM détecté sur ${entity.username} ! Recul 3s puis re-kill...`)
        waitingAfterTotem = true
        bot.pvp.stop()
        bot.setControlState('back', true)
        setTimeout(() => {
          bot.setControlState('back', false)
          waitingAfterTotem = false
          if (currentTarget && pvpMode > 0) {
            log('ok', `Re-attaque de ${currentTarget.username} après totem`)
            attackTarget(currentTarget)
          }
        }, 3000)
      }
    }
  }
})

bot.on('entityDead', (entity) => {
  if (currentTarget && entity.username === currentTarget.username) {
    kills++
    log('ok', `KILL #${kills} — ${entity.username} éliminé !`)
    currentTarget = null
    bot.pvp.stop()
    if (pvpMode === 4) landSafely()
  }
})

bot.on('error', err => log('err', err.message))
bot.on('kicked', reason => log('err', 'Kicked: ' + reason))
bot.on('end', () => log('warn', 'Déconnecté du serveur'))

// ══════════════════════════════════════
//  MODES PVP
// ══════════════════════════════════════
function setPvpMode(mode, requester) {
  pvpMode = mode
  const names = { 1: 'Facile', 2: 'Moyen', 3: 'Maître', 4: 'Pro Elytra' }
  log('ok', `Mode PVP ${mode} (${names[mode]}) activé par ${requester}`)
  bot.chat(`Mode PVP ${mode} (${names[mode]}) activé !`)

  equip(mode)

  const target = findNearestPlayer()
  if (target) {
    currentTarget = target
    log('ok', `Cible trouvée: ${target.username}`)
    attackTarget(target)
  } else {
    log('warn', 'Aucun joueur proche. Le bot attaquera dès qu\'un joueur approche.')
  }
}

function equip(mode) {
  // Mode 1 : épée diamant simple
  // Mode 2 : épée + bouclier
  // Mode 3 : épée nethérite + arc + potions
  // Mode 4 : hache nethérite + elytra + roquettes
  const weapons = {
    1: ['diamond_sword'],
    2: ['diamond_sword', 'shield'],
    3: ['netherite_sword', 'bow', 'splash_potion'],
    4: ['netherite_axe', 'elytra', 'firework_rocket'],
  }
  const wanted = weapons[mode] || weapons[1]
  for (const itemName of wanted) {
    const item = bot.inventory.items().find(i => i.name.includes(itemName))
    if (item) {
      bot.equip(item, itemName === 'shield' ? 'off-hand' : 'hand').catch(() => {})
    }
  }
}

// ══════════════════════════════════════
//  LOGIQUE D'ATTAQUE PAR MODE
// ══════════════════════════════════════
function attackTarget(target) {
  if (!target || pvpMode === 0) return
  currentTarget = target

  if (pvpMode === 1) attackSimple(target)
  else if (pvpMode === 2) attackMoyen(target)
  else if (pvpMode === 3) attackMaitre(target)
  else if (pvpMode === 4) attackElytra(target)
}

// PVP 1 — Attaque directe simple
function attackSimple(target) {
  log('in', `PVP 1 — Attaque simple sur ${target.username}`)
  bot.pvp.attack(target)
}

// PVP 2 — Strafe + bouclier + critiques
function attackMoyen(target) {
  log('in', `PVP 2 — Strafe + bouclier sur ${target.username}`)
  bot.pvp.attack(target)

  // Strafe circulaire
  let strafeDir = 1
  const strafeInterval = setInterval(() => {
    if (!currentTarget || pvpMode !== 2) { clearInterval(strafeInterval); return }
    bot.setControlState('left', strafeDir === 1)
    bot.setControlState('right', strafeDir === -1)
    strafeDir *= -1
  }, 600)

  // Critical hit : saute avant chaque frappe
  const critInterval = setInterval(() => {
    if (!currentTarget || pvpMode !== 2) { clearInterval(critInterval); return }
    if (bot.entity.onGround) bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 200)
  }, 1400)
}

// PVP 3 — Maître : critiques, potions, combo
function attackMaitre(target) {
  log('in', `PVP 3 — Mode maître sur ${target.username}`)
  bot.pvp.attack(target)

  // Strafe rapide
  let dir = 1
  const strafe = setInterval(() => {
    if (!currentTarget || pvpMode !== 3) { clearInterval(strafe); return }
    bot.setControlState('left', dir === 1)
    bot.setControlState('right', dir === -1)
    dir *= -1
  }, 400)

  // Critiques
  const crit = setInterval(() => {
    if (!currentTarget || pvpMode !== 3) { clearInterval(crit); return }
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 150)
  }, 1200)

  // Potions de splash toutes les 5s
  const potionInterval = setInterval(() => {
    if (!currentTarget || pvpMode !== 3) { clearInterval(potionInterval); return }
    throwSplashPotion(target)
  }, 5000)
}

// PVP 4 — Elytra + roquettes + one-shot dive
async function attackElytra(target) {
  log('in', `PVP 4 — Mode Elytra/Dive sur ${target.username}`)

  try {
    // Monte en hauteur (+20 blocs)
    const highPos = target.position.offset(0, 20, 0)
    const goal = new goals.GoalBlock(highPos.x, highPos.y, highPos.z)
    bot.pathfinder.setGoal(goal)

    await waitUntilAboveTarget(target, 15)

    // Équipe l'elytra
    const elytra = bot.inventory.items().find(i => i.name === 'elytra')
    if (elytra) await bot.equip(elytra, 'torso')

    // Active l'elytra + roquette
    bot.setControlState('jump', true)
    setTimeout(() => {
      bot.setControlState('jump', false)
      useFirework()
    }, 200)

    // Dive vers la cible
    log('in', 'Dive attack en cours...')
    bot.lookAt(target.position.offset(0, 1, 0))

    // Équipe la hache pour one-shot
    const axe = bot.inventory.items().find(i => i.name.includes('netherite_axe'))
    if (axe) await bot.equip(axe, 'hand')

    // Attaque dès que proche
    const diveCheck = setInterval(() => {
      if (!currentTarget || pvpMode !== 4) { clearInterval(diveCheck); return }
      const dist = bot.entity.position.distanceTo(currentTarget.position)
      if (dist < 4) {
        clearInterval(diveCheck)
        log('ok', 'Contact! ONE SHOT!')
        bot.pvp.attack(currentTarget)
        // Brise bouclier avec hache puis frappe
        bot.swingArm()
        setTimeout(() => bot.attack(currentTarget), 200)
      }
    }, 100)
  } catch (e) {
    log('err', 'Erreur elytra: ' + e.message)
    // Fallback mode 3 si elytra échoue
    attackMaitre(target)
  }
}

// ══════════════════════════════════════
//  UTILITAIRES
// ══════════════════════════════════════
function findNearestPlayer() {
  const players = Object.values(bot.entities).filter(e =>
    e.type === 'player' && e.username !== bot.username
  )
  if (players.length === 0) return null
  return players.sort((a, b) =>
    bot.entity.position.distanceTo(a.position) -
    bot.entity.position.distanceTo(b.position)
  )[0]
}

function waitUntilAboveTarget(target, minHeight) {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const dy = bot.entity.position.y - target.position.y
      if (dy >= minHeight) { clearInterval(check); resolve() }
    }, 500)
    setTimeout(() => { clearInterval(check); resolve() }, 8000)
  })
}

function useFirework() {
  const fw = bot.inventory.items().find(i => i.name.includes('firework_rocket'))
  if (fw) {
    bot.equip(fw, 'off-hand').then(() => {
      bot.activateItem(true)
    }).catch(() => {})
  }
}

function throwSplashPotion(target) {
  const potion = bot.inventory.items().find(i => i.name.includes('splash_potion'))
  if (!potion) return
  bot.equip(potion, 'hand').then(() => {
    bot.lookAt(target.position.offset(0, 0.5, 0))
    setTimeout(() => bot.activateItem(), 100)
  }).catch(() => {})
}

function healSelf() {
  const potion = bot.inventory.items().find(i =>
    i.name.includes('instant_health') || i.name.includes('golden_apple')
  )
  if (potion) {
    bot.equip(potion, 'hand').then(() => {
      bot.activateItem()
      log('ok', 'Auto-heal utilisé')
    }).catch(() => {})
  }
}

function landSafely() {
  bot.setControlState('sneak', true)
  setTimeout(() => {
    bot.setControlState('sneak', false)
    log('in', 'Atterrissage en sécurité')
  }, 2000)
}

function stopBot() {
  pvpMode = 0
  currentTarget = null
  bot.pvp.stop()
  bot.clearControlStates()
  log('warn', 'Bot PVP arrêté')
  bot.chat('Bot PVP arrêté.')
}

function sendStatus() {
  bot.chat(`Mode: PVP ${pvpMode} | HP: ${Math.round(bot.health)}/20 | Kills: ${kills} | Totems brisés: ${totems}`)
}

function setupPathfinder() {
  const mcData = require('minecraft-data')(bot.version)
  const defaultMove = new Movements(bot, mcData)
  bot.pathfinder.setMovements(defaultMove)
}

// Boucle principale : re-cherche une cible si perdue
function startTickLoop() {
  setInterval(() => {
    if (pvpMode === 0) return
    if (!currentTarget || !bot.entities[currentTarget.id]) {
      const t = findNearestPlayer()
      if (t) {
        currentTarget = t
        log('in', `Nouvelle cible: ${t.username}`)
        attackTarget(t)
      }
    }
  }, 3000)
}

// ══════════════════════════════════════
//  CONSOLE LOCALE (terminal)
// ══════════════════════════════════════
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.on('line', (line) => {
  const l = line.trim().toLowerCase()
  if (l === 'pvp 1') setPvpMode(1, 'console')
  else if (l === 'pvp 2') setPvpMode(2, 'console')
  else if (l === 'pvp 3') setPvpMode(3, 'console')
  else if (l === 'pvp 4') setPvpMode(4, 'console')
  else if (l === 'stop') stopBot()
  else if (l === 'status') sendStatus()
  else console.log('[?] Commandes: pvp 1 | pvp 2 | pvp 3 | pvp 4 | stop | status')
})

function log(type, msg) {
  const icons = { ok: '✔', warn: '⚠', err: '✘', in: '→' }
  console.log(`[${new Date().toLocaleTimeString()}] ${icons[type]||'•'} ${msg}`)
}
