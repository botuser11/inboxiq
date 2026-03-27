chrome.runtime.onInstalled.addListener(() => {
  console.log('InboxIQ installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'API_CALL') {
    fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body)
    })
      .then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            if (res.status === 429) {
              throw new Error('Rate limit reached — try again later');
            }
            if (res.status === 500 && text.includes('OpenRouter error')) {
              throw new Error('AI service error — try again in a moment');
            }
            throw new Error(`HTTP ${res.status}: ${text}`);
          });
        }
        return res.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => {
        console.error('InboxIQ background fetch error:', err);
        const msg = (err.message === 'Failed to fetch' || err.message.includes('ERR_CONNECTION_REFUSED'))
          ? 'Backend not running — start the server on port 8000'
          : err.message;
        sendResponse({ success: false, error: msg });
      });
    return true;
  }

  if (request.type === 'GET_AUTH_TOKEN') {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'No token' });
      } else {
        sendResponse({ success: true, token });
      }
    });
    return true;
  }

  if (request.type === 'AUTO_LABEL') {
    (async () => {
      try {
        console.log('InboxIQ AUTO_LABEL: started');

        // Get token non-interactively — don't prompt user on page load
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (t) => {
            if (chrome.runtime.lastError || !t) reject(new Error('No cached token'));
            else resolve(t);
          });
        });
        console.log('InboxIQ AUTO_LABEL: token obtained:', !!token);

        // Load already-processed message IDs
        const stored = await new Promise(resolve =>
          chrome.storage.local.get(['processedIds'], resolve)
        );
        const processedIds = new Set(stored.processedIds || []);

        // Fetch unread emails from last 24h
        const listRes = await fetch(
          'https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread newer_than:1d&maxResults=15',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const listData = await listRes.json();
        const allMessages = listData.messages || [];
        console.log('InboxIQ AUTO_LABEL: found messages:', allMessages.length);

        const newMessages = allMessages.filter(m => !processedIds.has(m.id));
        console.log('InboxIQ AUTO_LABEL: new emails to process:', newMessages.length);

        if (newMessages.length === 0) {
          sendResponse({ success: true, highPriority: [] });
          return;
        }

        // Fetch subject + snippet + threadId in parallel
        const metas = await Promise.all(
          newMessages.map(m =>
            fetch(
              `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject`,
              { headers: { Authorization: `Bearer ${token}` } }
            ).then(r => r.json())
          )
        );

        const emailsForBatch = metas.map(meta => ({
          id: meta.id,
          subject: meta.payload?.headers?.find(h => h.name === 'Subject')?.value || '(no subject)',
          snippet: meta.snippet || ''
        }));

        // Single AI call for all emails
        const batchRes = await fetch('https://inboxiq-production-6007.up.railway.app/batch-analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: emailsForBatch })
        }).catch(() => { throw new Error('Backend not running — start the server on port 8000'); });
        if (!batchRes.ok) {
          if (batchRes.status === 429) throw new Error('Rate limit reached — try again later');
          if (batchRes.status === 500) throw new Error('AI service error — try again in a moment');
          throw new Error(`Backend error ${batchRes.status}`);
        }
        const batchData = await batchRes.json();
        const results = batchData.results || [];
        console.log('InboxIQ AUTO_LABEL: batch results:', batchData);

        // Fetch labels list once, cache for reuse
        const labelsRes = await fetch(
          'https://www.googleapis.com/gmail/v1/users/me/labels',
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const labelsData = await labelsRes.json();
        let labelsList = labelsData.labels || [];

        // Apply labels to each thread
        for (const result of results) {
          const meta = metas.find(m => m.id === result.id);
          if (!meta) continue;
          const threadId = meta.threadId;
          console.log('InboxIQ AUTO_LABEL: applying label', result.label, 'to thread', threadId);

          let labelObj = labelsList.find(l => l.name.toLowerCase() === result.label.toLowerCase());
          if (!labelObj) {
            const createRes = await fetch(
              'https://www.googleapis.com/gmail/v1/users/me/labels',
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: result.label })
              }
            );
            labelObj = await createRes.json();
            labelsList.push(labelObj);
          }

          const applyRes = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ addLabelIds: [labelObj.id] })
            }
          );
          if (applyRes.ok) {
            console.log('InboxIQ AUTO_LABEL: label applied successfully');
          } else {
            console.error('InboxIQ AUTO_LABEL: label apply failed', applyRes.status, await applyRes.text());
          }
        }

        // Save processed IDs (cap at 500 to prevent unbounded growth)
        const updatedIds = [...processedIds, ...newMessages.map(m => m.id)].slice(-500);
        await new Promise(resolve => chrome.storage.local.set({ processedIds: updatedIds }, resolve));

        // Return high priority emails for badge
        const highPriority = results
          .filter(r => r.priority === 'High')
          .map(r => {
            const email = emailsForBatch.find(e => e.id === r.id);
            return {
              subject: email?.subject || '(no subject)',
              priority_reason: r.priority_reason || ''
            };
          });

        sendResponse({ success: true, highPriority });
      } catch (err) {
        console.error('InboxIQ: AUTO_LABEL error', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_THREAD_CONTEXT') {
    (async () => {
      try {
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (t) => {
            if (chrome.runtime.lastError || !t) reject(new Error('No cached token'));
            else resolve(t);
          });
        });

        const subject = request.subject;
        if (!subject) {
          sendResponse({ success: false, error: 'No subject provided' });
          return;
        }

        // Find the message by subject
        const searchRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages?q=subject:${encodeURIComponent(subject)}&maxResults=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const searchData = await searchRes.json();
        const messageId = searchData.messages?.[0]?.id;
        if (!messageId) {
          sendResponse({ success: false, error: 'Message not found' });
          return;
        }

        // Get threadId
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=minimal`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const msgData = await msgRes.json();
        const threadId = msgData.threadId;
        if (!threadId) {
          sendResponse({ success: false, error: 'Thread ID not found' });
          return;
        }

        // Fetch full thread
        const threadRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const threadData = await threadRes.json();
        const messages = threadData.messages || [];

        if (messages.length <= 1) {
          sendResponse({ success: true, threadMessages: null, messageCount: messages.length });
          return;
        }

        // Helper: decode base64url body part
        function decodeBody(data) {
          if (!data) return '';
          try {
            return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
          } catch {
            return '';
          }
        }

        // Helper: extract plain text from message payload, strip HTML tags
        function extractText(payload) {
          if (!payload) return '';
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return decodeBody(payload.body.data);
          }
          if (payload.mimeType === 'text/html' && payload.body?.data) {
            const html = decodeBody(payload.body.data);
            return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              const text = extractText(part);
              if (text) return text;
            }
          }
          return payload.snippet || '';
        }

        // Take last 10 messages
        const recentMessages = messages.slice(-10);

        const formatted = recentMessages.map((msg, i) => {
          const headers = msg.payload?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          const body = extractText(msg.payload) || msg.snippet || '';
          const truncated = body.slice(0, 1000);
          return `[Message ${i + 1} - From: ${from}, Date: ${date}]\n${truncated}`;
        }).join('\n\n');

        sendResponse({ success: true, threadMessages: formatted, messageCount: messages.length });
      } catch (err) {
        console.error('InboxIQ: GET_THREAD_CONTEXT error', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});