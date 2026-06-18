const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';

function getGoalFp(agent) {
    return `./bots/${agent.name}/goal.json`;
}

function saveGoalToFile(agent, prompt, state) {
    try {
        const data = { prompt: prompt || '', state: state };
        writeFileSync(getGoalFp(agent), JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to save goal:', err.message || err);
    }
}

function loadGoalFromFile(agent) {
    try {
        const fp = getGoalFp(agent);
        if (!existsSync(fp)) return null;
        return JSON.parse(readFileSync(fp, 'utf8'));
    } catch (err) {
        console.error('Failed to load goal:', err.message || err);
        return null;
    }
}

export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;

        // Auto-load goal from file on construction (don't startLoop yet, handleLoad handles that)
        const saved = loadGoalFromFile(agent);
        if (saved && saved.prompt) {
            this.prompt = saved.prompt;
            this.state = saved.state !== undefined ? saved.state : STOPPED;
            console.log(`[SelfPrompter] Loaded goal from goal.json: "${this.prompt}" (state: ${this.state})`);
            // If state is ACTIVE, start immediately instead of waiting for update() idle recovery
            if (this.state === ACTIVE) {
                setTimeout(() => this.start(this.prompt), 0);
            }
        }
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        saveGoalToFile(this.agent, this.prompt, this.state);
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        // Prefer goal.json over memory.json to avoid stale data after crash
        const saved = loadGoalFromFile(this.agent);
        if (saved && saved.prompt) {
            this.prompt = saved.prompt;
            this.state = saved.state !== undefined ? saved.state : STOPPED;
            console.log(`[SelfPrompter] handleLoad: using goal.json -> \"${this.prompt}\" (state: ${this.state})`);
        } else {
            if (state == undefined) state = STOPPED;
            this.state = state;
            if (prompt) this.prompt = prompt;
        }
        if (this.state !== STOPPED && !this.prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (this.state === ACTIVE) {
            await this.start(this.prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
        saveGoalToFile(this.agent, this.prompt, this.state);
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 30; // increased from 3 to avoid loop stopping on occasional missing commands
        while (!this.interrupt) {
            const msg = `You are self-prompting with the goal: '${this.prompt}'. You can use commands (!commandName) to act, or just think/observe.`
            
            let used_command;
            try {
                used_command = await this.agent.handleMessage('system', msg, -1);
            } catch (err) {
                console.error('Self-prompt loop caught error, continuing:', err.message || err);
                await new Promise(r => setTimeout(r, this.cooldown));
                continue;
            }
            // DROPPED: 被互斥锁丢弃，不计数
            if (used_command === 'DROPPED') {
                if (this.interrupt) break;
                await new Promise(r => setTimeout(r, this.cooldown));
                if (this.interrupt) break;
                continue;
            }
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
    }

    update(delta) {
        // automatically restarts loop (ACTIVE state)
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        // Auto-recover from STOPPED state if there's an active goal
        else if (this.state === STOPPED && this.prompt && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle()) {
                this.idle_time += delta;
                if (this.idle_time >= this.cooldown * 2) {
                    console.log('Auto-recovering self-prompt from STOPPED...');
                    this.state = ACTIVE;
                    this.idle_time = 0;
                }
            } else {
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
        saveGoalToFile(this.agent, this.prompt, this.state);
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
        saveGoalToFile(this.agent, this.prompt, this.state);
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}