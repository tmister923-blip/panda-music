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
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectInterval = 5000; // Start with 5 seconds
let maxReconnectInterval = 60000; // Max 1 minute
let reconnectTimeout;

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

// Handle node errors with reconnection logic
function handleNodeError(node, error) {
    console.log(`🎵 Node ${node.name} error: ${error.message}`);
    
    // Check if we have any connected nodes
    const connectedNodes = Array.from(riffy.nodes.values()).filter(n => n.connected);
    
    if (connectedNodes.length === 0) {
        console.log('🎵 No connected nodes, attempting reconnection...');
        scheduleReconnection();
    }
}

// Handle node disconnection
function handleNodeDisconnect(node) {
    console.log(`🎵 Node ${node.name} disconnected`);
    
    // Check if we have any connected nodes
    const connectedNodes = Array.from(riffy.nodes.values()).filter(n => n.connected);
    
    if (connectedNodes.length === 0) {
        console.log('🎵 No connected nodes, attempting reconnection...');
        scheduleReconnection();
    }
}

// Handle successful reconnection
function handleNodeReconnect(node) {
    console.log(`🎵 Node ${node.name} reconnected successfully`);
    reconnectAttempts = 0; // Reset attempts on successful connection
    reconnectInterval = 5000; // Reset interval
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

// Schedule reconnection with exponential backoff
function scheduleReconnection() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        console.log('🎵 Max reconnection attempts reached, will continue trying every minute...');
        reconnectAttempts = 0; // Reset but keep trying
        reconnectInterval = 60000; // Try every minute
    }
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    console.log(`🎵 Scheduling reconnection attempt ${reconnectAttempts + 1}/${maxReconnectAttempts} in ${reconnectInterval/1000} seconds...`);
    
    reconnectTimeout = setTimeout(() => {
        reconnectAttempts++;
        console.log(`🎵 Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts}...`);
        
        // Try to reconnect all nodes
        if (riffy && riffy.nodes) {
            riffy.nodes.forEach(node => {
                if (!node.connected) {
                    console.log(`🎵 Attempting to reconnect node: ${node.name}`);
                    try {
                        node.connect();
                    } catch (error) {
                        console.error(`🎵 Failed to reconnect node ${node.name}:`, error);
                    }
                }
            });
        }
        
        // Increase interval for next attempt (exponential backoff)
        reconnectInterval = Math.min(reconnectInterval * 1.5, maxReconnectInterval);
        
        // Schedule next attempt if no nodes are connected
        setTimeout(() => {
            const connectedNodes = riffy ? Array.from(riffy.nodes.values()).filter(n => n.connected) : [];
            if (connectedNodes.length === 0) {
                console.log('🎵 Still no connected nodes, scheduling next attempt...');
                scheduleReconnection();
            }
        }, 10000); // Check after 10 seconds
        
    }, reconnectInterval);
}

// Initialize Lavalink connection
function initializeLavalink() {
    // Your original Lavalink server configuration
    const lavalinkConfig = {
        name: process.env.LAVALINK_NAME || "cocaine",
        password: process.env.LAVALINK_PASSWORD || "cocaine",
        host: process.env.LAVALINK_HOST || "pnode1.danbot.host",
        port: parseInt(process.env.LAVALINK_PORT) || 1351,
        secure: process.env.LAVALINK_SECURE === 'true' || false
    };

    console.log('🎵 Initializing Lavalink with config:', lavalinkConfig);
    
    try {
        riffy = new Riffy(client, [lavalinkConfig], {
            send: (payload) => {
                const guild = client.guilds.cache.get(payload.d.guild_id);
                if (guild) guild.shard.send(payload);
            },
            defaultSearchPlatform: "ytmsearch",
            restVersion: "v4",
        });

        // Wait for Lavalink to be ready
        riffy.on('nodeConnect', (node) => {
            console.log(`🎵 Lavalink node connected: ${node.name}`);
            console.log(`🎵 Node connected status: ${node.connected}`);
        });

        riffy.on('nodeError', (node, error) => {
            console.error(`🎵 Lavalink node error:`, error);
            handleNodeError(node, error);
        });

        riffy.on('nodeDisconnect', (node) => {
            console.log(`🎵 Lavalink node disconnected: ${node.name}`);
            handleNodeDisconnect(node);
        });

        // Add retry mechanism
        riffy.on('nodeReconnect', (node) => {
            console.log(`🎵 Lavalink node reconnected: ${node.name}`);
            handleNodeReconnect(node);
        });
    } catch (error) {
        console.error('🎵 Failed to initialize Lavalink:', error);
        return false;
    }

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

    // Initialize with retry mechanism
    const initLavalink = () => {
        try {
            riffy.init(client.user.id);
            console.log('🎵 Lavalink initialization started');
            return true;
        } catch (error) {
            console.error('🎵 Failed to start Lavalink initialization:', error);
            return false;
        }
    };

    // Try to initialize
    if (initLavalink()) {
        console.log('🎵 Lavalink initialization successful');
        
        // Set up periodic health check
        setInterval(() => {
            if (riffy && riffy.nodes) {
                const connectedNodes = Array.from(riffy.nodes.values()).filter(n => n.connected);
                if (connectedNodes.length === 0) {
                    console.log('🎵 Health check: No connected nodes, attempting reconnection...');
                    scheduleReconnection();
                } else {
                    console.log(`🎵 Health check: ${connectedNodes.length} nodes connected`);
                }
            }
        }, 30000); // Check every 30 seconds
        
        return true;
    } else {
        console.log('🎵 Lavalink initialization failed, will retry...');
        scheduleReconnection();
        return false;
    }
}

// Handle play command - using exact same mechanism as server.js
async function handlePlayCommand(message) {
    try {
        const user = message.author;
        const guild = message.guild;
        const guildId = guild.id;
        const userId = user.id;
        
        // Extract song query from message content
        const content = message.content;
        const trigger = content.split(' ')[0];
        const songQuery = content.substring(trigger.length).trim();
        
        if (!songQuery) {
            await message.reply('❌ Please provide a song name or YouTube link!');
            return;
        }
        
        console.log(`🎵 Play command: "${songQuery}" by ${user.tag} in ${guild.name}`);
        
        // Check if user is in a voice channel
        const member = guild.members.cache.get(userId);
        if (!member || !member.voice.channel) {
            await message.reply('❌ You need to be in a voice channel to use this command!');
            return;
        }
        
        const voiceChannel = member.voice.channel;
        
        // Check if Lavalink is initialized and connected
        if (!riffy) {
            await message.reply('❌ Music system is not initialized. Please contact an administrator.');
            return;
        }

        // Check if any nodes are connected
        if (!riffy.nodes || riffy.nodes.size === 0) {
            await message.reply('❌ Music service is not connected. Please try again in a moment.');
            return;
        }

        // Check if any node is actually connected
        const connectedNodes = Array.from(riffy.nodes.values()).filter(node => node.connected);
        console.log(`🎵 Total nodes: ${riffy.nodes.size}, Connected nodes: ${connectedNodes.length}`);
        
        // Log all nodes for debugging
        riffy.nodes.forEach((node, name) => {
            console.log(`🎵 Node ${name}: connected=${node.connected}, host=${node.host}:${node.port}`);
        });
        
        if (connectedNodes.length === 0) {
            console.log('🎵 No connected nodes found, attempting reconnection...');
            scheduleReconnection();
            await message.reply('❌ Music service is temporarily unavailable. Attempting to reconnect... Please try again in a moment.');
            return;
        }

        console.log(`🎵 Found ${connectedNodes.length} connected nodes`);
        
        // Check if bot has permission to join the voice channel
        const botMember = guild.members.cache.get(client.user.id);
        if (!botMember) {
            await message.reply('❌ Bot is not in this server.');
            return;
        }
        
        const permissions = voiceChannel.permissionsFor(botMember);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            await message.reply('❌ Bot does not have permission to join or speak in this voice channel.');
            return;
        }
        
        // Send initial response
        const initialResponse = await message.reply(`🔍 Searching for: **${songQuery}**...`);
        
        try {
            // Search for the track using Lavalink (same as music player tab)
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
            
            // Use the exact same logic as the /api/music/play endpoint
            console.log(`🎵 Attempting to play track: ${track.info.title}`);
            console.log(`🎵 User ${userId} in voice channel: ${voiceChannel.name} (${voiceChannel.id})`);
            
            // Get or create player using the correct Riffy method
            let player = riffy.players.get(guildId);
            if (!player) {
                console.log('🎵 Creating new connection for guild:', guildId);
                console.log('🎵 Voice channel ID:', voiceChannel.id);
                
                try {
                    player = riffy.createConnection({
                        guildId: guildId,
                        voiceChannel: voiceChannel.id,
                        textChannel: message.channel.id,
                        deaf: true
                    });
                    console.log('🎵 Connection created successfully');
                } catch (error) {
                    console.error('🎵 Error creating connection:', error);
                    await initialResponse.edit('❌ Failed to connect to voice channel.');
                    return;
                }
            } else {
                console.log('🎵 Using existing connection for guild:', guildId);
            }

            // The createConnection method should handle the voice connection automatically
            console.log('🎵 Connection should be established automatically by createConnection');
            console.log('🎵 Player state before wait:', {
                connected: player.connected,
                voiceChannelId: player.voiceChannelId,
                playing: player.playing,
                paused: player.paused
            });
            
            // Wait a moment for the connection to establish
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('🎵 Connection established, proceeding with playback');
            console.log('🎵 Player state after wait:', {
                connected: player.connected,
                voiceChannelId: player.voiceChannelId,
                playing: player.playing,
                paused: player.paused
            });
            
            try {
                console.log('🎵 Using full track object from search...');
                console.log('🎵 Track title:', track.info.title);
                console.log('🎵 Track author:', track.info.author);
                
                console.log('🎵 Adding track to queue...');
                
                // Clear any existing disconnect timeout when adding a new track
                if (player.disconnectTimeout) {
                    clearTimeout(player.disconnectTimeout);
                    player.disconnectTimeout = null;
                    console.log('🎵 Cleared disconnect timeout - new track added');
                }
                
                // Add the complete track object to queue
                player.queue.add(track);
                
                // Play if not already playing
                if (!player.playing && !player.paused) {
                    await player.play();
                    console.log('🎵 Track playback started successfully');
                } else {
                    console.log('🎵 Track added to queue, will play after current track');
                }
                
                await initialResponse.edit(`🎵 **Now Playing:** ${track.info.title}\n👤 **Requested by:** ${user.username}\n🔊 **Channel:** ${voiceChannel.name}`);
                
            } catch (playError) {
                console.error('🎵 Failed to play track:', playError);
                await initialResponse.edit('❌ Failed to play the requested song.');
            }
            
        } catch (error) {
            console.error('🎵 Error in play command:', error);
            await initialResponse.edit('❌ Failed to play the requested song.');
        }
        
    } catch (error) {
        console.error('Error handling play command:', error);
        await message.reply('❌ An error occurred while trying to play music.');
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

// Handle status command
async function handleStatusCommand(message) {
    const guildId = message.guild.id;
    const player = riffy ? riffy.players.get(guildId) : null;
    
    let statusText = '🤖 **Bot Status:** Online\n';
    statusText += `🎵 **Music Service:** ${riffy ? 'Initialized' : 'Not initialized'}\n`;
    
    if (riffy && riffy.nodes) {
        const connectedNodes = Array.from(riffy.nodes.values()).filter(n => n.connected);
        statusText += `🔗 **Lavalink Nodes:** ${connectedNodes.length}/${riffy.nodes.size} connected\n`;
        
        if (connectedNodes.length > 0) {
            statusText += `✅ **Music Ready:** Yes\n`;
        } else {
            statusText += `❌ **Music Ready:** No (attempting reconnection...)\n`;
        }
        
        // Show node details
        statusText += '\n**Node Status:**\n';
        riffy.nodes.forEach((node, name) => {
            const status = node.connected ? '🟢 Connected' : '🔴 Disconnected';
            statusText += `• ${name}: ${status} (${node.host}:${node.port})\n`;
        });
    } else {
        statusText += '❌ **Music Ready:** No (Lavalink not initialized)\n';
    }
    
    if (player) {
        statusText += `\n🎵 **Current Player:** ${player.playing ? 'Playing' : 'Stopped'}\n`;
        if (player.currentTrack) {
            statusText += `🎶 **Now Playing:** ${player.currentTrack.info.title}\n`;
        }
    } else {
        statusText += '\n🎵 **Current Player:** None\n';
    }
    
    statusText += `\n🔄 **Reconnection Attempts:** ${reconnectAttempts}/${maxReconnectAttempts}`;
    
    const statusEmbed = new EmbedBuilder()
        .setTitle('🎵 Bot Status')
        .setDescription(statusText)
        .setColor(riffy && riffy.nodes && Array.from(riffy.nodes.values()).some(n => n.connected) ? '#00ff00' : '#ff0000')
        .setTimestamp();
    
    message.reply({ embeds: [statusEmbed] });
}

// Bot ready event
client.once('ready', async () => {
    console.log(`🎵 ${client.user.tag} is online!`);
    console.log(`🎵 Bot is in ${client.guilds.cache.size} servers`);
    
    // Initialize Lavalink after bot is ready
    const lavalinkInitialized = initializeLavalink();
    
    // Wait a bit for Lavalink to connect
    setTimeout(() => {
        if (riffy && riffy.nodes && riffy.nodes.size > 0) {
            const connectedNodes = Array.from(riffy.nodes.values()).filter(n => n.connected);
            if (connectedNodes.length > 0) {
                console.log('🎵 Lavalink is ready for music commands!');
            } else {
                console.log('🎵 Lavalink nodes initialized but not connected, attempting reconnection...');
                scheduleReconnection();
            }
        } else {
            console.log('🎵 Lavalink connection in progress...');
            if (!lavalinkInitialized) {
                console.log('🎵 Initial Lavalink setup failed, will keep trying...');
            }
        }
    }, 5000);
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
            case 'status':
                await handleStatusCommand(message);
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
                        { name: `${PREFIX}status`, value: 'Check bot and music service status', inline: false },
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
