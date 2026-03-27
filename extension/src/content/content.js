function showStaleExtensionError() {
  const body = document.getElementById('inboxiq-body');
  if (!body) return;
  body.innerHTML = `
    <p style="color:#F59E0B; font-size:12px; margin-bottom:8px">InboxIQ was updated — please refresh this Gmail tab</p>
    <button onclick="window.location.reload()" style="width:100%; padding:8px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px">↻ Refresh tab</button>
  `;
}

// Issue 4: helper that retries once if the service worker is sleeping
async function sendMessageWithRetry(message) {
  const tryOnce = () => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });

  try {
    return await tryOnce();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Could not establish connection') || msg.includes('receiving end does not exist')) {
      showLoading('⏳ Waking up AI...');
      await new Promise(r => setTimeout(r, 1500));
      if (!chrome.runtime?.id) throw new Error('STALE_EXTENSION');
      try {
        return await tryOnce();
      } catch {
        throw new Error('❌ Extension needs a refresh — close Gmail and reopen.');
      }
    }
    throw err;
  }
}

async function callAPI(url, body) {
  console.log('InboxIQ: Sending API call to', url);

  if (!chrome.runtime?.id) {
    throw new Error('STALE_EXTENSION');
  }

  const response = await sendMessageWithRetry({ type: 'API_CALL', url, body });

  console.log('InboxIQ: Got response', response);
  if (!response || !response.success) {
    throw new Error(response?.error || 'API call failed');
  }
  return response.data;
}

function getEmailBody() {
  const selectors = [
    '.a3s.aiL',
    '.a3s',
    '.ii.gt div',
    '[data-message-id] .ii.gt div'
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 20) {
      return el.innerText.trim();
    }
  }
  return null;
}

function removeExistingPanel() {
  const existing = document.getElementById('inboxiq-panel');
  if (existing) existing.remove();
}

function removeExistingBtn() {
  const existing = document.getElementById('inboxiq-trigger');
  if (existing) existing.remove();
}

function injectButton() {
  if (document.getElementById('inboxiq-trigger')) return;

  const emailBody = getEmailBody();
  if (!emailBody) return;

  const btn = document.createElement('button');
  btn.id = 'inboxiq-trigger';
  btn.innerText = '⚡ InboxIQ';
  btn.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 10px 18px;
    background: #4F46E5;
    color: white;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(79,70,229,0.4);
  `;

  btn.addEventListener('click', () => {
    removeExistingPanel();
    createPanel(emailBody);
  });

  document.body.appendChild(btn);
}

function createPanel(emailBody) {
  const panel = document.createElement('div');
  panel.id = 'inboxiq-panel';
  panel.innerHTML = `
    <div id="inboxiq-header">
      <span style="font-weight:600; font-size:13px">⚡ InboxIQ</span>
      <button id="inboxiq-close" style="background:none; border:none; cursor:pointer; font-size:18px; color:white; line-height:1">×</button>
    </div>
    <div id="inboxiq-body">
      <button id="inboxiq-analyse-btn" style="width:100%; padding:10px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600">
        Analyse this email
      </button>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('inboxiq-close').addEventListener('click', () => {
    panel.remove();
  });

  async function runAnalysis() {
    showLoading('Reading thread...');
    try {
      const analyseFlow = async () => {
        const subject =
          document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
          document.querySelector('[role="main"] h2')?.textContent?.trim();

        let threadContext = null;
        let messageCount = 1;

        if (subject) {
          const threadResponse = await sendMessageWithRetry({ type: 'GET_THREAD_CONTEXT', subject });
          if (threadResponse?.success && threadResponse.messageCount > 1) {
            threadContext = threadResponse.threadMessages;
            messageCount = threadResponse.messageCount;
          } else if (threadResponse?.success === false) {
            console.warn('InboxIQ: Thread context failed:', threadResponse.error);
          }
        }

        showLoading('Analysing email...');

        const payload = { email_body: emailBody };
        if (threadContext) payload.thread_context = threadContext;

        const result = await callAPI('http://127.0.0.1:8000/analyse', payload);

        showResults(emailBody, result, messageCount);

        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, async (response) => {
            if (response && response.success) {
              await moveEmailToLabel(response.token, result.label);
            } else {
              console.warn('InboxIQ: Could not get auth token:', response?.error);
            }
          });
        }
      };

      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('⚠️ Could not reach backend. Is it running?')), 30000);
      });

      await Promise.race([analyseFlow(), timeout]).finally(() => clearTimeout(timeoutId));

    } catch (err) {
      console.error('InboxIQ: Analysis error:', err);
      if (err.message === 'STALE_EXTENSION' || err.message?.includes('Extension context')) {
        showStaleExtensionError();
      } else {
        document.getElementById('inboxiq-body').innerHTML = `
          <p style="color:#EF4444; font-size:12px">${err.message || err}</p>
          <button id="iq-retry-btn" style="width:100%; padding:8px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; margin-top:8px">🔄 Try Again</button>
        `;
        document.getElementById('iq-retry-btn')?.addEventListener('click', () => runAnalysis());
      }
    }
  }

  document.getElementById('inboxiq-analyse-btn').addEventListener('click', () => runAnalysis());
}

function getPriorityColor(priority) {
  if (priority === 'High') return '#EF4444';
  if (priority === 'Medium') return '#F59E0B';
  return '#10B981';
}

function showLoading(msg = 'Analysing email...') {
  document.getElementById('inboxiq-body').innerHTML = `
    <p style="color:#6B7280; font-size:12px; text-align:center; padding:8px 0">${msg}</p>
  `;
}

function buildDeadlinesHtml(result) {
  const now = new Date();
  const deadlines = result.upcoming_deadlines || [];
  const reasonText = result.priority_reason || '';

  if (!reasonText && deadlines.length === 0) return '';

  let html = '';

  if (reasonText) {
    html += `<div style="color:#6B7280; font-size:11px; margin-top:4px">⏰ ${reasonText}</div>`;
  }

  if (deadlines.length > 0) {
    const listItems = deadlines.map(d => {
      const dt = new Date(d.date.replace(' ', 'T'));
      const isPast = dt <= now;
      const icon = isPast ? '❌' : '📅';
      const diffMs = dt - now;
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));

      let rel = '';
      if (isPast) {
        rel = 'passed';
      } else if (diffHours < 24) {
        rel = `${diffHours}h`;
      } else {
        rel = `${diffDays} days`;
      }

      const hasTime = !d.date.endsWith('00:00');
      const dateLabel = hasTime
        ? dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : dt.toLocaleString('en-GB', { day: 'numeric', month: 'short' });

      const desc = d.description ? ` — ${d.description}` : '';
      return `<div style="padding:2px 0; color:${isPast ? '#9CA3AF' : '#374151'}">${icon} ${dateLabel}${desc} <span style="color:#9CA3AF">(${rel})</span></div>`;
    }).join('');

    html += `
      <div style="margin-top:4px; margin-bottom:6px">
        <div id="inboxiq-deadlines-toggle" style="color:#6B7280; font-size:11px; cursor:pointer; user-select:none">
          ▶ View all deadlines (${deadlines.length})
        </div>
        <div id="inboxiq-deadlines-list" style="display:none; margin-top:4px; background:#F9FAFB; border-radius:6px; padding:6px 8px; font-size:11px; line-height:1.7">
          ${listItems}
        </div>
      </div>`;
  }

  return html;
}

function showResults(emailBody, result, messageCount = 1) {
  const color = getPriorityColor(result.priority);
  const deadlinesHtml = buildDeadlinesHtml(result);
  const threadHtml = messageCount > 1
    ? `<div style="color:#9CA3AF; font-size:11px; margin-bottom:6px">📧 Thread (${messageCount} messages)</div>`
    : '';
  document.getElementById('inboxiq-body').innerHTML = `
    ${threadHtml}
    <div style="display:flex; gap:6px; margin-bottom:4px; flex-wrap:wrap">
      <span style="background:${color}; color:white; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600">${result.priority}</span>
      <span style="background:#6366F1; color:white; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600">${result.label}</span>
      <span id="inboxiq-move-badge" style="background:#6B7280; color:white; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600">📁 Moving...</span>
    </div>
    ${deadlinesHtml}
    <div style="background:#F3F4F6; border-radius:8px; padding:10px; font-size:12px; line-height:1.5; color:#374151; margin-bottom:10px">
      ${result.summary}
    </div>
    <select id="inboxiq-tone" style="width:100%; padding:6px; border:1px solid #D1D5DB; border-radius:8px; font-size:12px; margin-bottom:8px; background:white">
      <option value="professional">Professional tone</option>
      <option value="friendly">Friendly tone</option>
      <option value="brief">Brief tone</option>
      <option value="formal">Formal tone</option>
    </select>
    <button id="inboxiq-draft-btn" style="width:100%; padding:8px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; margin-bottom:8px">
      ✍️ Draft Reply
    </button>
    <div id="inboxiq-draft-output" style="display:none">
      <textarea id="inboxiq-draft-text" style="width:100%; height:100px; padding:8px; border:1px solid #D1D5DB; border-radius:8px; font-size:12px; resize:none; box-sizing:border-box; margin-bottom:6px"></textarea>
      <button id="inboxiq-copy-btn" style="width:100%; padding:8px; background:#10B981; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px">
        📋 Copy to Clipboard
      </button>
    </div>
    <button id="inboxiq-reset-btn" style="width:100%; padding:6px; background:#E5E7EB; color:#374151; border:none; border-radius:8px; cursor:pointer; font-size:12px; margin-top:6px">
      ← Back
    </button>
  `;

  const toggle = document.getElementById('inboxiq-deadlines-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const list = document.getElementById('inboxiq-deadlines-list');
      const expanded = list.style.display !== 'none';
      list.style.display = expanded ? 'none' : 'block';
      toggle.textContent = toggle.textContent.replace(expanded ? '▼' : '▶', expanded ? '▶' : '▼');
    });
  }

  document.getElementById('inboxiq-draft-btn').addEventListener('click', async () => {
    const tone = document.getElementById('inboxiq-tone').value;
    document.getElementById('inboxiq-draft-btn').textContent = 'Drafting...';
    document.getElementById('inboxiq-draft-btn').disabled = true;
    try {
      const data = await callAPI('http://127.0.0.1:8000/draft', { email_body: emailBody, tone });
      document.getElementById('inboxiq-draft-text').value = data.draft;
      document.getElementById('inboxiq-draft-output').style.display = 'block';
    } catch (err) {
      // Issue 2: check for stale extension; Issue 3: show error in panel
      if (err.message === 'STALE_EXTENSION' || err.message?.includes('Extension context')) {
        showStaleExtensionError();
        return;
      }
      const errEl = document.createElement('p');
      errEl.style.cssText = 'color:#EF4444; font-size:12px; margin-top:8px';
      errEl.textContent = err.message || 'Error drafting reply';
      document.getElementById('inboxiq-body')?.appendChild(errEl);
    }
    document.getElementById('inboxiq-draft-btn').textContent = '✍️ Draft Reply';
    document.getElementById('inboxiq-draft-btn').disabled = false;
  });

  document.getElementById('inboxiq-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('inboxiq-draft-text').value);
    document.getElementById('inboxiq-copy-btn').textContent = '✅ Copied!';
    setTimeout(() => {
      document.getElementById('inboxiq-copy-btn').textContent = '📋 Copy to Clipboard';
    }, 2000);
  });

  document.getElementById('inboxiq-reset-btn').addEventListener('click', () => {
    document.getElementById('inboxiq-body').innerHTML = `
      <button id="inboxiq-analyse-btn" style="width:100%; padding:10px; background:#4F46E5; color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600">
        Analyse this email
      </button>
    `;
    document.getElementById('inboxiq-analyse-btn').addEventListener('click', async () => {
      showLoading();
    });
  });
}

function showPanelError(message) {
  const body = document.getElementById('inboxiq-body');
  if (!body) return;
  const err = document.createElement('p');
  err.style.cssText = 'color:#EF4444; font-size:12px; margin-top:8px';
  err.textContent = message;
  body.appendChild(err);
}

function updateMoveBadge(success, errorMsg) {
  const badge = document.getElementById('inboxiq-move-badge');
  if (!badge) return;
  if (success) {
    badge.style.background = '#10B981';
    badge.textContent = '📁 Moved';
  } else {
    badge.style.background = '#EF4444';
    badge.textContent = '📁 Failed';
    if (errorMsg) showPanelError(errorMsg);
  }
}

async function moveEmailToLabel(token, labelName) {
  try {
    // Step 1: Get email subject from DOM
    const subject =
      document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
      document.querySelector('[role="main"] h2')?.textContent?.trim();
    console.log('InboxIQ: Subject found:', subject);
    if (!subject) {
      updateMoveBadge(false, "Couldn't detect email — try refreshing");
      return;
    }

    // Step 2: Search Gmail API for the message by subject
    const searchRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=subject:${encodeURIComponent(subject)}&maxResults=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    console.log('InboxIQ: Search result:', searchData);
    const messageId = searchData.messages?.[0]?.id;
    if (!messageId) {
      updateMoveBadge(false, "Couldn't find email via Gmail API");
      return;
    }

    // Step 3: Get the threadId from the message
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=minimal`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgData = await msgRes.json();
    console.log('InboxIQ: Message data:', msgData);
    const threadId = msgData.threadId;
    if (!threadId) {
      updateMoveBadge(false, "Couldn't get thread ID");
      return;
    }
    console.log('InboxIQ: Real API Thread ID:', threadId);

    // Step 4: Resolve or create the label
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/labels`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    let labelObj = listData.labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());

    if (!labelObj) {
      const createRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/labels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: labelName })
        }
      );
      labelObj = await createRes.json();
    }
    console.log('InboxIQ: Label object:', labelObj);

    // Step 5: Check if label is already applied
    const threadRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=minimal`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const threadData = await threadRes.json();
    const alreadyLabelled = threadData.messages?.some(
      msg => msg.labelIds?.includes(labelObj.id)
    );
    if (alreadyLabelled) {
      const badge = document.getElementById('inboxiq-move-badge');
      if (badge) {
        badge.style.background = '#6366F1';
        badge.textContent = '📁 Already labelled';
      }
      return;
    }

    // Step 6: Apply label to the thread
    const applyRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ addLabelIds: [labelObj.id] })
      }
    );

    if (applyRes.ok) {
      console.log('InboxIQ: Label applied successfully!');
      updateMoveBadge(true);
    } else {
      const errText = await applyRes.text();
      console.error('InboxIQ: Label apply failed', applyRes.status, errText);
      if (applyRes.status === 401 || applyRes.status === 403) {
        updateMoveBadge(false, 'Please re-authorize InboxIQ');
      } else {
        updateMoveBadge(false, "Couldn't move email to label");
      }
    }
  } catch (err) {
    console.error('InboxIQ: moveEmailToLabel error', err);
    updateMoveBadge(false, "Couldn't move email to label");
  }
}

function showHighPriorityBadge(highPriorityEmails) {
  const existing = document.getElementById('inboxiq-priority-badge');
  if (existing) existing.remove();
  const existingDrop = document.getElementById('inboxiq-priority-dropdown');
  if (existingDrop) existingDrop.remove();

  const badge = document.createElement('div');
  badge.id = 'inboxiq-priority-badge';
  badge.style.cssText = `
    position: fixed;
    top: 16px;
    right: 24px;
    background: #EF4444;
    color: white;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    z-index: 99999;
    box-shadow: 0 2px 8px rgba(239,68,68,0.4);
    user-select: none;
  `;
  badge.textContent = `🔴 ${highPriorityEmails.length} High Priority`;

  const dropdown = document.createElement('div');
  dropdown.id = 'inboxiq-priority-dropdown';
  dropdown.style.cssText = `
    display: none;
    position: fixed;
    top: 48px;
    right: 24px;
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    z-index: 99999;
    min-width: 280px;
    max-width: 360px;
    padding: 8px 0;
  `;

  highPriorityEmails.forEach(email => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 14px; font-size:12px; color:#111827; border-bottom:1px solid #F3F4F6;';
    item.innerHTML = `
      <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${email.subject}</div>
      ${email.priority_reason ? `<div style="color:#6B7280; font-size:11px; margin-top:2px">⏰ ${email.priority_reason}</div>` : ''}
    `;
    dropdown.appendChild(item);
  });

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  }, { capture: true });

  document.body.appendChild(badge);
  document.body.appendChild(dropdown);
}

let autoLabelDone = false;

function triggerAutoLabel() {
  if (autoLabelDone) return;
  if (!chrome.runtime?.id) return;
  autoLabelDone = true;
  chrome.runtime.sendMessage({ type: 'AUTO_LABEL' }, (response) => {
    if (response?.success && response.highPriority?.length > 0) {
      showHighPriorityBadge(response.highPriority);
    }
  });
}

// Trigger once 3 seconds after Gmail loads
setTimeout(triggerAutoLabel, 3000);

const observer = new MutationObserver(() => {
  const emailOpen = document.querySelector('.a3s.aiL') || document.querySelector('.a3s');
  if (emailOpen) {
    injectButton();
  } else {
    removeExistingBtn();
    removeExistingPanel();
  }
});

observer.observe(document.body, { childList: true, subtree: true });