import { Vec3 } from 'vec3';
import { Camera } from "./camera.js";
import fs from 'fs';

export class VisionInterpreter {
    constructor(agent, allow_vision) {
        this.agent = agent;
        this.allow_vision = allow_vision;
        this.fp = './bots/'+agent.name+'/screenshots/';
        if (allow_vision) {
            this.camera = new Camera(agent.bot, this.fp);
        }
    }

    // Wait for camera to be ready (async init may not have completed)
    async _waitCameraReady() {
        if (!this.camera) return false;
        if (this.camera.ready) return true;
        return new Promise((resolve) => {
            const onReady = () => {
                this.camera.ready = true;
                resolve(true);
            };
            if (this.camera.ready) {
                resolve(true);
                return;
            }
            this.camera.once('ready', onReady);
            // 5 second timeout
            setTimeout(() => {
                this.camera.removeListener('ready', onReady);
                console.warn('[Vision] Camera ready timeout');
                resolve(false);
            }, 5000);
        });
    }

    async lookAtPlayer(player_name, direction) {
        if (!this.allow_vision || !this.agent.prompter.chat_model) {
            return "Vision is disabled.";
        }
        const bot = this.agent.bot;
        const player = bot.players[player_name]?.entity;
        if (!player) {
            return `Could not find player ${player_name}`;
        }

        let filename;
        if (direction === 'with') {
            await bot.look(player.yaw, player.pitch);
            filename = await this._waitCameraReady().then(r => r ? this.camera.capture() : null);
        } else {
            await bot.lookAt(new Vec3(player.position.x, player.position.y + player.height, player.position.z));
            filename = await this._waitCameraReady().then(r => r ? this.camera.capture() : null);
        }

        if (!filename) {
            return `Looked at player ${player_name} but failed to capture screenshot.`;
        }

        if (bot.interrupt_code) {
            return "Look interrupted.";
        }

        const imagePath = `${this.fp}/${filename}.jpg`;
        const imageBuffer = fs.readFileSync(imagePath);
        const messages = this.agent.history.getHistory();
        const analysis = await this.agent.prompter.promptConvoWithImage(messages, imageBuffer);
        return `You are looking at player ${player_name}.
Description: "${analysis}"`;
    }

    async lookAtPosition(x, y, z) {
        if (!this.allow_vision || !this.agent.prompter.chat_model) {
            return "Vision is disabled.";
        }
        const bot = this.agent.bot;
        await bot.lookAt(new Vec3(x, y + 2, z));

        let filename = await this._waitCameraReady().then(r => r ? this.camera.capture() : null);
        if (!filename) {
            return `Looked at coordinate ${x}, ${y}, ${z} but failed to capture screenshot.`;
        }
        // Check interrupt before vision analysis
        if (bot.interrupt_code) {
            return "Look interrupted.";
        }

        const imagePath = `${this.fp}/${filename}.jpg`;
        const imageBuffer = fs.readFileSync(imagePath);
        const messages = this.agent.history.getHistory();
        const analysis = await this.agent.prompter.promptConvoWithImage(messages, imageBuffer);
        return `You are looking at coordinate ${x}, ${y}, ${z}.
Description: "${analysis}"`;
    }

    getCenterBlockInfo() {
        const bot = this.agent.bot;
        const maxDistance = 128; // Maximum distance to check for blocks
        const targetBlock = bot.blockAtCursor(maxDistance);
        
        if (targetBlock) {
            return `Block at center view: ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z})`;
        } else {
            return "No block in center view";
        }
    }

    // Auto-capture current view (for self-prompt vision)
    async captureCurrentView() {
        if (!this.allow_vision || !this.camera || !this.agent.prompter.chat_model) {
            return null;
        }
        try {
            const filename = await this._waitCameraReady().then(r => r ? this.camera.capture() : null);
            if (!filename) return null;
            const imagePath = `${this.fp}/${filename}.jpg`;
            const imageBuffer = fs.readFileSync(imagePath);
            const messages = this.agent.history.getHistory();
            const analysis = await this.agent.prompter.promptConvoWithImage(messages, imageBuffer);
            return `[Auto Vision] ${analysis}`;
        } catch (e) {
            console.warn('[Vision] Auto capture failed:', e.message);
            return null;
        }
    }

    async analyzeImage(filename) {
        // Check interrupt before starting vision analysis
        if (this.agent.bot.interrupt_code) {
            return 'Image analysis interrupted.';
        }
        try {
            const imageBuffer = fs.readFileSync(`${this.fp}/${filename}.jpg`);
            const messages = this.agent.history.getHistory();

            const blockInfo = this.getCenterBlockInfo();
            const result = await this.agent.prompter.promptVision(messages, imageBuffer);
            return result + `\n${blockInfo}`;

        } catch (error) {
            console.warn('Error reading image:', error);
            return `Error reading image: ${error.message}`;
        }
    }
} 