require('dotenv').config();
const { Telegraf, Markup  } = require('telegraf');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const LocalSession = require('telegraf-session-local');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const localSession = new LocalSession({ database: 'session_db.json' });
bot.use(localSession.middleware());
const app = express();

// Passport configuration DISCORD
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CONSUMER_KEY,
    clientSecret: process.env.DISCORD_CONSUMER_SECRET,
    callbackURL: `${process.env.HTTP_URL}/auth/discord/callback`,
    scope: ['identify', 'email', 'guilds']  // Adjust scopes according to what data you need
},
function(accessToken, refreshToken, profile, cb) {
    profile.accessToken = accessToken; // Save the access token if needed for future API calls
    return cb(null, profile);
}));

// Passport configuration TWITTER
passport.use(new TwitterStrategy({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    callbackURL: `${process.env.HTTP_URL}/auth/twitter/callback`,
    passReqToCallback: true  // This allows us to access the req object in the callback
},
function(req, token, tokenSecret, profile, cb) {
    profile.accessToken = token;
    profile.refreshToken = tokenSecret;
    return cb(null, profile);
}));

passport.serializeUser(function(user, cb) {
    cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
    cb(null, obj);
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ------- BOT START ------//

bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const userName = ctx.from.username;

    try {
        const [userRows] = await pool.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId]);
        if (userRows.length > 0) {
            ctx.reply(`Welcome back! Use /menu to access the menu.`);
        } else {
            await pool.query('INSERT INTO users (telegram_id, telegram_username) VALUES (?, ?)', [telegramId, userName]);
            const [newUser] = await pool.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId]);
            await pool.query('INSERT INTO socials (user_id, twitter_connected, discord_connected) VALUES (?, FALSE, FALSE)', [newUser[0].user_id]);
            ctx.reply('Welcome! Use /menu to kickstart!');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('An error occurred while accessing the database.');
    }
});

// ----- BOT MENU ------//
bot.command('menu', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        const [socialStatus] = await pool.query(`
            SELECT twitter_connected, discord_connected, twitter_handle, discord_username 
            FROM socials 
            JOIN users ON socials.user_id = users.user_id 
            WHERE users.telegram_id = ?`, [telegramId]);

        let message = 'Welcome to the Giveaway Bot! Here’s what you can do:\n\n';
        let twitterButton, discordButton;

        if (socialStatus.length > 0) {
            const social = socialStatus[0];
            message += social.twitter_connected ? `✅ Your Twitter is connected as @${social.twitter_handle}.\n` : '❌ Your Twitter is not connected.\n';
            message += social.discord_connected ? `✅ Your Discord is connected as ${social.discord_username}.` : '❌ Your Discord is not connected.\n';
            twitterButton = social.twitter_connected ? Markup.button.callback('Disconnect Twitter', 'disconnect_twitter') : Markup.button.callback('Connect Twitter', 'connect_twitter');
            discordButton = social.discord_connected ? Markup.button.callback('Disconnect Discord', 'disconnect_discord') : Markup.button.callback('Connect Discord', 'connect_discord');
        } else {
            message += '❌ Your Twitter is not connected.\n';
            message += '❌ Your Discord is not connected.\n';
            twitterButton = Markup.button.callback('Connect Twitter', 'connect_twitter');
            discordButton = Markup.button.callback('Connect Discord', 'connect_discord');
        }

        // Send the interactive menu with dynamic button text
        ctx.replyWithMarkdown(
            message,
            Markup.inlineKeyboard([
                [Markup.button.callback('❓ Help', 'help')],
                [twitterButton, discordButton],
                [
                    Markup.button.callback('New GA', 'create'),
                    Markup.button.callback('Join GA', 'join')
                ],
                [
                    Markup.button.callback('My Created GA', 'createdGiveaways'),
                    Markup.button.callback('My Joined GA', 'joinedGiveaways')
                ],
            ]).resize()
        );
    } catch (err) {
        console.error(err);
        ctx.reply('An error occurred while accessing the menu.');
    }
});

// ----- BOT ACTIONS ------//
bot.action('help', (ctx) => {
    const detailedHelp = `
    *How This Bot Works:*\n\n👉🏻*Social Account Connection*: Before you can create or join giveaways that involve social actions, you'll need to connect your social media accounts. You can do this easily by following the prompts after the Connect Twitter and Connect Discord button on the /menu.\n👉🏻*Participating in Giveaways*: Once you're set up, join any active giveaway by entering its unique code. If the giveaway requires any social interactions, you'll be guided on how to complete those.\n👉🏻*Creating Giveaways*: If you're looking to run your own giveaway, the bot will walk you through setting up the prize details, participant limits, and engagement requirements. All information is managed securely and transparently.\n👉🏻*Managing Your Participation*: Keep track of giveaways you've joined or created using the My Created GA or Joined GA buttons on the /menu to see your activity and status.\n\n🔥Start using these features to enjoy and manage giveaways efficiently now! /start🔥`;
    
    ctx.replyWithMarkdown(detailedHelp);
});

bot.action('connect_twitter', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const state = encodeURIComponent(telegramId);
    const twitterAuthUrl = `${process.env.HTTP_URL}/auth/twitter?state=${state}`;
    ctx.replyWithMarkdown(
        'Please click the link to connect your Twitter account:',
        Markup.inlineKeyboard([
            Markup.button.url('Connect Twitter', twitterAuthUrl)
        ])
    );
});

bot.action('disconnect_twitter', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        await pool.query('UPDATE socials SET twitter_connected = FALSE, twitter_handle = NULL, twitter_id = NULL WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [telegramId]);
        ctx.reply('Your Twitter account has been successfully disconnected.');
    } catch (err) {
        console.error(err); 
        ctx.reply('Failed to disconnect your Twitter account.');
    }
});

bot.action('connect_discord', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const state = encodeURIComponent(telegramId);
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CONSUMER_KEY}&response_type=code&redirect_uri=${encodeURIComponent(`${process.env.HTTP_URL}/auth/discord/callback`)}&scope=identify+email+guilds&state=${encodeURIComponent(state)}`;
    ctx.replyWithMarkdown(
        'Please click the link to connect your Discord account:',
        Markup.inlineKeyboard([
            Markup.button.url('Connect Discord', discordAuthUrl)
        ])
    );
});

bot.action('disconnect_discord', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        await pool.query('UPDATE socials SET discord_connected = FALSE, discord_id = NULL, discord_username = NULL, discord_access_token = NULL WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [telegramId]);
        ctx.reply('Your Discord account has been successfully disconnected.');
    } catch (err) {
        console.error(err); 
        ctx.reply('Failed to disconnect your Twitter account.');
    }
});

bot.action('join', async (ctx) => {
    ctx.session.isJoiningGiveaway = true;
    ctx.reply("Please enter the code of the giveaway you'd like to join:");
});

bot.action('create', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        const [rows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [telegramId]);
        if (rows.length > 0 && rows[0].twitter_connected && rows[0].discord_connected) {
            ctx.session.createState = {
                questionIndex: 0,
                responses: {},
                userId: rows[0].user_id
            };
            askQuestion(ctx);
        } else {
            let message = 'Please connect all required accounts before creating a giveaway:';
            message += rows[0].twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
            message += rows[0].discord_connected ? '\n✅ Discord' : '\n❌ Discord';
            ctx.reply(message);
        }
    } catch (error) {
        console.error(error);
        ctx.reply('Failed to check account connections.');
    }
});

bot.action('createdGiveaways', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        const [rows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [telegramId]);
        if (rows.length > 0 && rows[0].twitter_connected && rows[0].discord_connected) {
             // Fetch only active giveaways (not ended) and their participant count
             const [giveaways] = await pool.query(`
                SELECT g.giveaway_id, g.code, g.prize, g.close_date, g.num_winners, g.isEnded, COUNT(p.user_id) AS participant_count
                FROM giveaways g
                LEFT JOIN participants p ON g.giveaway_id = p.giveaway_id
                WHERE g.creator_id = ? AND g.isEnded = FALSE
                GROUP BY g.giveaway_id
                ORDER BY g.close_date DESC`, [rows[0].user_id]);
            if (giveaways.length > 0) {
                giveaways.forEach(giveaway => {
                    ctx.reply(`Code: ${giveaway.code}\nPrize: ${giveaway.prize}\n\nParticipants: ${giveaway.participant_count}\nClose Date: ${new Date(giveaway.close_date).toLocaleString()}\nWinners: ${giveaway.num_winners}\nEnded: ${giveaway.isEnded ? 'Yes' : 'No'}`,
                        Markup.inlineKeyboard([
                            Markup.button.callback('Roll Winners', `roll_${giveaway.giveaway_id}`)
                        ])
                    );
                });
            } else {
                ctx.reply('You have not created any giveaways.');
            }
        } else {
            let message = 'Please connect all required accounts before viewing giveaways';
            message += rows[0].twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
            message += rows[0].discord_connected ? '\n✅ Discord' : '\n❌ Discord';
            ctx.reply(message);
        }
    } catch (err) {
        console.error(err);
        ctx.reply('Failed to retrieve your giveaways.');
    }
});

bot.action('joinedGiveaways', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        const [userRows] = await pool.query(`
            SELECT u.user_id 
            FROM users u 
            WHERE u.telegram_id = ?`, [telegramId]);

        if (userRows.length > 0) {
            const userId = userRows[0].user_id;
            const [giveaways] = await pool.query(`
                SELECT g.code, g.prize, g.close_date, COUNT(p.user_id) AS participant_count
                FROM giveaways g
                JOIN participants p ON g.giveaway_id = p.giveaway_id
                WHERE p.user_id = ? AND g.isEnded = FALSE
                GROUP BY g.giveaway_id
                ORDER BY g.close_date DESC`, [userId]);

            if (giveaways.length > 0) {
                let response = '*Joined Giveaways :*\n\n';
                giveaways.forEach(giveaway => {
                    response += `🪃 *Code:* ${giveaway.code} \n       *Prize:* ${giveaway.prize} \n       *Close Date:* ${new Date(giveaway.close_date).toLocaleString()} \n\n`;
                });
                ctx.replyWithMarkdown(response);
            } else {
                ctx.reply('You have not joined any giveaways that are active.');
            }
        } else {
            ctx.reply('User not found in database.');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('An error occurred while retrieving your joined giveaways.');
    }
});

bot.action(/verify_(.+)/, async (ctx) => {
    const giveawayId = ctx.match[1];
    ctx.reply('Please send the link to your tweet where you commented or retweeted the post.');
    ctx.session.awaitingTweetLink = { giveawayId: giveawayId };
});

// ----- BOT COMMANDS ------//
bot.command('help', (ctx) => {
    const detailedHelp = `
    *How This Bot Works:*\n\n👉🏻*Social Account Connection*: Before you can create or join giveaways that involve social actions, you'll need to connect your social media accounts. You can do this easily by following the prompts after the Connect Twitter and Connect Discord button on the /menu.\n👉🏻*Participating in Giveaways*: Once you're set up, join any active giveaway by entering its unique code. If the giveaway requires any social interactions, you'll be guided on how to complete those.\n👉🏻*Creating Giveaways*: If you're looking to run your own giveaway, the bot will walk you through setting up the prize details, participant limits, and engagement requirements. All information is managed securely and transparently.\n👉🏻*Managing Your Participation*: Keep track of giveaways you've joined or created using the My Created GA or Joined GA buttons on the /menu to see your activity and status.\n\n🔥Start using these features to enjoy and manage giveaways efficiently now! /start🔥`;
    
    ctx.replyWithMarkdown(detailedHelp);
});

// Connect Discord
bot.command('connect_discord', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const [discordConnected] = await pool.query(`SELECT u.user_id, s.discord_connected FROM users u JOIN socials s ON u.user_id = s.user_id WHERE u.telegram_id = ?`, [telegramId]);
    if (discordConnected.length > 0) {
        if (discordConnected[0].discord_connected) {
            ctx.reply("Already has discord account connected. use the /disconnect_discord to disconnect discord.");
        } else {
            const state = encodeURIComponent(telegramId);
            const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CONSUMER_KEY}&response_type=code&redirect_uri=${encodeURIComponent(`${process.env.HTTP_URL}/auth/discord/callback`)}&scope=identify+email+guilds&state=${encodeURIComponent(state)}`;
            ctx.replyWithMarkdown(`Please click the link to connect your Discord account:\n[Connect Discord](${discordAuthUrl})`);
        }
    } else {
        // Handle the case where the user is not found in the database
        ctx.reply("You need to register first. Please use the /start command to register.");
    }
});

// Disconnect Discord
bot.command('disconnect_discord', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        // First, check the current connection status
        const [result] = await pool.query(`
            SELECT discord_connected 
            FROM socials 
            JOIN users ON socials.user_id = users.user_id 
            WHERE users.telegram_id = ?`, [telegramId]);

        if (result.length > 0) {
            if (result[0].discord_connected) {
                // If connected, proceed to disconnect
                await pool.query('UPDATE socials SET discord_connected = FALSE, discord_id = NULL, discord_username = NULL, discord_access_token = NULL WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [telegramId]);
                ctx.reply('Your Discord account has been successfully disconnected.');
            } else {
                // If already disconnected, inform the user
                ctx.reply('Your Discord account is already disconnected.');
            }
        } else {
            // If no user or socials record is found
            ctx.reply('No associated Discord account found to disconnect.');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('Failed to disconnect your Discord account.');
    }
});

// Connect Twitter
bot.command('connect_twitter', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const [twitterConnected] = await pool.query(`SELECT u.user_id, s.twitter_connected FROM users u JOIN socials s ON u.user_id = s.user_id WHERE u.telegram_id = ?`, [telegramId]);
    if (twitterConnected.length > 0) {
        // Check if the Twitter account is already connected
        if (twitterConnected[0].twitter_connected) {
            ctx.reply("Already has twitter account connected. use the /disconnect_twitter to disconnect twitter.");
        } else {
            const state = encodeURIComponent(telegramId);
            ctx.replyWithMarkdown(`Please click the link to connect your Twitter account:\n[Connect Twitter](${process.env.HTTP_URL}/auth/twitter?state=${state})`);
        }
    } else {
        // Handle the case where the user is not found in the database
        ctx.reply("You need to register first. Please use the /start command to register.");
    }
});

// Disconnect Twitter
bot.command('disconnect_twitter', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        // First, check the current connection status
        const [result] = await pool.query(`
            SELECT twitter_connected 
            FROM socials 
            JOIN users ON socials.user_id = users.user_id 
            WHERE users.telegram_id = ?`, [telegramId]);

        if (result.length > 0) {
            if (result[0].twitter_connected) {
                // If connected, proceed to disconnect
                await pool.query('UPDATE socials SET twitter_connected = FALSE, twitter_handle = NULL, twitter_id = NULL WHERE user_id = (SELECT user_id FROM users WHERE telegram_id = ?)', [telegramId]);
                ctx.reply('Your Twitter account has been successfully disconnected.');
            } else {
                // If already disconnected, inform the user
                ctx.reply('Your Twitter account is already disconnected.');
            }
        } else {
            // If no user or socials record is found
            ctx.reply('No associated Twitter account found to disconnect.');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('Failed to disconnect your Twitter account.');
    }
});

// Join a giveaway
bot.command('join', async (ctx) => {
    const userId = ctx.from.id.toString();
    const textParts = ctx.message.text.split(' ');
        if (textParts.length < 2) {
            ctx.reply("Please provide the code to join the giveaway. Usage: /join <code>");
            return;
        }
    const code = textParts[1];
    try {
        const [userRows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [userId]);
        if (userRows.length > 0) {
            const user = userRows[0];
            if (!user.twitter_connected || !user.discord_connected) {
                // Construct a message detailing which accounts need to be connected
                let message = "Please connect all required accounts before joining a giveaway:";
                message += user.twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
                message += user.discord_connected ? '\n✅ Discord' : '\n❌ Discord';
                ctx.reply(message);
            } else {
                // Check if the giveaway exists and the user can join
                const [giveaway] = await pool.query('SELECT * FROM giveaways WHERE code = ?', [code]);
                if (giveaway.length) {
                    const giveawayId = giveaway[0].giveaway_id;

                    // Check if the giveaway has ended
                    if (giveaway[0].isEnded) {
                        ctx.reply('Giveaway already ended.');
                        return;
                    }

                    // Check if the user has already joined this giveaway
                    const [existingEntry] = await pool.query('SELECT * FROM participants WHERE user_id = ? AND giveaway_id = ?', [user.user_id, giveawayId]);
                    if (existingEntry.length > 0) {
                        ctx.reply('You have already joined this giveaway.');
                        return;
                    }
                    
                     // Check for the maximum number of participants
                     const [participants] = await pool.query('SELECT COUNT(*) AS count FROM participants WHERE giveaway_id = ?', [giveawayId]);
                     if (participants[0].count >= giveaway[0].max_participants) {
                         ctx.reply('Reached maximum number of participants.');
                         return;
                     }

                    await pool.query('INSERT INTO participants (user_id, giveaway_id) VALUES (?, ?)', [user.user_id, giveaway[0].giveaway_id]);
                    ctx.reply('You have joined the giveaway successfully.');
                } else {
                    ctx.reply('Giveaway not found.');
                }
            }
        } else {
            ctx.reply('User not found in database.');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('An error occurred while joining the giveaway.');
    }
});

// Create a giveaway
bot.command('create', async (ctx) => {
    const userId = ctx.from.id.toString();
    try {
        const [rows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [userId]);
        if (rows.length > 0 && rows[0].twitter_connected && rows[0].discord_connected) {
            ctx.session.createState = {
                questionIndex: 0,
                responses: {},
                userId: rows[0].user_id
            };
            askQuestion(ctx);
        } else {
            let message = 'Please connect all required accounts before creating a giveaway:';
            message += rows[0].twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
            message += rows[0].discord_connected ? '\n✅ Discord' : '\n❌ Discord';
            ctx.reply(message);
        }
    } catch (error) {
        console.error(error);
        ctx.reply('Failed to check account connections.');
    }
});

// Command to show created giveaways
bot.command('createdGiveaways', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    try {
        const [rows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [telegramId]);
        if (rows.length > 0 && rows[0].twitter_connected && rows[0].discord_connected) {
             // Fetch only active giveaways (not ended) and their participant count
             const [giveaways] = await pool.query(`
                SELECT g.giveaway_id, g.code, g.prize, g.close_date, g.num_winners, g.isEnded, COUNT(p.user_id) AS participant_count
                FROM giveaways g
                LEFT JOIN participants p ON g.giveaway_id = p.giveaway_id
                WHERE g.creator_id = ? AND g.isEnded = FALSE
                GROUP BY g.giveaway_id
                ORDER BY g.close_date DESC`, [rows[0].user_id]);
            if (giveaways.length > 0) {
                giveaways.forEach(giveaway => {
                    ctx.reply(`Code: ${giveaway.code}\nPrize: ${giveaway.prize}\n\nParticipants: ${giveaway.participant_count}\nClose Date: ${new Date(giveaway.close_date).toLocaleString()}\nWinners: ${giveaway.num_winners}\nEnded: ${giveaway.isEnded ? 'Yes' : 'No'}`,
                        Markup.inlineKeyboard([
                            Markup.button.callback('Roll Winners', `roll_${giveaway.giveaway_id}`)
                        ])
                    );
                });
            } else {
                ctx.reply('You have not created any giveaways.');
            }
        } else {
            let message = 'Please connect all required accounts before viewing giveaways';
            message += rows[0].twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
            message += rows[0].discord_connected ? '\n✅ Discord' : '\n❌ Discord';
            ctx.reply(message);
        }
    } catch (err) {
        console.error(err);
        ctx.reply('Failed to retrieve your giveaways.');
    }
});

// Handle rolling winners
bot.action(/roll_(.+)/, async (ctx) => {
    const giveawayId = ctx.match[1];
    try {
        const [giveawayDetails] = await pool.query('SELECT * FROM giveaways WHERE giveaway_id = ?', [giveawayId]);
        if (giveawayDetails.length === 0) {
            ctx.reply('No such giveaway found.');
            return;
        }
        const giveaway = giveawayDetails[0];

        // Selecting random winners based on the giveaway settings
        const [participants] = await pool.query('SELECT user_id FROM participants WHERE giveaway_id = ? ORDER BY RAND() LIMIT ?', [giveawayId, giveaway.num_winners]);

        if (participants.length === 0) {
            ctx.reply('No participants in this giveaway.');
            return;
        }
        
        // Notifying winners and setting isWinner
        let winnerDetailsMsg = "Giveaway ended and winners notified:\n";
        for (const participant of participants) {
            const [winner] = await pool.query(`
                SELECT u.telegram_id, s.twitter_handle, s.discord_username
                FROM users u
                JOIN socials s ON u.user_id = s.user_id
                WHERE u.user_id = ?`, [participant.user_id]
            );
            await pool.query('UPDATE participants SET isWinner = TRUE WHERE user_id = ? AND giveaway_id = ?', [participant.user_id, giveawayId]);
            const winnerMessage = `Congratulations! You have won the giveaway: ${giveaway.prize}.\nGiveaway Code: ${giveaway.code}\nContact @${giveaway.creator_twitter_handle} on Twitter or ${giveaway.creator_discord_username} on Discord for your prize.`;
            bot.telegram.sendMessage(winner[0].telegram_id, winnerMessage);
            winnerDetailsMsg += `Twitter: @${winner[0].twitter_handle}, Discord: ${winner[0].discord_username}, Telegram: @${winner[0].telegram_id}\n`;
        }

        // Marking the giveaway as ended
        await pool.query('UPDATE giveaways SET isEnded = TRUE WHERE giveaway_id = ?', [giveawayId]);
        ctx.reply(winnerDetailsMsg);
    } catch (err) {
        console.error(err);
        ctx.reply('An error occurred while rolling winners.');
    }
});

// Express routes for Discord OAuth
app.get('/auth/discord', (req, res, next) => {
    const state = encodeURIComponent(req.session.userId);
    const callbackUrl = `${process.env.HTTP_URL}/auth/discord/callback?state=${state}`;
    passport.authenticate('discord', { scope: ['identify', 'email', 'guilds'], callbackURL: callbackUrl })(req, res, next);
});

app.get('/auth/discord/callback',
    function(req, res, next) {
        next();
    },
    passport.authenticate('discord', { failureRedirect: '/login' }),
    async (req, res) => {
        const telegramId = decodeURIComponent(req.query.state);  // Using session to retrieve user ID
        try {
            const [users] = await pool.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId]);
            const userId = users[0].user_id;
            
            // Check if the Discord ID is already used by another user
            const [existing] = await pool.query('SELECT user_id FROM socials WHERE discord_id = ? AND user_id != ?', [req.user.id, userId]);
            if (existing.length > 0) {
                // If Discord ID is already used, notify the user and do not connect the account
                res.send("This Discord account is already connected to another user.");
            } else {
                // If not used, update the Discord-related data in the database
                const updateQuery = `UPDATE socials SET discord_connected = ?, discord_id = ?, discord_username = ?, discord_access_token = ? WHERE user_id = ?`;
                await pool.query(updateQuery, [true, req.user.id, req.user.username, req.user.accessToken, userId]);

                res.send("Discord connected! You can close this window.");
                // Send a message to the user on Telegram
                await bot.telegram.sendMessage(telegramId, `Discord successfully connected as ${req.user.username}.`);
            }
        } catch (error) {
            console.error('Failed to update Discord data:', error);
            res.send("Failed to connect Discord.");
        }
    }
);

// Express routes for Twitter OAuth
app.get('/auth/twitter', (req, res, next) => {
    const state = req.query.state;
    const callbackUrl = `${process.env.HTTP_URL}/auth/twitter/callback?state=${state}`;
    passport.authenticate('twitter', { callbackURL: callbackUrl })(req, res, next);
});

app.get('/auth/twitter/callback',
    function(req, res, next) {
        next();
    },
    passport.authenticate('twitter', { failureRedirect: '/login' }),
    async (req, res) => {
        const telegramId = decodeURIComponent(req.query.state);  // Using session to retrieve telegram ID
        try {
            const [users] = await pool.query('SELECT user_id FROM users WHERE telegram_id = ?', [telegramId]);
            const userId = users[0].user_id;
            
            // Check if the Twitter ID is already used by another user
            const [existing] = await pool.query('SELECT user_id FROM socials WHERE twitter_id = ? AND user_id != ?', [req.user.id, userId]);
            if (existing.length > 0) {
                // If Twitter ID is already used, notify the user and do not connect the account
                res.send("This Twitter account is already connected to another user.");
                await bot.telegram.sendMessage(telegramId, `Twitter account already connected to another user.`);
            } else {
                // If not used, update the Twitter-related data in the database
                const updateQuery = `UPDATE socials SET twitter_connected = ?, twitter_handle = ?, twitter_id = ?, twitter_access_token = ?, twitter_access_secret = ? WHERE user_id = ?`;
                await pool.query(updateQuery, [true, req.user.username, req.user.id, req.user.accessToken, req.user.refreshToken, userId]);

                res.send("Twitter connected! You can close this window.");
                // Send a message to the user on Telegram
                await bot.telegram.sendMessage(telegramId, `Twitter successfully connected (Handle: @${req.user.username}).`);
            }
        } catch (error) {
            console.error('Failed to update Twitter data:', error);
            res.send("Failed to connect Twitter.");
        }
    }
);

bot.on('text', async (ctx) => {
    if (ctx.session.createState && ctx.message.text) {
        const response = ctx.message.text;

        // Check if the user wants to cancel the creation process
        if (response.toLowerCase() === 'cancel') {
            // Reset the creation state
            ctx.session.createState = null;
            // Send a cancellation message
            ctx.reply('GA creation has been canceled.');
        } else {
            const index = ctx.session.createState.questionIndex;
            if (validateResponse(index, response, ctx)) {
                ctx.session.createState.responses[questions[index]] = response;
                ctx.session.createState.questionIndex++;
                askQuestion(ctx);
            }
        }
    } else if (ctx.session.isJoiningGiveaway) {
        const telegramId = ctx.from.id.toString();
        // The user sent a giveaway code, so process it
        const code = ctx.message.text.trim();
        ctx.session.isJoiningGiveaway = false; // Reset the flag first to avoid repeat handling
        const [userRows] = await pool.query('SELECT users.user_id, twitter_connected, discord_connected FROM users JOIN socials ON users.user_id = socials.user_id WHERE telegram_id = ?', [telegramId]);
        if (userRows.length > 0) {
            const user = userRows[0];
            if (!user.twitter_connected || !user.discord_connected) {
                // Construct a message detailing which accounts need to be connected
                let message = "Please connect all required accounts before joining a giveaway:";
                message += user.twitter_connected ? '\n✅ Twitter' : '\n❌ Twitter';
                message += user.discord_connected ? '\n✅ Discord' : '\n❌ Discord';
                ctx.reply(message);
            } else {
                // Check if the giveaway exists and the user can join
                const [giveaway] = await pool.query('SELECT * FROM giveaways WHERE code = ?', [code]);
                if (giveaway.length) {
                    const giveawayId = giveaway[0].giveaway_id;

                    // Check if the giveaway has ended
                    if (giveaway[0].isEnded) {
                        ctx.reply('Giveaway already ended.');
                        return;
                    }

                    // Check if the user has already joined this giveaway
                    const [existingEntry] = await pool.query('SELECT * FROM participants WHERE user_id = ? AND giveaway_id = ?', [user.user_id, giveawayId]);
                    if (existingEntry.length > 0) {
                        ctx.reply('You have already joined this giveaway.');
                        return;
                    }
                    
                     // Check for the maximum number of participants
                     const [participants] = await pool.query('SELECT COUNT(*) AS count FROM participants WHERE giveaway_id = ?', [giveawayId]);
                     if (participants[0].count >= giveaway[0].max_participants) {
                         ctx.reply('Reached maximum number of participants.');
                         return;
                     }

                     if (giveaway[0].post_link) {
                        const tweetId = giveaway[0].post_link.split('/').pop();
                        await ctx.replyWithMarkdown(`Please like,rt and comment on this post to participate:`,
                            Markup.inlineKeyboard([
                                Markup.button.url('Link to Post', giveaway[0].post_link),
                                Markup.button.callback('Verify', `verify_${giveawayId}`)
                            ])
                        );                        
                    } 
                    else {
                        await pool.query('INSERT INTO participants (user_id, giveaway_id) VALUES (?, ?)', [user.user_id, giveaway[0].giveaway_id]);
                        ctx.reply('You have joined the giveaway successfully.');
                    }
                } else {
                    ctx.reply('Giveaway not found.');
                }
            }
        } else {
            ctx.reply('User not found in database.');
        }
    } else if (ctx.session.awaitingTweetLink) {
        const url = ctx.message.text;
        const giveawayId = ctx.session.awaitingTweetLink.giveawayId;

        // Validate the URL
        if (!url.startsWith('https://x.com/') && !url.startsWith('https://twitter.com/') || !url.includes('/status/')) {
            ctx.reply('Please send a valid Twitter post link.');
            return;
        }

        // Extract tweet ID and user handle from URL
        const tweetId = url.split('/status/')[1];
        const userHandle = url.split('.com/')[1].split('/status/')[0];

        // Verify the Twitter handle matches the connected user's handle
        const [user] = await pool.query(`
            SELECT s.twitter_handle, s.user_id 
            FROM socials s
            JOIN users u ON s.user_id = u.user_id 
            WHERE u.telegram_id = ?`, [ctx.from.id]
        );
        if (userHandle !== user[0].twitter_handle) {
            ctx.reply('The Twitter handle in the provided link does not match your connected account.');
            return;
        }

        // Clear the session variable and allow joining the giveaway
        ctx.session.awaitingTweetLink = null;
        await pool.query('INSERT INTO participants (user_id, giveaway_id) VALUES (?, ?)', [user[0].user_id, giveawayId]);
        ctx.reply('You have joined the giveaway successfully.');
    }
});

app.get('/login', (req, res) => res.send("Login failed!"));

bot.launch();

// FUNCTIONS
const questions = [
    "What is the giveaway prize? (Please reply with the prize details)",
    "What is the number of participants? (Please enter a positive integer)",
    "How many winners will there be? (Please enter a positive integer)",
    "Link to post to like/rt/comment (Please enter a twitter post link)",
    "What is the minimum number of followers for participants? (Please enter a positive integer)",
    "When is the close date and time? (Please use the format: DD/MM/YY-HH:mm)"
];

function askQuestion(ctx) {
    if (ctx.session.createState.questionIndex < questions.length) {
        ctx.reply(questions[ctx.session.createState.questionIndex]);
    } else {
        finalizeCreate(ctx);
    }
}

function finalizeCreate(ctx) {
    const responses = ctx.session.createState.responses;
    const giveawayCode = crypto.randomBytes(3).toString('hex');
    const sql = 'INSERT INTO giveaways (code, prize, max_participants, num_winners, post_link, min_followers, close_date, creator_id) VALUES (?, ?, ?, ?, ?, ?, STR_TO_DATE(?, \'%d/%m/%y-%H:%i\'), ?)';
    const values = [
        giveawayCode,
        responses[questions[0]],
        responses[questions[1]],
        responses[questions[2]],
        responses[questions[3]],
        responses[questions[4]],
        responses[questions[5]],
        ctx.session.createState.userId
    ];

    pool.query(sql, values).then(() => {
        ctx.reply(`Giveaway created successfully! Your giveaway code is: ${giveawayCode}`);
        ctx.session.createState = null; // Clear session state after completion
    }).catch(err => {
        console.error(err);
        ctx.reply('Failed to create the giveaway.');
    });
}

function validateResponse(index, response, ctx) {
    if (index === 1 || index === 2) {
        if (!/^\d+$/.test(response) || parseInt(response) < 1) {
            ctx.reply('Please enter a valid positive integer.');
            return false;
        }
    } else if (index === 3) { 
        // validation for post_link, check if it's a valid twitter post
        const twitterUrlRegex = /^https:\/\/(?:x\.com|twitter\.com)\/(?:#!\/)?(\w+)\/status\/(\d+)$/;
        if (!twitterUrlRegex.test(response)) {
            ctx.reply('Please enter a valid Twitter post link.');
            return false;
        }
    } else if (index === 4) {
        // Validation for zero or positive integers (number of followers)
        if (!/^\d+$/.test(response) || parseInt(response) < 0) {
            ctx.reply('Please enter a valid number (0 or positive integer).');
            return false;
        }
    } else if (index === 5) {
        if (!/\d{2}\/\d{2}\/\d{2}-\d{1,2}:\d{2}/.test(response)) {
            ctx.reply('Please use the correct datetime format: DD/MM/YY-HH:mm');
            return false;
        }
    }
    return true;
}

app.listen(3000, () => {
    console.log(`Telegram bot and server running on ${process.env.HTTP_URL}`);
});
