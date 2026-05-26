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
  host: '141.11.185.41',
  port: 50638,
  username: 'CraftBot_01',
  version: '1.20.1',
  auth: 'offline',
}

// Joueurs autorisés pour PVP 5 (ton serveur perso)
// Laisse vide [] pour attaquer seulement ceux qui attaquent en premier
const WHITELIST_OWNERS = ['TonPseudo'] // toi = jamais attaqué
const PVP5_TARGETS = []                // [] = seulement counter-attack

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
let farmMode = false
let farmPhase = 'idle' // idle | mining | smelting | equipping
let farmProgress = { wood:0, stone:0, iron:0, coal:0, armor:'none' }
let botStats = { kills:0, totems:0, farmCycles:0, deaths:0, uptime:0 }

const GEAR = {
  1: { helmet:'iron_helmet', chestplate:'iron_chestplate', leggings:'iron_leggings', boots:'iron_boots', mainhand:'diamond_sword', offhand:null },
  2: { helmet:'diamond_helmet', chestplate:'diamond_chestplate', leggings:'diamond_leggings', boots:'diamond_boots', mainhand:'diamond_sword', offhand:'shield' },
  3: { helmet:'netherite_helmet', chestplate:'netherite_chestplate', leggings:'netherite_leggings', boots:'netherite_boots', mainhand:'netherite_sword', offhand:'shield' },
  4: { helmet:'netherite_helmet', chestplate:'elytra', leggings:'netherite_leggings', boots:'netherite_boots', mainhand:'netherite_axe', offhand:'firework_rocket' },
  5: { helmet:'iron_helmet', chestplate:'iron_chestplate', leggings:'iron_leggings', boots:'iron_boots', mainhand:'iron_sword', offhand:'shield' },
}

const GIVE_ITEMS = {
  1: ['iron_helmet','iron_chestplate','iron_leggings','iron_boots','diamond_sword','golden_apple 16','cooked_beef 64'],
  2: ['diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots','diamond_sword','shield','golden_apple 16'],
  3: ['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots','netherite_sword','shield','golden_apple 32'],
  4: ['netherite_helmet','elytra','netherite_leggings','netherite_boots','netherite_axe','firework_rocket 64','golden_apple 32','totem_of_undying 2'],
  5: [], // mode 5 = farm réel, pas de /give
}

// ══════════════════════════════════════
//  BOT
// ══════════════════════════════════════
const bot = mineflayer.createBot(CONFIG)
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)

bot.once('spawn', () => {
  log('ok', 'Connecté — ' + CONFIG.host)
  log('ok', 'Commandes: pvp 1/2/3/4/5 | stop | status | equip')
  setupPathfinder()
  startScanLoop()
  startUptimeCounter()
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const msg = message.toLowerCase().trim()
  if (msg === 'pvp 1') setPvpMode(1, username)
  else if (msg === 'pvp 2') setPvpMode(2, username)
  else if (msg === 'pvp 3') setPvpMode(3, username)
  else if (msg === 'pvp 4') setPvpMode(4, username)
  else if (msg === 'pvp 5') setPvpMode(5, username)
  else if (msg === 'stop') stopBot()
  else if (msg === 'status') sendStatus()
  else if (msg === 'equip') autoEquip(pvpMode || 1)
  else if (msg === 'farm') startFarm()
})

bot.on('physicsTick', () => {
  if (!currentTarget || pvpMode === 0 || pvpMode === 4) return
  const dist = bot.entity.position.distanceTo(currentTarget.position)
  if (pvpMode >= 2 && dist < 3.5 && bot.entity.onGround) {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 100)
  }
})

bot.on('entityHurt', (entity) => {
  if (entity !== bot.entity) return
  if (bot.health < 6) healSelf()
  // PVP 5 counter-attack : si quelqu'un frappe le bot
  if (pvpMode === 5 && !currentTarget) {
    const attacker = findNearestPlayer()
    if (attacker && !WHITELIST_OWNERS.includes(attacker.username)) {
      log('warn', 'Attaqué par ' + attacker.username + ' — counter-attack !')
      startAttackLoop(attacker)
    }
  }
})

bot.on('entityEffect', (entity, effect) => {
  if (!currentTarget || entity.username !== currentTarget.username) return
  if ((effect.id === 10 || effect.id === 5) && !waitingAfterTotem) {
    waitingAfterTotem = true
    totems++; botStats.totems++
    log('warn', 'Totem sur ' + entity.username + ' — recul 3s puis re-kill')
    stopLoops()
    bot.pathfinder.setGoal(null)
    bot.setControlState('back', true)
    setTimeout(() => {
      bot.setControlState('back', false)
      waitingAfterTotem = false
      if (currentTarget && pvpMode > 0) {
        log('ok', 'Re-kill: ' + currentTarget.username)
        startAttackLoop(currentTarget)
      }
    }, 3000)
  }
})

bot.on('entityDead', (entity) => {
  if (!currentTarget || entity.username !== currentTarget.username) return
  kills++; botStats.kills++
  log('ok', 'KILL #' + kills + ' — ' + entity.username)
  stopLoops()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  currentTarget = null
  if (pvpMode === 4) landSafely()
  // PVP 5 : cherche la prochaine cible autorisée
  if (pvpMode === 5) {
    setTimeout(() => {
      const next = findPvp5Target()
      if (next) { log('in', 'Prochaine cible PVP5: ' + next.username); startAttackLoop(next) }
      else { log('in', 'Plus de cibles, reprise du farm...'); startFarm() }
    }, 2000)
  }
})

bot.on('playerCollect', (collector, itemDrop) => {
  if (collector !== bot.entity) return
  updateFarmInventory()
})

bot.on('death', () => {
  botStats.deaths++
  log('warn', 'Bot mort. Respawn...')
  stopLoops()
  farmMode = false
  farmPhase = 'idle'
  currentTarget = null
  isEquipped = false
  setTimeout(() => {
    if (pvpMode === 5) { log('in', 'Reprise farm après mort...'); startFarm() }
  }, 3000)
})

bot.on('error', err => log('err', err.message))
bot.on('kicked', reason => log('err', 'Kicked: ' + reason))
bot.on('end', () => {
  log('warn', 'Déconnecté. Reconnexion dans 5s...')
  isEquipped = false; stopLoops()
  setTimeout(() => {
    require('child_process').spawn(process.argv[0], process.argv.slice(1), { stdio: 'inherit' })
    process.exit()
  }, 5000)
})

// ══════════════════════════════════════
//  BOUCLE D'ATTAQUE — suit ET frappe
// ══════════════════════════════════════
function startAttackLoop(target) {
  stopLoops()
  currentTarget = target
  farmMode = false

  bot.pathfinder.setGoal(new goals.GoalFollow(target, 1.5), true)

  attackLoop = setInterval(() => {
    if (!currentTarget || pvpMode === 0 || waitingAfterTotem) { stopLoops(); return }
    const ent = bot.entities[currentTarget.id]
    if (!ent) { stopLoops(); currentTarget = null; return }

    const dist = bot.entity.position.distanceTo(ent.position)
    bot.lookAt(ent.position.offset(0, 1.6, 0), true)

    if (dist <= 2.5) {
      bot.attack(ent)
    }

    bot.pathfinder.setGoal(new goals.GoalFollow(ent, 1.5), true)
  }, 500)

  if (pvpMode >= 2) {
    let dir = 1
    strafeLoop = setInterval(() => {
      if (!currentTarget) { clearInterval(strafeLoop); return }
      bot.setControlState('left', dir === 1)
      bot.setControlState('right', dir === -1)
      dir *= -1
    }, pvpMode >= 3 ? 350 : 600)
  }

  if (pvpMode === 3 || pvpMode === 5) {
    potionLoop = setInterval(() => {
      if (!currentTarget) { clearInterval(potionLoop); return }
      throwSplashPotion(currentTarget)
    }, 5000)
  }

  log('in', 'Attaque: ' + target.username + ' (' + Math.round(bot.entity.position.distanceTo(target.position)) + ' blocs)')
}

function stopLoops() {
  if (attackLoop) { clearInterval(attackLoop); attackLoop = null }
  if (strafeLoop) { clearInterval(strafeLoop); strafeLoop = null }
  if (potionLoop) { clearInterval(potionLoop); potionLoop = null }
  bot.setControlState('left', false)
  bot.setControlState('right', false)
  try { bot.pvp.stop() } catch(e) {}
}

// ══════════════════════════════════════
//  PVP 5 — MACHINE DE GUERRE
//  Farm → s'équipe → attaque (counter only)
// ══════════════════════════════════════
function findPvp5Target() {
  const players = Object.values(bot.entities).filter(e =>
    e.type === 'player' &&
    e.username !== bot.username &&
    !WHITELIST_OWNERS.includes(e.username) &&
    (PVP5_TARGETS.length === 0 ? false : PVP5_TARGETS.includes(e.username))
  )
  if (!players.length) return null
  return players.sort((a, b) =>
    bot.entity.position.distanceTo(a.position) -
    bot.entity.position.distanceTo(b.position)
  )[0]
}

async function startFarm() {
  if (farmMode || pvpMode !== 5) return
  farmMode = true
  log('in', '=== FARM MODE PVP 5 ===')

  // Étape 1 : vérifie si déjà équipé
  const hasIronArmor = checkInventoryFor('iron_chestplate')
  const hasWeapon = checkInventoryFor('iron_sword') || checkInventoryFor('diamond_sword')

  if (hasIronArmor && hasWeapon) {
    log('ok', 'Déjà équipé ! Prêt au combat.')
    farmMode = false
    farmPhase = 'ready'
    await wearAvailableGear()
    return
  }

  // Étape 2 : cherche du bois
  farmPhase = 'wood'
  log('in', 'Phase 1: Récolte bois...')
  await mineBlock('oak_log', 8)
  await mineBlock('birch_log', 8)
  await mineBlock('spruce_log', 8)

  // Étape 3 : craft établi
  farmPhase = 'crafting'
  log('in', 'Phase 2: Craft outils de base...')
  await sleep(500)

  // Étape 4 : mine pierre + charbon
  farmPhase = 'stone'
  log('in', 'Phase 3: Mine pierre...')
  await mineBlock('stone', 32)
  await mineBlock('coal_ore', 16)
  await mineBlock('deepslate_coal_ore', 16)

  // Étape 5 : mine fer
  farmPhase = 'iron'
  log('in', 'Phase 4: Mine fer...')
  await mineBlock('iron_ore', 24)
  await mineBlock('deepslate_iron_ore', 24)

  // Étape 6 : équipe ce qu'il a trouvé
  farmPhase = 'equipping'
  log('in', 'Phase 5: Équipement...')
  await wearAvailableGear()

  farmPhase = 'ready'
  farmMode = false
  botStats.farmCycles++
  updateFarmInventory()
  log('ok', 'Farm terminé ! Armure: ' + farmProgress.armor)
  bot.chat('Farm terminé, prêt au combat !')
}

async function mineBlock(blockName, count) {
  if (!farmMode || pvpMode !== 5) return
  let mined = 0
  const mcData = require('minecraft-data')(bot.version)
  const blockId = mcData.blocksByName[blockName]
  if (!blockId) return

  log('in', 'Mine ' + blockName + ' x' + count)
  while (mined < count && farmMode) {
    const block = bot.findBlock({
      matching: blockId.id,
      maxDistance: 32,
    })
    if (!block) { await sleep(2000); break }

    try {
      await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z))
      await bot.dig(block)
      mined++
      // Update stats
      if (blockName.includes('log')) farmProgress.wood = Math.min(64, farmProgress.wood + 1)
      if (blockName.includes('stone')) farmProgress.stone = Math.min(64, farmProgress.stone + 1)
      if (blockName.includes('iron')) farmProgress.iron = Math.min(24, farmProgress.iron + 1)
      if (blockName.includes('coal')) farmProgress.coal = Math.min(16, farmProgress.coal + 1)
    } catch (e) {
      await sleep(500)
    }
  }
}

async function wearAvailableGear() {
  const priority = [
    ['netherite_helmet','head'], ['netherite_chestplate','torso'], ['netherite_leggings','legs'], ['netherite_boots','feet'],
    ['diamond_helmet','head'], ['diamond_chestplate','torso'], ['diamond_leggings','legs'], ['diamond_boots','feet'],
    ['iron_helmet','head'], ['iron_chestplate','torso'], ['iron_leggings','legs'], ['iron_boots','feet'],
    ['chainmail_helmet','head'], ['chainmail_chestplate','torso'], ['chainmail_leggings','legs'], ['chainmail_boots','feet'],
    ['golden_helmet','head'], ['golden_chestplate','torso'], ['golden_leggings','legs'], ['golden_boots','feet'],
    ['leather_helmet','head'], ['leather_chestplate','torso'], ['leather_leggings','legs'], ['leather_boots','feet'],
  ]
  const weapons = ['netherite_axe','netherite_sword','diamond_sword','iron_sword','stone_sword','wooden_sword']

  for (const [name, slot] of priority) {
    const item = bot.inventory.items().find(i => i.name.includes(name))
    if (item) { await bot.equip(item, slot).catch(() => {}); await sleep(100) }
  }
  for (const w of weapons) {
    const item = bot.inventory.items().find(i => i.name.includes(w))
    if (item) { await bot.equip(item, 'hand').catch(() => {}); break }
  }

  // Détermine niveau armure
  if (checkInventoryFor('netherite_chestplate') || bot.inventory.slots[6]?.name?.includes('netherite')) farmProgress.armor = 'Néthérite'
  else if (checkInventoryFor('diamond_chestplate') || bot.inventory.slots[6]?.name?.includes('diamond')) farmProgress.armor = 'Diamant'
  else if (checkInventoryFor('iron_chestplate') || bot.inventory.slots[6]?.name?.includes('iron')) farmProgress.armor = 'Fer'
  else farmProgress.armor = 'Aucune'

  isEquipped = farmProgress.armor !== 'Aucune'
  log('ok', 'Armure portée: ' + farmProgress.armor)
}

function checkInventoryFor(itemName) {
  return bot.inventory.items().some(i => i.name.includes(itemName))
}

function updateFarmInventory() {
  farmProgress.iron = bot.inventory.items().filter(i => i.name.includes('iron_ingot')).reduce((s,i)=>s+i.count,0)
  farmProgress.wood = bot.inventory.items().filter(i => i.name.includes('log')).reduce((s,i)=>s+i.count,0)
  farmProgress.coal = bot.inventory.items().filter(i => i.name.includes('coal')).reduce((s,i)=>s+i.count,0)
}

// ══════════════════════════════════════
//  MODES PVP
// ══════════════════════════════════════
async function setPvpMode(mode, requester) {
  pvpMode = mode
  const names = { 1:'Facile', 2:'Moyen', 3:'Maître', 4:'Pro Elytra', 5:'Machine de Guerre' }
  log('ok', 'PVP ' + mode + ' (' + names[mode] + ') par ' + requester)
  bot.chat('Mode PVP ' + mode + ' activé !')
  stopLoops()
  farmMode = false

  if (mode === 5) {
    log('in', 'PVP 5 — Farm puis combat. Démarrage...')
    await startFarm()
    const target = findNearestPlayer()
    if (target && !WHITELIST_OWNERS.includes(target.username)) {
      if (PVP5_TARGETS.length === 0 || PVP5_TARGETS.includes(target.username)) {
        startAttackLoop(target)
      }
    }
  } else {
    await autoEquip(mode)
    const target = findNearestPlayer()
    if (target) {
      if (mode === 4) attackElytra(target)
      else startAttackLoop(target)
    } else {
      log('warn', 'Aucun joueur proche, en attente...')
    }
  }
}

// ══════════════════════════════════════
//  ELYTRA DIVE (mode 4) — CORRIGÉ
// ══════════════════════════════════════
async function attackElytra(target) {
  log('in', 'PVP 4 — Elytra dive: ' + target.username)
  currentTarget = target
  try {
    // S'approche d'abord au sol
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true)
    await sleep(1500)
    bot.pathfinder.setGoal(null)

    // Monte en hauteur
    const highPos = target.position.offset(0, 22, 0)
    bot.pathfinder.setGoal(new goals.GoalBlock(
      Math.floor(highPos.x), Math.floor(highPos.y), Math.floor(highPos.z)
    ))
    await waitUntilAboveTarget(target, 14)
    bot.pathfinder.setGoal(null)

    const elytra = bot.inventory.items().find(i => i.name === 'elytra')
    if (elytra) await bot.equip(elytra, 'torso').catch(() => {})

    bot.setControlState('jump', true)
    await sleep(200)
    bot.setControlState('jump', false)
    useFirework()

    await bot.lookAt(target.position.offset(0, 1, 0))
    log('in', 'Dive!')

    const axe = bot.inventory.items().find(i => i.name.includes('netherite_axe') || i.name.includes('diamond_axe'))
    if (axe) await bot.equip(axe, 'hand').catch(() => {})

    const check = setInterval(async () => {
      if (!currentTarget || pvpMode !== 4) { clearInterval(check); return }
      const dist = bot.entity.position.distanceTo(currentTarget.position)
      await bot.lookAt(currentTarget.position.offset(0, 1, 0), true)
      if (dist < 3.5) {
        clearInterval(check)
        log('ok', 'ONE SHOT!')
        bot.swingArm()
        setTimeout(() => { if (currentTarget) bot.attack(currentTarget) }, 80)
        setTimeout(() => { if (currentTarget) bot.attack(currentTarget) }, 300)
      }
    }, 100)
  } catch (e) {
    log('err', 'Elytra: ' + e.message + ' → mode 3')
    pvpMode = 3
    startAttackLoop(target)
  }
}

// ══════════════════════════════════════
//  AUTO-ÉQUIPEMENT (modes 1-4)
// ══════════════════════════════════════
async function autoEquip(mode) {
  if (mode === 5 || isEquipping) return
  isEquipping = true
  isEquipped = false
  const gear = GEAR[mode]
  const items = GIVE_ITEMS[mode]
  if (!gear) { isEquipping = false; return }
  log('in', 'Équipement mode ' + mode + '...')
  if (items && items.length > 0) {
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
  }
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
//  SCAN LOOP
// ══════════════════════════════════════
function startScanLoop() {
  setInterval(() => {
    if (pvpMode === 0 || waitingAfterTotem || isEquipping || farmMode) return
    if (!currentTarget || !bot.entities[currentTarget.id]) {
      if (pvpMode === 5) {
        const t = findPvp5Target()
        if (t) { log('in', 'Cible PVP5: ' + t.username); startAttackLoop(t) }
      } else {
        const t = findNearestPlayer()
        if (t) { log('in', 'Cible: ' + t.username); attackTarget(t) }
      }
    }
  }, 2000)
}

function attackTarget(target) {
  if (!target || pvpMode === 0) return
  if (pvpMode === 4) attackElytra(target)
  else startAttackLoop(target)
}

// ══════════════════════════════════════
//  UTILITAIRES
// ══════════════════════════════════════
function findNearestPlayer() {
  const players = Object.values(bot.entities).filter(e =>
    e.type === 'player' && e.username !== bot.username && !WHITELIST_OWNERS.includes(e.username)
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
      if (bot.entity.position.y - target.position.y >= minH) { clearInterval(t); resolve() }
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
  pvpMode = 0; currentTarget = null; isEquipped = false; farmMode = false
  stopLoops()
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  log('warn', 'Bot arrêté')
  bot.chat('Bot arrêté.')
}

function sendStatus() {
  const names = { 0:'OFF', 1:'Facile', 2:'Moyen', 3:'Maître', 4:'Pro Elytra', 5:'Machine de Guerre' }
  const msg = 'PVP: ' + names[pvpMode] +
    ' | HP: ' + Math.round(bot.health) + '/20' +
    ' | Kills: ' + kills +
    ' | Totems: ' + totems +
    ' | Armure: ' + farmProgress.armor +
    ' | Morts: ' + botStats.deaths
  bot.chat(msg); log('in', msg)
}

function startUptimeCounter() {
  setInterval(() => { botStats.uptime++ }, 1000)
}

function setupPathfinder() {
  try {
    const mcData = require('minecraft-data')(bot.version)
    const move = new Movements(bot, mcData)
    move.canDig = true
    move.allowSprinting = true
    move.scaffoldingBlocks = []
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
  else if (l === 'pvp 5') setPvpMode(5, 'console')
  else if (l === 'stop') stopBot()
  else if (l === 'status') sendStatus()
  else if (l === 'equip') autoEquip(pvpMode || 1)
  else if (l === 'farm') startFarm()
  else log('warn', 'Commandes: pvp 1/2/3/4/5 | stop | status | equip | farm')
})

function log(type, msg) {
  const icons = { ok:'✔', warn:'⚠', err:'✘', in:'→' }
  console.log('[' + new Date().toLocaleTimeString('fr-FR') + '] ' + (icons[type]||'•') + ' ' + msg)
}

// Export stats pour dashboard
if (typeof module !== 'undefined') {
  module.exports = { getBotStats: () => ({ ...botStats, pvpMode, farmPhase, farmProgress, hp: bot?.health || 0 }) }
}
