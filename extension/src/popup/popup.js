const API_BASE = "http://127.0.0.1:8000";

async function analyseEmail(emailBody) {
  const [summariseRes, triageRes, labelRes] = await Promise.all([
    fetch(`${API_BASE}/summarise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_body: emailBody })
    }),
    fetch(`${API_BASE}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_body: emailBody })
    }),
    fetch(`${API_BASE}/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_body: emailBody })
    })
  ]);

  const [summarise, triage, label] = await Promise.all([
    summariseRes.json(),
    triageRes.json(),
    labelRes.json()
  ]);

  return { summarise, triage, label };
}

async function draftReply(emailBody, tone) {
  const res = await fetch(`${API_BASE}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email_body: emailBody, tone })
  });
  return await res.json();
}

function getPriorityColor(priority) {
  if (priority === "High") return "#EF4444";
  if (priority === "Medium") return "#F59E0B";
  return "#10B981";
}

function renderDraft(emailBody, data) {
  const { summarise, triage, label } = data;
  const color = getPriorityColor(triage.priority);

  document.getElementById("app").innerHTML = `
    <div style="padding:4px 0">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <h1 style="margin:0; font-size:16px">InboxIQ</h1>
        <div style="display:flex; gap:6px">
          <span style="background:${color}; color:white; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600">
            ${triage.priority}
          </span>
          <span style="background:#6366F1; color:white; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600">
            ${label.label}
          </span>
        </div>
      </div>

      <div style="background:#F3F4F6; border-radius:8px; padding:10px; font-size:12px; line-height:1.5; color:#374151; margin-bottom:12px">
        ${summarise.summary}
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:12px; color:#6B7280; display:block; margin-bottom:4px">Reply tone</label>
        <select id="tone-select" style="width:100%; padding:6px 8px; border:1px solid #D1D5DB; border-radius:8px; font-size:12px; background:white">
          <option value="professional">Professional</option>
          <option value="friendly">Friendly</option>
          <option value="brief">Brief</option>
          <option value="formal">Formal</option>
        </select>
      </div>

      <button id="draft-btn" style="width:100%; padding:10px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; margin-bottom:8px">
        ✍️ Draft Reply
      </button>

      <div id="draft-output" style="display:none">
        <label style="font-size:12px; color:#6B7280; display:block; margin-bottom:4px">Suggested reply</label>
        <textarea id="draft-text" style="width:100%; height:120px; padding:8px; border:1px solid #D1D5DB; border-radius:8px; font-size:12px; line-height:1.5; resize:none; box-sizing:border-box"></textarea>
        <button id="copy-btn" style="width:100%; padding:8px; background:#10B981; color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; margin-top:6px">
          📋 Copy to Clipboard
        </button>
      </div>

      <button id="back-btn" style="margin-top:8px; width:100%; padding:8px; background:#E5E7EB; color:#374151; border:none; border-radius:8px; cursor:pointer; font-size:13px">
        ← Analyse another
      </button>
    </div>
  `;

  document.getElementById("draft-btn").addEventListener("click", async () => {
    const tone = document.getElementById("tone-select").value;
    document.getElementById("draft-btn").textContent = "Drafting...";
    document.getElementById("draft-btn").disabled = true;

    try {
      const result = await draftReply(emailBody, tone);
      document.getElementById("draft-text").value = result.draft;
      document.getElementById("draft-output").style.display = "block";
    } catch (err) {
      alert("Error drafting reply. Make sure backend is running!");
    }

    document.getElementById("draft-btn").textContent = "✍️ Draft Reply";
    document.getElementById("draft-btn").disabled = false;
  });

  document.getElementById("copy-btn").addEventListener("click", () => {
    const text = document.getElementById("draft-text").value;
    navigator.clipboard.writeText(text);
    document.getElementById("copy-btn").textContent = "✅ Copied!";
    setTimeout(() => {
      document.getElementById("copy-btn").textContent = "📋 Copy to Clipboard";
    }, 2000);
  });

  document.getElementById("back-btn").addEventListener("click", renderHome);
}

function renderLoading() {
  document.getElementById("app").innerHTML = `
    <div style="text-align:center; padding:20px 0">
      <p style="color:#6B7280; font-size:13px">Analysing email...</p>
    </div>
  `;
}

function renderHome() {
  document.getElementById("app").innerHTML = `
    <h1 style="font-size:16px; margin-bottom:4px">InboxIQ</h1>
    <p style="color:#666; font-size:12px; margin-bottom:12px">Paste your email below to analyse</p>
    <textarea id="email-input" placeholder="Paste email content here..."
      style="width:100%; height:100px; padding:8px; border:1px solid #D1D5DB; border-radius:8px; font-size:12px; resize:none; box-sizing:border-box"></textarea>
    <button id="analyse-btn" style="margin-top:8px; width:100%; padding:10px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px">
      Analyse Email
    </button>
  `;

  document.getElementById("analyse-btn").addEventListener("click", async () => {
    const emailBody = document.getElementById("email-input").value.trim();
    if (!emailBody) return;
    renderLoading();
    try {
      const data = await analyseEmail(emailBody);
      renderDraft(emailBody, data);
    } catch (err) {
      document.getElementById("app").innerHTML = `
        <p style="color:red; font-size:12px">Error: Could not connect to backend. Make sure it is running!</p>
      `;
    }
  });
}

renderHome();
chrome.identity.getAuthToken({ interactive: false }, (token) => {
  if (token) {
    chrome.storage.local.set({ authToken: token });
    console.log('Token refreshed');
  }
});