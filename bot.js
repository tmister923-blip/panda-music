const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Riffy } = require('riffy');
const express = require('express');
require('dotenv').config();

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize Riffy
let riffy;

// Bot configuration
const PREFIX = process.env.BOT_PREFIX || '!';
const PORT = process.env.PORT || 3000;

// Create Express app for Render
const app = express();
app.use(express.json());

// Health check endpoint for Render
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        bot: client.user ? client.user.tag : 'Starting...',
        uptime: process.uptime(),
        guilds: client.guilds ? client.guilds.cache.size : 0
    });
});

// Start web server
app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// Initialize Lavalink connection
function initializeLavalink() {
    const lavalinkConfig = {
        name: process.env.LAVALINK_NAME || "cocaine",
        password: process.env.LAVALINK_PASSWORD || "cocaine",
        host: process.env.LAVALINK_HOST || "pnode1.danbot.host",
        port: parseInt(process.env.LAVALINK_PORT) || 1351,
        secure: process.env.LAVALINK_SECURE === 'true' || false
    };

    console.log('🎵 Initializing Lavalink with config:', lavalinkConfig);
    
    riffy = new Riffy(client, [lavalinkConfig], {
        send: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        }
    });

    // Riffy event handlers
    riffy.on("trackStart", async (player, track) => {
        console.log(`🎵 Now playing: ${track.info.title} by ${track.info.author}`);
        
        // Clear any existing disconnect timeout when a new track starts
        if (player.disconnectTimeout) {
            clearTimeout(player.disconnectTimeout);
            player.disconnectTimeout = null;
            console.log("🎵 Cleared disconnect timeout - music is playing");
        }
    });

    riffy.on("queueEnd", async (player) => {
        console.log("🎵 Queue ended - setting 5 minute timeout before disconnect");
        // Set a timeout to disconnect after 5 minutes of inactivity
        player.disconnectTimeout = setTimeout(() => {
            console.log("🎵 Disconnecting due to inactivity");
            player.destroy();
        }, 300000); // 5 minutes in milliseconds
    });

    riffy.on("trackEnd", async (player, track) => {
        console.log(`🎵 Track ended: ${track.info.title}`);
    });

    riffy.on("playerDestroy", async (player) => {
        console.log(`🎵 Player destroyed for guild: ${player.guildId}`);
    });

    riffy.on("playerMove", async (player, oldChannel, newChannel) => {
        console.log(`🎵 Player moved from ${oldChannel} to ${newChannel}`);
    });

    // Handle voice state updates
    client.on("raw", (d) => {
        if (d.t === "VOICE_STATE_UPDATE" || d.t === "VOICE_SERVER_UPDATE") {
            console.log(`🎵 Voice event received: ${d.t}`);
            riffy.updateVoiceState(d);
        }
    });

    riffy.init(client.user.id);
    console.log('🎵 Lavalink initialized successfully');
    return true;
}

// Handle play command
async function handlePlayCommand(message) {
    const args = message.content.split(' ').slice(1);
    const songQuery = args.join(' ');
    
    if (!songQuery) {
        return message.reply('❌ Please provide a song name or YouTube link!\nExample: `!play lovely` or `!play https://youtube.com/watch?v=...`');
    }

    const user = message.author;
    const guild = message.guild;
    const guildId = guild.id;
    const userId = user.id;

    // Check if user is in a voice channel
    const voiceChannel = guild.members.cache.get(userId)?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('❌ You need to be in a voice channel to use this command!');
    }

    // Check if bot has permission to join and speak
    const botMember = guild.members.cache.get(client.user.id);
    if (!voiceChannel.permissionsFor(botMember).has(['Connect', 'Speak'])) {
        return message.reply('❌ I don\'t have permission to join or speak in that voice channel!');
    }

    const initialResponse = await message.reply(`🔍 Searching for: **${songQuery}**...`);
    
    try {
        console.log(`🎵 Searching for: ${songQuery}`);
        const searchResults = await riffy.resolve({
            query: songQuery,
            requester: { id: userId, username: user.username }
        });
        
        if (!searchResults || !searchResults.tracks || searchResults.tracks.length === 0) {
            await initialResponse.edit('❌ No results found for your search.');
            return;
        }
        
        const track = searchResults.tracks[0];
        console.log(`🎵 Found track: ${track.info.title} by ${track.info.author}`);
        
        let player = riffy.players.get(guildId);
        if (!player) {
            console.log(`🎵 Creating new connection for guild: ${guildId}`);
            player = riffy.createConnection({
                guildId: guildId,
                voiceChannel: voiceChannel.id,
                textChannel: message.channel.id,
                deaf: true
            });
            console.log('🎵 Connection created successfully');
        } else {
            console.log('🎵 Using existing connection for guild:', guildId);
        }

        // Wait for connection to establish
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        if (player.disconnectTimeout) {
            clearTimeout(player.disconnectTimeout);
            player.disconnectTimeout = null;
            console.log('🎵 Cleared disconnect timeout - new track added');
        }
        
        player.queue.add(track);
        
        if (!player.playing && !player.paused) {
            await player.play();
            console.log('🎵 Track playback started successfully');
        } else {
            console.log('🎵 Track added to queue, will play after current track');
        }
        
        await initialResponse.edit(`🎵 **Now Playing:** ${track.info.title}\n👤 **Requested by:** ${user.username}\n🔊 **Channel:** ${voiceChannel.name}`);
        
    } catch (error) {
        console.error('🎵 Error in play command:', error);
        await initialResponse.edit('❌ Failed to play the requested song.');
    }
}

// Handle stop command
async function handleStopCommand(message) {
    const guildId = message.guild.id;
    const player = riffy.players.get(guildId);
    
    if (!player) {
        return message.reply('❌ No music is currently playing!');
    }
    
    player.stop();
    player.destroy();
    message.reply('⏹️ Stopped playback and cleared queue!');
}

// Handle skip command
async function handleSkipCommand(message) {
    const guildId = message.guild.id;
    const player = riffy.players.get(guildId);
    
    if (!player || !player.playing) {
        return message.reply('❌ No music is currently playing!');
    }
    
    if (player.queue.length === 0) {
        return message.reply('❌ No songs in queue to skip to!');
    }
    
    player.skip();
    message.reply('⏭️ Skipped to next track!');
}

// Handle pause command
async function handlePauseCommand(message) {
    const guildId = message.guild.id;
    const player = riffy.players.get(guildId);
    
    if (!player || !player.playing) {
        return message.reply('❌ No music is currently playing!');
    }
    
    if (player.paused) {
        player.pause(false);
        message.reply('▶️ Resumed playback!');
    } else {
        player.pause(true);
        message.reply('⏸️ Paused playback!');
    }
}

// Handle queue command
async function handleQueueCommand(message) {
    const guildId = message.guild.id;
    const player = riffy.players.get(guildId);
    
    if (!player || (!player.playing && player.queue.length === 0)) {
        return message.reply('❌ No music queue found!');
    }
    
    const queue = player.queue;
    const currentTrack = player.currentTrack;
    
    let queueText = '';
    
    if (currentTrack) {
        queueText += `🎵 **Now Playing:** ${currentTrack.info.title}\n`;
    }
    
    if (queue.length > 0) {
        queueText += `\n📋 **Queue (${queue.length} songs):**\n`;
        queue.slice(0, 10).forEach((track, index) => {
            queueText += `${index + 1}. ${track.info.title}\n`;
        });
        
        if (queue.length > 10) {
            queueText += `... and ${queue.length - 10} more songs`;
        }
    }
    
    message.reply(queueText);
}

// Bot ready event
client.once('ready', () => {
    console.log(`🎵 ${client.user.tag} is online!`);
    console.log(`🎵 Bot is in ${client.guilds.cache.size} servers`);
    
    // Initialize Lavalink after bot is ready
    initializeLavalink();
});

// Message event handler
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check if message starts with prefix
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    try {
        switch (command) {
            case 'play':
                await handlePlayCommand(message);
                break;
            case 'stop':
                await handleStopCommand(message);
                break;
            case 'skip':
                await handleSkipCommand(message);
                break;
            case 'pause':
                await handlePauseCommand(message);
                break;
            case 'queue':
                await handleQueueCommand(message);
                break;
            case 'help':
                const helpEmbed = new EmbedBuilder()
                    .setTitle('🎵 Music Bot Commands')
                    .setDescription('Here are all the available commands:')
                    .addFields(
                        { name: `${PREFIX}play [song/url]`, value: 'Play a song or add to queue', inline: false },
                        { name: `${PREFIX}stop`, value: 'Stop playback and clear queue', inline: false },
                        { name: `${PREFIX}skip`, value: 'Skip to next song', inline: false },
                        { name: `${PREFIX}pause`, value: 'Pause/Resume playback', inline: false },
                        { name: `${PREFIX}queue`, value: 'Show current queue', inline: false },
                        { name: `${PREFIX}help`, value: 'Show this help message', inline: false }
                    )
                    .setColor('#00ff00')
                    .setTimestamp();
                
                message.reply({ embeds: [helpEmbed] });
                break;
            default:
                message.reply(`❌ Unknown command! Use \`${PREFIX}help\` to see available commands.`);
        }
    } catch (error) {
        console.error('Command error:', error);
        message.reply('❌ An error occurred while executing the command!');
    }
});

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN not found in environment variables!');
    console.error('Please create a .env file with your bot token.');
    process.exit(1);
}

client.login(token).catch(console.error);
