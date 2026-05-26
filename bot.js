const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const readline = require('readline')

// ══════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════
const CONFIG = {
  host: '141.11.185.41',  // <-- ton serveur ici
  port: 50638,
  username: 'CraftBot_01',
  version: '1.21.1',            // version correcte
  auth: 'offline',              // 'microsoft' si serveur premium
}

// ══════════════════════════════════════
//  ÉTAT DU BOT
// ══════════════════════════════════════
let pvpMode = 0
let currentTarget = null
let waitingAfterTotem = false
let kills = 0
let totems = 0
let isEquipped = false
let isEquipping = false

// Équipement par mode
const GEAR = {
  // Mode 1 — Facile : armure fer + épée diamant
  1: {
    helmet:      'iron_helmet',
    chestplate:  'iron_chestplate',
    leggings:    'iron_leggings',
    boots:       'iron_boots',
    mainhand:    'diamond_sword',
    offhand:     null,
  },
  // Mode 2 — Moyen : armure diamant + épée + bouclier
  2: {
    helmet:      'diamond_helmet',
    chestplate:  'diamond_chestplate',
    leggings:    'diamond_leggings',
    boots:       'diamond_boots',
    mainhand:    'diamond_sword',
    offhand:     'shield',
  },
  // Mode 3 — Maître : armure nethérite + épée + bouclier
  3: {
    helmet:      'netherite_helmet',
    chestplate:  'netherite_chestplate',
    leggings:    'netherite_leggings',
    boots:       'netherite_boots',
    mainhand:    'netherite_sword',
    offhand:     'shield',
  },
  // Mode 4 — Pro Elytra : armure nethérite + elytra + hache + roquettes
  4: {
    helmet:      'netherite_helmet',
    chestplate:  'elytra',           // elytra à la place du plastron
    leggings:    'netherite_leggings',
    boots:       'netherite_boots',
    mainhand:    'netherite_axe',
    offhand:     'firework_rocket',
  },
}

// Items à donner via /give (mode créatif sur TON serveur)
const GIVE_ITEMS = {
  1: [
    'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
    'diamond_sword', 'golden_apple 16', 'cooked_beef 64',
  ],
  2: [
    'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
    'diamond_sword', 'shield', 'golden_apple 16',
    'splash_potion{Potion:"minecraft:harming"} 16', 'cooked_beef 64',
  ],
  3: [
    'netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots',
    'netherite_sword', 'shield', 'bow', 'arrow 64',
    'golden_apple 32', 'splash_potion{Potion:"minecraft:harming"} 32',
  ],
  4: [
    'netherite_helmet', 'elytra', 'netherite_leggings', 'netherite_boots',
    'netherite_axe', 'firework_rocket 64',
    'golden_apple 32', 'totem_of_undying 2',
  ],
}

// ══════════════════════════════════════
//  CRÉATION DU BOT
// ══════════════════════════════════════
const bot = mineflayer.createBot(CONFIG)
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)

bot.once('spawn', () => {
  log('ok', 'Bot connecté — version ' + CONFIG.version)
  log('ok', 'Commandes: pvp 1/2/3/4 | stop | status | equip')
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
  else if (msg === 'equip') autoEquip(pvpMode || 1)
})

// physicsTick corrigé
bot.on('physicsTick', () => {
  if (!currentTarget || pvpMode === 0) return
  const dist = bot.entity.position.distanceTo(currentTarget.position)
  if (pvpMode >= 2 && dist < 4 && bot.entity.onGround) {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 150)
  }
})

bot.on('entityHurt', (entity) => {
  if (entity === bot.entity) {
    if (bot.health < 6) healSelf()
  }
})

bot.on('entityEffect', (entity, effect) => {
  if (!currentTarget) return
  if (entity.username !== currentTarget.username) return
  if ((effect.id === 10 || effect.id === 5) && !waitingAfterTotem) {
    waitingAfterTotem = true
    totems++
    log('warn', 'Totem sur ' + entity.username + ' ! Recul 3s puis re-kill...')
    bot.pvp.stop()
    bot.clearControlStates()
    bot.setControlState('back', true)
    setTimeout(() => {
      bot.setControlState('back', false)
      waitingAfterTotem = false
      if (currentTarget && pvpMode > 0) {
        log('ok', 'Re-attaque après totem: ' + currentTarget.username)
        attackTarget(currentTarget)
      }
    }, 3000)
  }
})

bot.on('entityDead', (entity) => {
  if (!currentTarget) return
  if (entity.username !== currentTarget.username) return
  kills++
  log('ok', 'KILL #' + kills + ' — ' + entity.username)
  currentTarget = null
  bot.pvp.stop()
  bot.clearControlStates()
  if (pvpMode === 4) landSafely()
})

bot.on('error', (err) => log('err', err.message))
bot.on('kicked', (reason) => log('err', 'Kicked: ' + reason))
bot.on('end', () => {
  log('warn', 'Déconnecté. Reconnexion dans 5s...')
  isEquipped = false
  setTimeout(() => {
    require('child_process').spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit', detached: false,
    })
    process.exit()
  }, 5000)
})

// ══════════════════════════════════════
//  AUTO-ÉQUIPEMENT (nécessite OP)
// ══════════════════════════════════════
async function autoEquip(mode) {
  if (isEquipping) return
  isEquipping = true
  isEquipped = false
  const gear = GEAR[mode]
  const items = GIVE_ITEMS[mode]
  if (!gear || !items) { isEquipping = false; return }

  log('in', 'Auto-équipement mode ' + mode + '...')

  // Passe en créatif pour se donner les items (OP requis)
  bot.chat('/gamemode creative')
  await sleep(600)

  // Vide l'inventaire d'abord
  bot.chat('/clear @s')
  await sleep(400)

  // Donne tous les items
  for (const item of items) {
    bot.chat('/give @s minecraft:' + item)
    await sleep(200)
  }

  // Repasse en survie
  bot.chat('/gamemode survival')
  await sleep(800)

  // Équipe l'armure et les armes
  await equipItem(gear.helmet, 'head')
  await equipItem(gear.chestplate, 'torso')
  await equipItem(gear.leggings, 'legs')
  await equipItem(gear.boots, 'feet')
  await equipItem(gear.mainhand, 'hand')
  if (gear.offhand) await equipItem(gear.offhand, 'off-hand')

  isEquipped = true
  isEquipping = false
  log('ok', 'Équipement mode ' + mode + ' prêt !')
  bot.chat('Équipement PVP ' + mode + ' prêt !')
}

async function equipItem(itemName, slot) {
  if (!itemName) return
  await sleep(150)
  const item = bot.inventory.items().find(i => i.name.includes(itemName))
  if (item) {
    await bot.equip(item, slot).catch(() => {})
  } else {
    log('warn', 'Item manquant: ' + itemName)
  }
}

// ══════════════════════════════════════
//  MODES PVP
// ══════════════════════════════════════
async function setPvpMode(mode, requester) {
  pvpMode = mode
  const names = { 1: 'Facile', 2: 'Moyen', 3: 'Maître', 4: 'Pro Elytra' }
  log('ok', 'Mode PVP ' + mode + ' (' + names[mode] + ') — ' + requester)
  bot.chat('Mode PVP ' + mode + ' activé !')

  // Auto-équipement avant d'attaquer
  await autoEquip(mode)

  const target = findNearestPlayer()
  if (target) {
    currentTarget = target
    log('ok', 'Cible: ' + target.username)
    attackTarget(target)
  } else {
    log('warn', 'Aucun joueur proche. En attente...')
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

function attackSimple(target) {
  log('in', 'PVP 1 — Attaque: ' + target.username)
  bot.pvp.attack(target)
}

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

async function attackElytra(target) {
  log('in', 'PVP 4 — Elytra dive: ' + target.username)
  try {
    const highPos = target.position.offset(0, 22, 0)
    bot.pathfinder.setGoal(new goals.GoalBlock(
      Math.floor(highPos.x), Math.floor(highPos.y), Math.floor(highPos.z)
    ))
    await waitUntilAboveTarget(target, 15)

    const elytra = bot.inventory.items().find(i => i.name === 'elytra')
    if (elytra) await bot.equip(elytra, 'torso').catch(() => {})

    bot.setControlState('jump', true)
    await sleep(200)
    bot.setControlState('jump', false)
    useFirework()

    await bot.lookAt(target.position.offset(0, 1, 0))
    log('in', 'Dive...')

    const axe = bot.inventory.items().find(i => i.name.includes('netherite_axe'))
    if (axe) await bot.equip(axe, 'hand').catch(() => {})

    const check = setInterval(() => {
      if (!currentTarget || pvpMode !== 4) { clearInterval(check); return }
      const dist = bot.entity.position.distanceTo(currentTarget.position)
      if (dist < 4) {
        clearInterval(check)
        log('ok', 'ONE SHOT !')
        bot.swingArm()
        setTimeout(() => { if (currentTarget) bot.attack(currentTarget) }, 100)
      }
    }, 100)
  } catch (e) {
    log('err', 'Elytra: ' + e.message + ' → fallback mode 3')
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
    setTimeout(() => { clearInterval(t); resolve() }, 10000)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function useFirework() {
  const fw = bot.inventory.items().find(i => i.name.includes('firework_rocket'))
  if (!fw) return
  bot.equip(fw, 'off-hand').then(() => bot.activateItem(true)).catch(() => {})
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
    log('ok', 'Auto-heal !')
  }).catch(() => {})
}

function landSafely() {
  bot.setControlState('sneak', true)
  setTimeout(() => { bot.setControlState('sneak', false); log('in', 'Atterrissage OK') }, 2000)
}

function stopBot() {
  pvpMode = 0
  currentTarget = null
  isEquipped = false
  bot.pvp.stop()
  bot.clearControlStates()
  log('warn', 'Bot arrêté')
  bot.chat('Bot PVP arrêté.')
}

function sendStatus() {
  const names = { 0: 'OFF', 1: 'Facile', 2: 'Moyen', 3: 'Maître', 4: 'Pro Elytra' }
  const msg = 'PVP: ' + names[pvpMode] +
    ' | HP: ' + Math.round(bot.health) + '/20' +
    ' | Kills: ' + kills +
    ' | Totems: ' + totems +
    ' | Équipé: ' + (isEquipped ? 'oui' : 'non')
  bot.chat(msg)
  log('in', msg)
}

function setupPathfinder() {
  try {
    const mcData = require('minecraft-data')(bot.version)
    const move = new Movements(bot, mcData)
    bot.pathfinder.setMovements(move)
  } catch (e) {
    log('err', 'Pathfinder: ' + e.message)
  }
}

function startTickLoop() {
  setInterval(() => {
    if (pvpMode === 0 || waitingAfterTotem || isEquipping) return
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
  else if (l === 'equip') autoEquip(pvpMode || 1)
  else log('warn', 'Commandes: pvp 1/2/3/4 | stop | status | equip')
})

function log(type, msg) {
  const icons = { ok: '✔', warn: '⚠', err: '✘', in: '→' }
  console.log('[' + new Date().toLocaleTimeString('fr-FR') + '] ' + (icons[type] || '•') + ' ' + msg)
}
