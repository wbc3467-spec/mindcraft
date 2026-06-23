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
            filename = await this.camera.capture();
        } else {
            await bot.lookAt(new Vec3(player.position.x, player.position.y + player.height, player.position.z));
            filename = await this.camera.capture();
        }

        if (bot.interrupt_code) {
            return "Look interrupted.";
        }

        const imagePath = `${this.fp}/${filename}.jpg`;
        const imageBuffer = fs.readFileSync(imagePath);
        const messages = this.agent.history.getHistory();
        const analysis = await this.agent.prompter.promptConvoWithImage(messages, imageBuffer);
        return `Looking at player ${player_name}
Image description: "${analysis}"`;
    }

    async lookAtPosition(x, y, z) {
        if (!this.allow_vision || !this.agent.prompter.chat_model) {
            return "Vision is disabled.";
        }
        const bot = this.agent.bot;
        await bot.lookAt(new Vec3(x, y + 2, z));

        let filename = await this.camera.capture();
        // Check interrupt before vision analysis
        if (bot.interrupt_code) {
            return "Look interrupted.";
        }

        const imagePath = `${this.fp}/${filename}.jpg`;
        const imageBuffer = fs.readFileSync(imagePath);
        const messages = this.agent.history.getHistory();
        const analysis = await this.agent.prompter.promptConvoWithImage(messages, imageBuffer);
        return `Looking at coordinate ${x}, ${y}, ${z}
Image description: "${analysis}"`;
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
            const filename = await this.camera.capture();
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