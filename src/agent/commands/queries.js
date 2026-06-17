import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { getCommandDocs } from './index.js';
import convoManager from '../conversation.js';
import { checkLevelBlueprint, checkBlueprint } from '../tasks/construction_tasks.js';
import { load } from 'cheerio';

const pad = (str) => {
    return '\n' + str + '\n';
}

// queries are commands that just return strings and don't affect anything in the world
export const queryList = [
    {
        name: "!stats",
        description: "Get your bot's location, health, hunger, and time of day.", 
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'STATS';
            let pos = bot.entity.position;
            // display position to 2 decimal places
            res += `\n- Position: x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}`;
            // Convert yaw/pitch from radians to degrees and cardinal direction
            const yawDeg = (bot.entity.yaw * 180 / Math.PI).toFixed(1);
            const pitchDeg = (bot.entity.pitch * 180 / Math.PI).toFixed(1);
            const directions = ['South', 'South West', 'West', 'North West', 'North', 'North East', 'East', 'South East'];
            const dirIdx = Math.round(((bot.entity.yaw % (2*Math.PI)) / (2*Math.PI)) * 8) % 8;
            const direction = dirIdx >= 0 ? directions[dirIdx] : directions[(dirIdx + 8) % 8];
            res += `\n- Facing: ${direction} (Yaw: ${yawDeg}°, Pitch: ${pitchDeg}°)`;
            // Gameplay
            res += `\n- Gamemode: ${bot.game.gameMode}`;
            res += `\n- Health: ${Math.round(bot.health)} / 20`;
            // Show recent damage info (within last 30s)
            if (bot.lastDamageTime && Date.now() - bot.lastDamageTime < 30000) {
                res += `\n- Last hit: -${bot.lastDamageTaken} hp (by ${bot.lastDamageSource || 'unknown'})`;
            }
            res += `\n- Hunger: ${Math.round(bot.food)} / 20`;
            res += `\n- Biome: ${world.getBiomeName(bot)}`;
            let weather = "Clear";
            if (bot.rainState > 0)
                weather = "Rain";
            if (bot.thunderState > 0)
                weather = "Thunderstorm";
            res += `\n- Weather: ${weather}`;
            // let block = bot.blockAt(pos);
            // res += `\n- Artficial light: ${block.skyLight}`;
            // res += `\n- Sky light: ${block.light}`;
            // light properties are bugged, they are not accurate


            if (bot.time.timeOfDay < 6000) {
                res += '\n- Time: Morning';
            } else if (bot.time.timeOfDay < 12000) {
                res += '\n- Time: Afternoon';
            } else {
                res += '\n- Time: Night';
            }

            // get the bot's current action
            let action = agent.actions.currentActionLabel;
            if (agent.isIdle())
                action = 'Idle';
            res += `\- Current Action: ${action}`;


            let players = world.getNearbyPlayerNames(bot);
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));

            res += '\n- Nearby Human Players: ' + (players.length > 0 ? players.join(', ') : 'None.');
            res += '\n- Nearby Bot Players: ' + (bots.length > 0 ? bots.join(', ') : 'None.');

            res += '\n' + agent.bot.modes.getMiniDocs() + '\n';

            // Helper: render a heightmap block
            function renderZone(label, map, range, step, isHeight) {
                res += '\n' + label + ' (Z\u2193/X\u2192):';
                // Build column header
                let colHeader = '      ';
                for (let dx = -range; dx <= range; dx += step) {
                    let xLabel = dx < 0 ? 'x' + dx : (dx === 0 ? ' x0' : 'x+' + dx);
                    colHeader += xLabel.padStart(5);
                }
                res += '\n' + colHeader;
                let zIdx = -range;
                for (let row of map) {
                    let zLabel = zIdx < 0 ? 'z' + zIdx : (zIdx === 0 ? 'z 0' : 'z+' + zIdx);
                    if (isHeight) {
                        let fmtRow = row.map(h => h >= 0 ? '+' + h : '' + h);
                        res += '\n' + zLabel.padEnd(5) + fmtRow.join(' ');
                    } else {
                        res += '\n' + zLabel.padEnd(5) + row.join(' ');
                    }
                    zIdx += step;
                }
            }
            // Helper: render connected ground/ceiling data
            function renderConnected(label, data, range, step, type) {
                res += '\n' + label + ' (Z\u2193/X\u2192):';
                let colHeader = '      ';
                for (let dx = -range; dx <= range; dx += step) {
                    let xLabel = dx < 0 ? 'x' + dx : (dx === 0 ? ' x0' : 'x+' + dx);
                    colHeader += xLabel.padStart(5);
                }
                res += '\n' + colHeader;
                let botY = Math.floor(bot.entity.position.y);
                let zIdx = -range;
                for (let ri = 0; ri < data.length; ri++) {
                    let zLabel = zIdx < 0 ? 'z' + zIdx : (zIdx === 0 ? 'z 0' : 'z+' + zIdx);
                    let vals = [];
                    for (let ci = 0; ci < data[ri].length; ci++) {
                        let val = data[ri][ci];
                        if (type === 'name') {
                            let name = val.name || val;
                            vals.push(name.length > 6 ? name.slice(0, 6) + '.' : name.padEnd(7, ' '));
                        } else if (type === 'height') {
                            let diff = val.y - botY;
                            vals.push(diff >= 0 ? '+' + diff : '' + diff);
                        } else if (type === 'ceiling') {
                            vals.push(val !== null && val !== undefined ? '' + val : '   -');
                        }
                    }
                    res += '\n' + zLabel.padEnd(5) + vals.join(' ');
                    zIdx += step;
                }
            }

            // Biome grid (9x9, step=16, covers ±64)
            let biomeRange = 64, biomeStep = 16;
            let biomeGrid = world.getBiomeGrid(bot, biomeRange, biomeStep);
            res += '
Biome (Z↓/X→):';
            let bColHdr = '      ';
            for (let dx = -biomeRange; dx <= biomeRange; dx += biomeStep) {
                bColHdr += String(dx).padStart(5, ' ');
            }
            res += bColHdr;
            let bz = -biomeRange;
            for (const row of biomeGrid) {
                let rowLabel = String(bz).padStart(4, ' ') + ' ';
                res += '
' + rowLabel;
                for (const name of row) {
                    let short = name.length > 5 ? name.slice(0, 5) + '.' : name.padEnd(6, ' ');
                    res += short;
                }
                bz += biomeStep;
            }
            return pad(res);
        }
    },
    {
        name: "!inventory",
        description: "Get your bot's inventory.",
        perform: function (agent) {
            let bot = agent.bot;
            let inventory = world.getInventoryCounts(bot);
            let res = 'INVENTORY';
            for (const item in inventory) {
                if (inventory[item] && inventory[item] > 0)
                    res += `\n- ${item}: ${inventory[item]}`;
            }
            if (res === 'INVENTORY') {
                res += ': Nothing';
            }
            else if (agent.bot.game.gameMode === 'creative') {
                res += '\n(You have infinite items in creative mode. You do not need to gather resources!!)';
            }

            let helmet = bot.inventory.slots[5];
            let chestplate = bot.inventory.slots[6];
            let leggings = bot.inventory.slots[7];
            let boots = bot.inventory.slots[8];
            res += '\nWEARING: ';
            if (helmet)
                res += `\nHead: ${helmet.name}`;
            if (chestplate)
                res += `\nTorso: ${chestplate.name}`;
            if (leggings)
                res += `\nLegs: ${leggings.name}`;
            if (boots)
                res += `\nFeet: ${boots.name}`;
            if (!helmet && !chestplate && !leggings && !boots)
                res += 'Nothing';

            return pad(res);
        }
    },
    {
        name: "!nearbyBlocks",
        description: "Get the blocks near the bot.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_BLOCKS';
            let blocks = world.getNearestBlocks(bot);
            let block_details = new Set();
            
            for (let block of blocks) {
                let details = block.name;
                if (block.name === 'water' || block.name === 'lava') {
                    details += block.metadata === 0 ? ' (source)' : ' (flowing)';
                }
                block_details.add(details);
            }
            for (let details of block_details) {
                res += `\n- ${details}`;
            }
            if (block_details.size === 0) {
                res += ': none';
            } 
            else {
                res += '\n- ' + world.getSurroundingBlocks(bot).join('\n- ');
                res += `\n- First Solid Block Above Head: ${world.getFirstBlockAboveHead(bot, null, 32)}`;
            }
            return pad(res);
        }
    },
    {
        name: "!craftable",
        description: "Get the craftable items with the bot's inventory.",
        perform: function (agent) {
            let craftable = world.getCraftableItems(agent.bot);
            let res = 'CRAFTABLE_ITEMS';
            for (const item of craftable) {
                res += `\n- ${item}`;
            }
            if (res == 'CRAFTABLE_ITEMS') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!entities",
        description: "Get the nearby players and entities.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_ENTITIES';
            let players = world.getNearbyPlayerNames(bot);
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));

            for (const player of players) {
                res += `\n- Human player: ${player}`;
            }
            for (const bot of bots) {
                res += `\n- Bot player: ${bot}`;
            }

            let nearbyEntities = world.getNearbyEntities(bot);
            let entityCounts = {};
            let villagerIds = [];
            let babyVillagerIds = [];
            let villagerDetails = []; // Store detailed villager info including profession
            
            for (const entity of nearbyEntities) {
                if (entity.type === 'player' || entity.name === 'item')
                    continue;
                    
                if (!entityCounts[entity.name]) {
                    entityCounts[entity.name] = 0;
                }
                entityCounts[entity.name]++;
                
                if (entity.name === 'villager') {
                    if (entity.metadata && entity.metadata[16] === 1) {
                        babyVillagerIds.push(entity.id);
                    } else {
                        const profession = world.getVillagerProfession(entity);
                        villagerIds.push(entity.id);
                        villagerDetails.push({
                            id: entity.id,
                            profession: profession
                        });
                    }
                }
            }
            
            for (const [entityType, count] of Object.entries(entityCounts)) {
                if (entityType === 'villager') {
                    let villagerInfo = `${count} ${entityType}(s)`;
                    if (villagerDetails.length > 0) {
                        const detailStrings = villagerDetails.map(v => `(${v.id}:${v.profession})`);
                        villagerInfo += ` - Adults: ${detailStrings.join(', ')}`;
                    }
                    if (babyVillagerIds.length > 0) {
                        villagerInfo += ` - Baby IDs: ${babyVillagerIds.join(', ')} (babies cannot trade)`;
                    }
                    res += `\n- entities: ${villagerInfo}`;
                } else {
                    res += `\n- entities: ${count} ${entityType}(s)`;
                }
            }
            
            if (res == 'NEARBY_ENTITIES') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!modes",
        description: "Get all available modes and their docs and see which are on/off.",
        perform: function (agent) {
            return agent.bot.modes.getDocs();
        }
    },
    {
        name: '!savedPlaces',
        description: 'List all saved locations.',
        perform: async function (agent) {
            return "Saved place names: " + agent.memory_bank.getKeys();
        }
    }, 
    {
        name: '!checkBlueprintLevel',
        description: 'Check if the level is complete and what blocks still need to be placed for the blueprint',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = checkLevelBlueprint(agent, levelNum);
            console.log(res);
            return pad(res);
        }
    }, 
    {
        name: '!checkBlueprint',
        description: 'Check what blocks still need to be placed for the blueprint',
        perform: function (agent) {
            let res = checkBlueprint(agent);
            return pad(res);
        }
    }, 
    {
        name: '!getBlueprint',
        description: 'Get the blueprint for the building',
        perform: function (agent) {
            let res = agent.task.blueprint.explain();
            return pad(res);
        }
    }, 
    {
        name: '!getBlueprintLevel',
        description: 'Get the blueprint for the building',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = agent.task.blueprint.explainLevel(levelNum);
            console.log(res);
            return pad(res);
        }
    },
    {
        name: '!getCraftingPlan',
        description: "Provides a comprehensive crafting plan for a specified item. This includes a breakdown of required ingredients, the exact quantities needed, and an analysis of missing ingredients or extra items needed based on the bot's current inventory.",
        params: {
            targetItem: { 
                type: 'string', 
                description: 'The item that we are trying to craft' 
            },
            quantity: { 
                type: 'int',
                description: 'The quantity of the item that we are trying to craft',
                optional: true,
                domain: [1, Infinity, '[)'], // Quantity must be at least 1,
                default: 1
            }
        },
        perform: function (agent, targetItem, quantity = 1) {
            let bot = agent.bot;

            // Fetch the bot's inventory
            const curr_inventory = world.getInventoryCounts(bot); 
            const target_item = targetItem;
            let existingCount = curr_inventory[target_item] || 0;
            let prefixMessage = '';
            if (existingCount > 0) {
                curr_inventory[target_item] -= existingCount;
                prefixMessage = `You already have ${existingCount} ${target_item} in your inventory. If you need to craft more,\n`;
            }

            // Generate crafting plan
            try {
                let craftingPlan = mc.getDetailedCraftingPlan(target_item, quantity, curr_inventory);
                craftingPlan = prefixMessage + craftingPlan;
                return pad(craftingPlan);
            } catch (error) {
                console.error("Error generating crafting plan:", error);
                return `An error occurred while generating the crafting plan: ${error.message}`;
            }
            
            
        },
    },
    {
        name: '!searchWiki',
        description: 'Search the Minecraft Wiki for the given query.',
        params: {
            'query': { type: 'string', description: 'The query to search for.' }
        },
        perform: async function (agent, query) {
            const url = `https://minecraft.wiki/w/${query}`
            try {
                const response = await fetch(url);
                if (response.status === 404) {
                  return `${query} was not found on the Minecraft Wiki. Try adjusting your search term.`;
                }
                const html = await response.text();
                const $ = load(html);
            
                const parserOutput = $("div.mw-parser-output");
                
                parserOutput.find("table.navbox").remove();

                const divContent = parserOutput.text();
            
                return divContent.trim();
              } catch (error) {
                console.error("Error fetching or parsing HTML:", error);
                return `The following error occurred: ${error}`
              }
        }
    },
    {
        name: '!help',
        description: 'Lists all available commands and their descriptions.',
        perform: async function (agent) {
            return getCommandDocs(agent);
        }
    },
    {
        name: '!biomes',
        description: 'Get a 2D grid of biome names around the bot (nxn, custom range & step).',
        perform: function (agent, range, step) {
            range = range || 4;
            step = step || 1;
            let bot = agent.bot;
            let grid = world.getBiomeGrid(bot, range, step);
            let res = 'BIOME_GRID';
            let size = grid.length;
            let half = Math.floor(size / 2);
            // Find max biome name length for alignment
            let maxLen = 0;
            for (let row of grid) {
                for (let name of row) {
                    if (name.length > maxLen) maxLen = name.length;
                }
            }
            let colWidth = maxLen + 1;
            // Column header
            let colHeader = 'Z\\X '.padEnd(6, ' ');
            for (let dx = -range; dx <= range; dx += step) {
                colHeader += String(dx).padStart(colWidth, ' ');
            }
            res += '
' + colHeader;
            // Rows
            for (let ri = 0; ri < grid.length; ri++) {
                let dz = (ri - half) * step;
                let rowLabel = String(dz).padStart(4, ' ') + '  ';
                res += '
' + rowLabel;
                for (let ci = 0; ci < grid[ri].length; ci++) {
                    res += grid[ri][ci].padEnd(colWidth, ' ');
                }
            }
            return pad(res);
        }
    },
    {
        name: '!terrain',
        description: 'Get a 2D grid of ground block names in the connected space (nxn, custom range & step).',
        params: {
            range: { type: 'int', description: 'Half-width of scan area, default 4 (9x9).', optional: true, default: 4 },
            step: { type: 'int', description: 'Sampling step, default 1.', optional: true, default: 1 }
        },
        perform: function (agent, range=4, step=1) {
            let bot = agent.bot;
            let ground = world.getConnectedGround(bot, range, step);
            let res = 'Ground (Z↓/X→):';
            let colHeader = '      ';
            for (let dx = -range; dx <= range; dx += step) {
                let xLabel = dx < 0 ? 'x' + dx : (dx === 0 ? ' x0' : 'x+' + dx);
                colHeader += xLabel.padStart(5);
            }
            res += '\n' + colHeader;
            let zIdx = -range;
            for (let row of ground) {
                let zLabel = zIdx < 0 ? 'z' + zIdx : (zIdx === 0 ? 'z 0' : 'z+' + zIdx);
                let vals = row.map(g => {
                    let name = g.name || 'void';
                    return name.length > 6 ? name.slice(0, 6) + '.' : name.padEnd(7, ' ');
                });
                res += '\n' + zLabel.padEnd(5) + vals.join(' ');
                zIdx += step;
            }
            return pad(res);
        }
    },
    {
        name: '!height',
        description: 'Get 2D grids of height difference (relative to bot) and ceiling Y in the connected space.',
        params: {
            range: { type: 'int', description: 'Half-width of scan area, default 4 (9x9).', optional: true, default: 4 },
            step: { type: 'int', description: 'Sampling step, default 1.', optional: true, default: 1 }
        },
        perform: function (agent, range=4, step=1) {
            let bot = agent.bot;
            let botY = Math.floor(bot.entity.position.y);
            let ground = world.getConnectedGround(bot, range, step);
            let ceil = world.getConnectedCeiling(bot, range, step, ground);
            let res = 'HeightDiff (Z↓/X→):';
            let colHeader = '      ';
            for (let dx = -range; dx <= range; dx += step) {
                let xLabel = dx < 0 ? 'x' + dx : (dx === 0 ? ' x0' : 'x+' + dx);
                colHeader += xLabel.padStart(5);
            }
            res += '\n' + colHeader;
            let zIdx = -range;
            for (let row of ground) {
                let zLabel = zIdx < 0 ? 'z' + zIdx : (zIdx === 0 ? 'z 0' : 'z+' + zIdx);
                let vals = row.map(g => {
                    let diff = g.y - botY;
                    return diff >= 0 ? '+' + diff : '' + diff;
                });
                res += '\n' + zLabel.padEnd(5) + vals.join(' ');
                zIdx += step;
            }
            res += '\nCeilingY (Z↓/X→):';
            let colHeader2 = '      ';
            for (let dx = -range; dx <= range; dx += step) {
                let xLabel = dx < 0 ? 'x' + dx : (dx === 0 ? ' x0' : 'x+' + dx);
                colHeader2 += xLabel.padStart(5);
            }
            res += '\n' + colHeader2;
            zIdx = -range;
            for (let row of ceil) {
                let zLabel = zIdx < 0 ? 'z' + zIdx : (zIdx === 0 ? 'z 0' : 'z+' + zIdx);
                let vals = row.map(y => y !== null && y !== undefined ? '' + y : '   -');
                res += '\n' + zLabel.padEnd(5) + vals.join(' ');
                zIdx += step;
            }
            return pad(res);
        }
    },
];
