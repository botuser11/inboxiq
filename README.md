# 🧠 InboxIQ — AI-Powered Gmail Assistant

> A Chrome extension that brings AI directly into Gmail — summarising emails, triaging priority, auto-labelling your inbox, and drafting tone-aware replies. Built with FastAPI, Google OAuth, and NVIDIA Nemotron AI.

---

## ✨ Features

| Feature | Description |
|---|---|
| ⚡ One-click AI Analysis | Summary, priority level, and label in a single click |
| 📧 Full Thread Awareness | Reads entire conversation (up to 10 messages) for context |
| 📅 Deadline Extraction | Detects multiple deadlines with a collapsible timeline view |
| ⏰ Date-Aware Priority | Boosts priority automatically for emails due within 24hrs or 7 days |
| 🏷️ Auto-Labelling | Batch processes 15 emails per API call when you open Gmail |
| 📁 Gmail Label Management | Creates labels and moves emails via Gmail API |
| ✍️ Smart Draft Replies | Tone-aware drafts (Professional / Friendly / Brief / Formal) |
| 📋 Copy to Clipboard | One-click copy of any generated draft |
| 🚀 5-Second Analysis | Optimised from an original 3-minute response time |
| 💰 Efficient API Usage | Combined endpoints + batch processing minimise API calls |

---

## 🛠️ Tech Stack

- **Frontend:** Chrome Extension (Manifest V3, vanilla JavaScript)
- **Backend:** FastAPI (Python)
- **AI Model:** `nvidia/nemotron-3-nano-30b-a3b:free` via [OpenRouter](https://openrouter.ai)
- **Auth:** Google OAuth 2.0 + Gmail API
- **Architecture:** API calls routed through service worker to bypass CORS

---

## 📁 Project Structure

```
inboxiq/
├── extension/
│   ├── manifest.json
│   └── src/
│       ├── background/
│       │   └── background.js        # Service worker — handles API calls, Gmail API
│       ├── content/
│       │   ├── content.js           # Main logic — UI, analysis flow, draft replies
│       │   └── content.css          # Panel styling
│       └── popup/
│           ├── popup.html
│           ├── popup.css
│           └── popup.js
└── backend/
    ├── main.py                      # FastAPI app entry point
    ├── .env                         # OPENROUTER_API_KEY (not committed)
    ├── routers/
    │   ├── analyse.py               # Combined endpoint + batch endpoint
    │   └── draft.py                 # Draft reply generation
    └── services/
        └── nemotron.py              # OpenRouter API integration
```

---

## 🚀 How to Run Locally

### Prerequisites
- Python 3.10+
- Google Chrome
- An [OpenRouter](https://openrouter.ai) account (free, no credit card needed)
- A Google Cloud project with Gmail API enabled

---

### 1. Clone the repo

```bash
git clone https://github.com/botuser11/inboxiq.git
cd inboxiq
```

---

### 2. Set up the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:

```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

Start the backend:

```bash
uvicorn main:app --reload
```

Backend will run at `http://127.0.0.1:8000`

---

### 3. Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `inboxiq/extension` folder
5. The InboxIQ extension is now installed

---

### 4. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable the **Gmail API**
4. Create OAuth 2.0 credentials (Chrome Extension type)
5. Add your extension ID to the authorised origins
6. Update `manifest.json` with your OAuth Client ID

---

### 5. Use InboxIQ

1. Open [Gmail](https://mail.google.com) in Chrome
2. Click any email to open it
3. The **InboxIQ panel** appears on the right side of the email
4. Click **Analyse** — within 5 seconds you'll see:
   - 📝 A summary of the email/thread
   - 🔴🟡🟢 Priority level (High / Medium / Low)
   - 🏷️ Suggested label
   - 📅 Any deadlines detected
5. Click **Apply Label** to move the email in Gmail
6. Click **Draft Reply**, choose a tone, and get an AI-written response
7. Copy the draft to clipboard and send from Gmail

> **Note:** When reloading the extension, always close all Gmail tabs first, then open a fresh Gmail tab.

---

## ⚙️ Architecture Decisions

**Why route API calls through background.js?**
Content scripts can't call `localhost` directly due to CORS. All fetch calls go through the service worker (`background.js`) which acts as a proxy.

**Why does auto-labelling use a batch endpoint?**
Calling the AI separately for each email would exhaust the free API tier instantly. The `/batch-analyse` endpoint processes up to 15 emails in a single AI call.

**Why search Gmail API by subject instead of using URL thread IDs?**
Gmail URL thread IDs (e.g. `#inbox/FMfcgz...`) are not the same as Gmail API thread IDs. The extension searches by subject to get the real API-compatible thread ID for label operations.

---

## 📊 Performance

| Metric | Before | After |
|---|---|---|
| Analysis time | ~3 minutes | ~5 seconds |
| API calls per inbox load | 15 | 1 (batch) |
| API calls per analysis | 3 | 1 (combined) |

---

## 🔮 Future Plans

- [ ] Deploy backend to Railway for cloud hosting
- [ ] User-supplied OpenRouter API key (for public release)
- [ ] Chrome Web Store publication
- [ ] Support for multiple AI model selection
- [ ] Calendar integration for deadline reminders

---

## 🧪 Testing / Access

This app is currently in **Google OAuth testing mode**. To try InboxIQ, email me your Gmail address and I'll add you as a test user within 24 hours.

👉 **Request access:** [karshanvalluvar@gmail.com](mailto:karshanvalluvar@gmail.com)

Once added, follow the [How to Run Locally](#-how-to-run-locally) guide above to get set up.

---

## 👨‍💻 Author

**Karthik** — [@botuser11](https://github.com/botuser11)

Built as a portfolio project demonstrating full-stack development with AI integration, Chrome Extension APIs, and Google OAuth.

---

## 📄 Licence

MIT
