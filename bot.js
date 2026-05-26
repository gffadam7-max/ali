const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const readline = require('readline')

// Patch physicTick deprecated
const _emit = require('events').EventEmitter.prototype.emit
require('events').EventEmitter.prototype.emit = function(event, ...args) {
  if (event === 'physicTick') return _emit.call(this, 'physicsTick', ...args)
  return _emit.call(this, event, ...args)
}

// ══════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════
const CONFIG = {
  host: '141.11.185.41',  // <-- ton serveur
  port: 50638,
  username: 'CraftBot_01',
  version: '1.20.1',
  auth: 'offline',
}

// ══════════════════════════════════════
//  ÉTAT
// ══════════════════════════════════════
let pvpMode = 0
let currentTarget = null
let waitingAfterTotem = false
let kills = 0
let totems = 0
let isEquipping = false
let isEquipped = false
let attackLoop = null
let strafeLoop = null
let potionLoop = null

const GEAR = {
  1: { helmet:'iron_helmet', chestplate:'iron_chestplate', leggings:'iron_leggings', boots:'iron_boots', mainhand:'diamond_sword', offhand:null },
  2: { helmet:'diamond_helmet', chestplate:'diamond_chestplate', leggings:'diamond_leggings', boots:'diamond_boots', mainhand:'diamond_sword', offhand:'shield' },
  3: { helmet:'netherite_helmet', chestplate:'netherite_chestplate', leggings:'netherite_leggings', boots:'netherite_boots', mainhand:'netherite_sword', offhand:'shield' },
  4: { helmet:'netherite_helmet', chestplate:'elytra', leggings:'netherite_leggings', boots:'netherite_boots', mainhand:'netherite_axe', offhand:'firework_rocket' },
}

const GIVE_ITEMS = {
  1: ['iron_helmet','iron_chestplate','iron_leggings','iron_boots','diamond_sword','golden_apple 16','cooked_beef 64'],
  2: ['diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots','diamond_sword','shield','golden_apple 16','cooked_beef 64'],
  3: ['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots','netherite_sword','shield','golden_apple 32'],
  4: ['netherite_helmet','elytra','netherite_leggings','netherite_boots','netherite_axe','firework_rocket 64','golden_apple 32','totem_of_undying 2'],
}

// ══════════════════════════════════════
//  BOT
// ══════════════════════════════════════
const bot = mineflayer.createBot(CONFIG)
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)

bot.once('spawn', () => {
  log('ok', 'Connecté — ' + CONFIG.host + ' v' + CONFIG.version)
  log('ok', 'Commandes: pvp 1/2/3/4 | stop | status | equip')
  setupPathfinder()
  startScanLoop()
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

// physicsTick — critique sur saut
bot.on('physicsTick', () => {
  if (!currentTarget || pvpMode === 0 || pvpMode === 4) return
  const dist = bot.entity.position.distanceTo(currentTarget.position)
  // Critical hit : saute juste avant de frapper
  if (pvpMode >= 2 && dist < 3.5 && bot.entity.onGround) {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 100)
  }
})

bot.on('entityHurt', (entity) => {
  if (entity === bot.entity && bot.health < 6) healSelf()
})

// Totem détection
bot.on('entityEffect', (entity, effect) => {
  if (!currentTarget || entity.username !== currentTarget.username) return
  if ((effect.id === 10 || effect.id === 5) && !waitingAfterTotem) {
    waitingAfterTotem = true
    totems++
    log('warn', 'Totem sur ' + entity.username + ' — recul 3s puis re-kill')
    stopLoops()
    bot.pathfinder.setGoal(null)
    bot.setControlState('back', true)
    setTimeout(() => {
      bot.setControlState('back', false)
      waitingAfterTotem = false
      if (currentTarget && pvpMode > 0) {
        log('ok', 'Re-kill après totem: ' + currentTarget.username)
        startAttackLoop(currentTarget)
      }
    }, 3000)
  }
})

bot.on('entityDead', (entity) => {
  if (!currentTarget || entity.username !== currentTarget.username) return
  kills++
  log('ok', 'KILL #' + kills + ' — ' + entity.username)
  stopLoops()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  currentTarget = null
  if (pvpMode === 4) landSafely()
})

bot.on('error', err => log('err', err.message))
bot.on('kicked', reason => log('err', 'Kicked: ' + reason))
bot.on('end', () => {
  log('warn', 'Déconnecté. Reconnexion dans 5s...')
  isEquipped = false
  stopLoops()
  setTimeout(() => {
    require('child_process').spawn(process.argv[0], process.argv.slice(1), { stdio: 'inherit' })
    process.exit()
  }, 5000)
})

// ══════════════════════════════════════
//  BOUCLE D'ATTAQUE PRINCIPALE
//  C'est ici que le bot suit ET frappe
// ══════════════════════════════════════
function startAttackLoop(target) {
  stopLoops()
  currentTarget = target

  // Pathfinder suit la cible en permanence
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 1.5), true)

  attackLoop = setInterval(() => {
    if (!currentTarget || pvpMode === 0 || waitingAfterTotem) {
      stopLoops(); return
    }

    // Refresh la cible (entité toujours valide ?)
    const ent = bot.entities[currentTarget.id]
    if (!ent) { stopLoops(); currentTarget = null; return }

    const dist = bot.entity.position.distanceTo(ent.position)

    // Regarde toujours la cible
    bot.lookAt(ent.position.offset(0, 1.6, 0), true)

    // Frappe si assez proche (2.5 blocs = portée épée)
    if (dist <= 2.5) {
      bot.attack(ent)
    }

    // Mise à jour pathfinder goal
    bot.pathfinder.setGoal(new goals.GoalFollow(ent, 1.5), true)

  }, 500) // frappe toutes les 500ms max (cooldown épée 1.20)

  // Strafe si mode >= 2
  if (pvpMode >= 2) {
    let dir = 1
    strafeLoop = setInterval(() => {
      if (!currentTarget || pvpMode === 0) { clearInterval(strafeLoop); return }
      bot.setControlState('left', dir === 1)
      bot.setControlState('right', dir === -1)
      dir *= -1
    }, pvpMode >= 3 ? 350 : 600)
  }

  // Potions mode 3
  if (pvpMode === 3) {
    potionLoop = setInterval(() => {
      if (!currentTarget || pvpMode !== 3) { clearInterval(potionLoop); return }
      throwSplashPotion(currentTarget)
    }, 5000)
  }

  log('in', 'Attaque lancée sur ' + target.username + ' (dist: ' + Math.round(bot.entity.position.distanceTo(target.position)) + ' blocs)')
}

function stopLoops() {
  if (attackLoop) { clearInterval(attackLoop); attackLoop = null }
  if (strafeLoop) { clearInterval(strafeLoop); strafeLoop = null }
  if (potionLoop) { clearInterval(potionLoop); potionLoop = null }
  bot.setControlState('left', false)
  bot.setControlState('right', false)
  bot.pvp.stop()
}

// ══════════════════════════════════════
//  MODES PVP
// ══════════════════════════════════════
async function setPvpMode(mode, requester) {
  pvpMode = mode
  const names = { 1:'Facile', 2:'Moyen', 3:'Maître', 4:'Pro Elytra' }
  log('ok', 'PVP ' + mode + ' (' + names[mode] + ') par ' + requester)
  bot.chat('Mode PVP ' + mode + ' activé !')
  await autoEquip(mode)
  const target = findNearestPlayer()
  if (target) {
    if (mode === 4) attackElytra(target)
    else startAttackLoop(target)
  } else {
    log('warn', 'Aucun joueur proche, en attente...')
  }
}

function attackTarget(target) {
  if (!target || pvpMode === 0) return
  if (pvpMode === 4) attackElytra(target)
  else startAttackLoop(target)
}

// ══════════════════════════════════════
//  ELYTRA DIVE (mode 4)
// ══════════════════════════════════════
async function attackElytra(target) {
  log('in', 'PVP 4 — Elytra dive: ' + target.username)
  currentTarget = target
  try {
    const highPos = target.position.offset(0, 22, 0)
    bot.pathfinder.setGoal(new goals.GoalBlock(
      Math.floor(highPos.x), Math.floor(highPos.y), Math.floor(highPos.z)
    ))
    await waitUntilAboveTarget(target, 14)

    const elytra = bot.inventory.items().find(i => i.name === 'elytra')
    if (elytra) await bot.equip(elytra, 'torso').catch(() => {})

    bot.pathfinder.setGoal(null)
    bot.setControlState('jump', true)
    await sleep(200)
    bot.setControlState('jump', false)
    useFirework()

    await bot.lookAt(target.position.offset(0, 1, 0))
    log('in', 'Dive!')

    const axe = bot.inventory.items().find(i => i.name.includes('netherite_axe'))
    if (axe) await bot.equip(axe, 'hand').catch(() => {})

    const check = setInterval(() => {
      if (!currentTarget || pvpMode !== 4) { clearInterval(check); return }
      const dist = bot.entity.position.distanceTo(currentTarget.position)
      if (dist < 3.5) {
        clearInterval(check)
        log('ok', 'ONE SHOT!')
        bot.swingArm()
        setTimeout(() => { if (currentTarget) bot.attack(currentTarget) }, 80)
      }
    }, 100)
  } catch (e) {
    log('err', 'Elytra: ' + e.message + ' → mode 3')
    attackElytra = null
    startAttackLoop(target)
  }
}

// ══════════════════════════════════════
//  AUTO-ÉQUIPEMENT
// ══════════════════════════════════════
async function autoEquip(mode) {
  if (isEquipping) return
  isEquipping = true
  isEquipped = false
  const gear = GEAR[mode]
  const items = GIVE_ITEMS[mode]
  if (!gear || !items) { isEquipping = false; return }
  log('in', 'Équipement mode ' + mode + '...')
  bot.chat('/gamemode creative')
  await sleep(600)
  bot.chat('/clear @s')
  await sleep(400)
  for (const item of items) {
    bot.chat('/give @s minecraft:' + item)
    await sleep(200)
  }
  bot.chat('/gamemode survival')
  await sleep(800)
  await equipItem(gear.helmet, 'head')
  await equipItem(gear.chestplate, 'torso')
  await equipItem(gear.leggings, 'legs')
  await equipItem(gear.boots, 'feet')
  await equipItem(gear.mainhand, 'hand')
  if (gear.offhand) await equipItem(gear.offhand, 'off-hand')
  isEquipped = true
  isEquipping = false
  log('ok', 'Équipé mode ' + mode + ' !')
}

async function equipItem(itemName, slot) {
  if (!itemName) return
  await sleep(150)
  const item = bot.inventory.items().find(i => i.name.includes(itemName))
  if (item) await bot.equip(item, slot).catch(() => {})
  else log('warn', 'Manquant: ' + itemName)
}

// ══════════════════════════════════════
//  SCAN LOOP — cherche une cible si aucune
// ══════════════════════════════════════
function startScanLoop() {
  setInterval(() => {
    if (pvpMode === 0 || waitingAfterTotem || isEquipping) return
    if (!currentTarget || !bot.entities[currentTarget.id]) {
      const t = findNearestPlayer()
      if (t) {
        log('in', 'Cible trouvée: ' + t.username)
        attackTarget(t)
      }
    }
  }, 2000)
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
      if (!target) { clearInterval(t); resolve(); return }
      const dy = bot.entity.position.y - target.position.y
      if (dy >= minH) { clearInterval(t); resolve() }
    }, 400)
    setTimeout(() => { clearInterval(t); resolve() }, 12000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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
  bot.equip(item, 'hand').then(() => { bot.activateItem(); log('ok', 'Heal!') }).catch(() => {})
}

function landSafely() {
  bot.setControlState('sneak', true)
  setTimeout(() => { bot.setControlState('sneak', false); log('in', 'Atterrissage OK') }, 2000)
}

function stopBot() {
  pvpMode = 0
  currentTarget = null
  isEquipped = false
  stopLoops()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  log('warn', 'Bot arrêté')
  bot.chat('Bot arrêté.')
}

function sendStatus() {
  const names = { 0:'OFF', 1:'Facile', 2:'Moyen', 3:'Maître', 4:'Pro Elytra' }
  const msg = 'PVP: ' + names[pvpMode] + ' | HP: ' + Math.round(bot.health) + '/20 | Kills: ' + kills + ' | Totems: ' + totems
  bot.chat(msg); log('in', msg)
}

function setupPathfinder() {
  try {
    const mcData = require('minecraft-data')(bot.version)
    const move = new Movements(bot, mcData)
    move.canDig = false
    move.allowSprinting = true
    bot.pathfinder.setMovements(move)
  } catch (e) { log('err', 'Pathfinder: ' + e.message) }
}

// Console terminal
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.on('line', line => {
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
  const icons = { ok:'✔', warn:'⚠', err:'✘', in:'→' }
  console.log('[' + new Date().toLocaleTimeString('fr-FR') + '] ' + (icons[type]||'•') + ' ' + msg)
}
