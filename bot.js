const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const readline = require('readline')

// ══════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════
const CONFIG = {
  host: '141.11.185.41',  // <-- mets ton serveur ici
  port: 50638,
  username: 'CraftBot_01',
  version: '1.20.1',
}

// ══════════════════════════════════════
//  CRÉATION DU BOT
// ══════════════════════════════════════
const bot = mineflayer.createBot(CONFIG)
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)

let pvpMode = 0
let currentTarget = null
let waitingAfterTotem = false
let kills = 0
let totems = 0

// ══════════════════════════════════════
//  EVENTS DE BASE
// ══════════════════════════════════════
bot.once('spawn', () => {
  log('ok', 'Bot connecté à ' + CONFIG.host)
  log('ok', 'Commandes: pvp 1 / pvp 2 / pvp 3 / pvp 4 / stop / status')
  setupPathfinder()
  startTickLoop()
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const msg = message.toLowerCase().trim()
  if (msg === 'pvp 1') setPvpMode(1, username)
  else if (msg === 'pvp 2') setPvpMode(2, username)
  else if (msg === 'pvp 3') setPvpMode(3, username)
  else if (msg === 'pvp 4') setPvpMode(4, username)
  else if (msg === 'stop') stopBot()
  else if (msg === 'status') sendStatus()
})

// physicsTick (corrigé — plus de deprecated warning)
bot.on('physicsTick', () => {
  if (!currentTarget || pvpMode === 0) return
  const dist = bot.entity.position.distanceTo(currentTarget.position)

  // Critique : saute avant de frapper si mode >= 2
  if (pvpMode >= 2 && dist < 4 && bot.entity.onGround) {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 150)
  }
})

bot.on('entityHurt', (entity) => {
  if (entity === bot.entity && bot.health < 6) healSelf()
})

// Détection totem : le joueur reçoit régénération après quasi-mort
bot.on('entityEffect', (entity, effect) => {
  if (!currentTarget) return
  if (entity.username !== currentTarget.username) return
  // effect 10 = Regeneration (activé par totem)
  if ((effect.id === 10 || effect.id === 5) && !waitingAfterTotem) {
    waitingAfterTotem = true
    totems++
    log('warn', 'Totem activé par ' + entity.username + ' ! Recul 3s puis re-kill...')
    bot.pvp.stop()
    bot.clearControlStates()
    bot.setControlState('back', true)
    setTimeout(() => {
      bot.setControlState('back', false)
      waitingAfterTotem = false
      if (currentTarget && pvpMode > 0) {
        log('ok', 'Re-attaque après totem sur ' + currentTarget.username)
        attackTarget(currentTarget)
      }
    }, 3000)
  }
})

bot.on('entityDead', (entity) => {
  if (!currentTarget) return
  if (entity.username !== currentTarget.username) return
  kills++
  log('ok', 'KILL #' + kills + ' — ' + entity.username + ' éliminé !')
  currentTarget = null
  bot.pvp.stop()
  bot.clearControlStates()
  if (pvpMode === 4) landSafely()
})

bot.on('error', (err) => log('err', 'Erreur: ' + err.message))
bot.on('kicked', (reason) => log('err', 'Kicked: ' + reason))
bot.on('end', () => {
  log('warn', 'Déconnecté. Reconnexion dans 5s...')
  setTimeout(() => {
    log('in', 'Reconnexion...')
    // relance le script
    require('child_process').spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit', detached: false
    })
    process.exit()
  }, 5000)
})

// ══════════════════════════════════════
//  MODES PVP
// ══════════════════════════════════════
function setPvpMode(mode, requester) {
  pvpMode = mode
  const names = { 1: 'Facile', 2: 'Moyen', 3: 'Maître', 4: 'Pro Elytra' }
  log('ok', 'Mode PVP ' + mode + ' (' + names[mode] + ') activé par ' + requester)
  bot.chat('Mode PVP ' + mode + ' (' + names[mode] + ') activé !')
  equip(mode)
  const target = findNearestPlayer()
  if (target) {
    currentTarget = target
    log('ok', 'Cible: ' + target.username)
    attackTarget(target)
  } else {
    log('warn', 'Aucun joueur proche. En attente...')
  }
}

function equip(mode) {
  const slots = {
    1: [{ name: 'diamond_sword', hand: 'hand' }],
    2: [{ name: 'diamond_sword', hand: 'hand' }, { name: 'shield', hand: 'off-hand' }],
    3: [{ name: 'netherite_sword', hand: 'hand' }, { name: 'shield', hand: 'off-hand' }],
    4: [{ name: 'netherite_axe', hand: 'hand' }, { name: 'elytra', hand: 'torso' }],
  }
  const wanted = slots[mode] || slots[1]
  for (const slot of wanted) {
    const item = bot.inventory.items().find(i => i.name.includes(slot.name))
    if (item) bot.equip(item, slot.hand).catch(() => {})
  }
}

// ══════════════════════════════════════
//  ATTAQUE PAR MODE
// ══════════════════════════════════════
function attackTarget(target) {
  if (!target || pvpMode === 0) return
  currentTarget = target
  if (pvpMode === 1) attackSimple(target)
  else if (pvpMode === 2) attackMoyen(target)
  else if (pvpMode === 3) attackMaitre(target)
  else if (pvpMode === 4) attackElytra(target)
}

// PVP 1 — Simple
function attackSimple(target) {
  log('in', 'PVP 1 — Attaque simple: ' + target.username)
  bot.pvp.attack(target)
}

// PVP 2 — Strafe + bouclier
function attackMoyen(target) {
  log('in', 'PVP 2 — Strafe + bouclier: ' + target.username)
  bot.pvp.attack(target)
  let dir = 1
  const strafe = setInterval(() => {
    if (!currentTarget || pvpMode !== 2) {
      clearInterval(strafe)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      return
    }
    bot.setControlState('left', dir === 1)
    bot.setControlState('right', dir === -1)
    dir *= -1
  }, 600)
}

// PVP 3 — Maître : strafe rapide + potions
function attackMaitre(target) {
  log('in', 'PVP 3 — Mode maître: ' + target.username)
  bot.pvp.attack(target)
  let dir = 1
  const strafe = setInterval(() => {
    if (!currentTarget || pvpMode !== 3) {
      clearInterval(strafe)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      return
    }
    bot.setControlState('left', dir === 1)
    bot.setControlState('right', dir === -1)
    dir *= -1
  }, 350)
  const potions = setInterval(() => {
    if (!currentTarget || pvpMode !== 3) { clearInterval(potions); return }
    throwSplashPotion(currentTarget)
  }, 5000)
}

// PVP 4 — Elytra dive + one-shot
async function attackElytra(target) {
  log('in', 'PVP 4 — Elytra dive sur: ' + target.username)
  try {
    // Monte en hauteur
    const highPos = target.position.offset(0, 22, 0)
    const goal = new goals.GoalBlock(
      Math.floor(highPos.x),
      Math.floor(highPos.y),
      Math.floor(highPos.z)
    )
    bot.pathfinder.setGoal(goal)
    await waitUntilAboveTarget(target, 15)

    // Équipe elytra
    const elytra = bot.inventory.items().find(i => i.name === 'elytra')
    if (elytra) await bot.equip(elytra, 'torso').catch(() => {})

    // Active l'elytra
    bot.setControlState('jump', true)
    await sleep(200)
    bot.setControlState('jump', false)

    // Roquette
    useFirework()

    // Vise la cible
    await bot.lookAt(target.position.offset(0, 1, 0))
    log('in', 'Dive en cours...')

    // Équipe hache pour one-shot
    const axe = bot.inventory.items().find(i => i.name.includes('netherite_axe'))
    if (axe) await bot.equip(axe, 'hand').catch(() => {})

    // Frappe dès contact
    const check = setInterval(() => {
      if (!currentTarget || pvpMode !== 4) { clearInterval(check); return }
      const dist = bot.entity.position.distanceTo(currentTarget.position)
      if (dist < 4) {
        clearInterval(check)
        log('ok', 'ONE SHOT !')
        bot.swingArm()
        setTimeout(() => {
          if (currentTarget) bot.attack(currentTarget)
        }, 100)
      }
    }, 100)
  } catch (e) {
    log('err', 'Elytra erreur: ' + e.message + ' — fallback mode 3')
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
  if (!players.length) return null
  return players.sort((a, b) =>
    bot.entity.position.distanceTo(a.position) -
    bot.entity.position.distanceTo(b.position)
  )[0]
}

function waitUntilAboveTarget(target, minH) {
  return new Promise(resolve => {
    const t = setInterval(() => {
      const dy = bot.entity.position.y - target.position.y
      if (dy >= minH) { clearInterval(t); resolve() }
    }, 400)
    setTimeout(() => { clearInterval(t); resolve() }, 9000)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function useFirework() {
  const fw = bot.inventory.items().find(i => i.name.includes('firework_rocket'))
  if (!fw) return
  bot.equip(fw, 'off-hand').then(() => {
    bot.activateItem(true)
  }).catch(() => {})
}

function throwSplashPotion(target) {
  const p = bot.inventory.items().find(i => i.name.includes('splash_potion'))
  if (!p) return
  bot.equip(p, 'hand').then(() => {
    bot.lookAt(target.position.offset(0, 0.5, 0))
    setTimeout(() => bot.activateItem(), 100)
  }).catch(() => {})
}

function healSelf() {
  const item = bot.inventory.items().find(i =>
    i.name.includes('golden_apple') || i.name.includes('instant_health')
  )
  if (!item) return
  bot.equip(item, 'hand').then(() => {
    bot.activateItem()
    log('ok', 'Auto-heal utilisé')
  }).catch(() => {})
}

function landSafely() {
  bot.setControlState('sneak', true)
  setTimeout(() => {
    bot.setControlState('sneak', false)
    log('in', 'Atterrissage OK')
  }, 2000)
}

function stopBot() {
  pvpMode = 0
  currentTarget = null
  bot.pvp.stop()
  bot.clearControlStates()
  log('warn', 'Bot arrêté')
  bot.chat('Bot PVP arrêté.')
}

function sendStatus() {
  const modes = { 0: 'OFF', 1: 'Facile', 2: 'Moyen', 3: 'Maître', 4: 'Pro Elytra' }
  const msg = 'Mode: ' + modes[pvpMode] +
    ' | HP: ' + Math.round(bot.health) + '/20' +
    ' | Kills: ' + kills +
    ' | Totems brisés: ' + totems
  bot.chat(msg)
  log('in', msg)
}

function setupPathfinder() {
  try {
    const mcData = require('minecraft-data')(bot.version)
    const move = new Movements(bot, mcData)
    bot.pathfinder.setMovements(move)
  } catch (e) {
    log('err', 'Pathfinder setup: ' + e.message)
  }
}

// Boucle : re-cherche une cible si perdue
function startTickLoop() {
  setInterval(() => {
    if (pvpMode === 0 || waitingAfterTotem) return
    if (!currentTarget || !bot.entities[currentTarget.id]) {
      const t = findNearestPlayer()
      if (t) {
        currentTarget = t
        log('in', 'Nouvelle cible: ' + t.username)
        attackTarget(t)
      }
    }
  }, 3000)
}

// ══════════════════════════════════════
//  CONSOLE TERMINAL
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
  else log('warn', 'Commandes: pvp 1 | pvp 2 | pvp 3 | pvp 4 | stop | status')
})

function log(type, msg) {
  const icons = { ok: '✔', warn: '⚠', err: '✘', in: '→' }
  const time = new Date().toLocaleTimeString('fr-FR')
  console.log('[' + time + '] ' + (icons[type] || '•') + ' ' + msg)
}
