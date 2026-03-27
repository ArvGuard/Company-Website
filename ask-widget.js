/* ArvGuard Ask Widget — ask-widget.js
   Calls your backend proxy at /api/ask
   No API key in this file. Key lives in backend env only.
*/
(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────
  const API_URL = 'https://api.arvguard.com/api/ask';
  const SIGNUP_URL = 'https://app.arvguard.com';

  const SUGGESTIONS = [
    'What happens to my Google account when I die?',
    'What is a digital executor?',
    'How does ArvGuard protect my family?',
    'Is my data secure?',
  ];

  const WELCOME = 'Hi! I can answer questions about digital estate planning — what happens to accounts when someone dies, what a digital executor does, or how ArvGuard works. What\'s on your mind?';

  // ── STATE ────────────────────────────────────────────────
  let isOpen = false;
  let isListening = false;
  let history = [];
  let recognition = null;
  let vizInterval = null;

  // ── BUILD HTML ───────────────────────────────────────────
  function buildWidget() {
    const container = document.getElementById('arvguard-ask-widget-container');
    if (!container) return;

    container.innerHTML = `
      <!-- Floating button -->
      <div id="ag-ask-btn" role="button" aria-label="Ask ArvGuard" tabindex="0">
        <svg viewBox="0 0 28 28" fill="none">
          <rect x="10" y="4" width="8" height="13" rx="4" fill="#38bdf8"/>
          <path d="M6 14a8 8 0 0016 0" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="14" y1="22" x2="14" y2="25" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="10" y1="25" x2="18" y2="25" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="22" cy="6" r="2" fill="#34d399"/>
        </svg>
        <div class="ag-btn-label">Ask ArvGuard ✦</div>
      </div>

      <!-- Panel -->
      <div id="ag-widget" role="dialog" aria-label="ArvGuard Assistant">
        <div class="ag-header">
          <div class="ag-logo">
            <div class="ag-ld"></div><div class="ag-ld d2"></div><div class="ag-ld d3"></div>
            <div class="ag-ld"></div><div class="ag-ld d5"></div><div class="ag-ld d6"></div>
            <div class="ag-ld"></div><div class="ag-ld d8"></div><div class="ag-ld d9"></div>
          </div>
          <div>
            <div class="ag-title">Arv<span>Guard</span></div>
            <div class="ag-sub">Estate planning assistant · Voice or text</div>
          </div>
          <div class="ag-close" id="ag-close" role="button" aria-label="Close">✕</div>
        </div>

        <div class="ag-status">
          <div class="ag-dot" id="ag-dot"></div>
          <span id="ag-status-text">Ask me anything about digital estate planning</span>
        </div>

        <div class="ag-messages" id="ag-messages">
          <div class="ag-msg ai">
            <div class="ag-avatar">✦</div>
            <div class="ag-bubble">${WELCOME}</div>
          </div>
        </div>

        <div class="ag-viz" id="ag-viz">
          ${Array.from({length:12},(_,i)=>`<div class="ag-vbar" id="ag-vb${i+1}"></div>`).join('')}
        </div>

        <div class="ag-suggestions" id="ag-sugs">
          ${SUGGESTIONS.map(q=>`<div class="ag-sug" role="button" tabindex="0">${q}</div>`).join('')}
        </div>

        <div class="ag-controls">
          <input class="ag-input" id="ag-input" type="text"
            placeholder="Ask a question..." autocomplete="off" />
          <div class="ag-mic" id="ag-mic" role="button" aria-label="Voice input" tabindex="0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/>
              <path d="M2 8a6 6 0 0012 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="8" y1="14" x2="8" y2="15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5" y1="15.5" x2="11" y2="15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <button class="ag-send" id="ag-send" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M13 7L1 1l2 6-2 6 12-6z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    bindEvents();
    initSpeechRecognition();
  }

  // ── EVENTS ───────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('ag-ask-btn').addEventListener('click', toggle);
    document.getElementById('ag-close').addEventListener('click', toggle);
    document.getElementById('ag-send').addEventListener('click', sendText);
    document.getElementById('ag-mic').addEventListener('click', toggleMic);

    const input = document.getElementById('ag-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
    });

    document.getElementById('ag-sugs').addEventListener('click', e => {
      const sug = e.target.closest('.ag-sug');
      if (sug) ask(sug.textContent);
    });
  }

  // ── TOGGLE ───────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen;
    document.getElementById('ag-widget').classList.toggle('ag-open', isOpen);
    if (isOpen) document.getElementById('ag-input').focus();
  }

  // ── STATUS ───────────────────────────────────────────────
  function setStatus(state, text) {
    const dot = document.getElementById('ag-dot');
    dot.className = 'ag-dot' + (state ? ' ' + state : '');
    document.getElementById('ag-status-text').textContent = text;
  }

  // ── MESSAGES ─────────────────────────────────────────────
  function addMessage(role, text, cta) {
    const msgs = document.getElementById('ag-messages');

    // Remove typing indicator
    const typing = msgs.querySelector('.ag-typing-wrap');
    if (typing) typing.remove();

    const wrap = document.createElement('div');
    wrap.className = `ag-msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'ag-avatar';
    avatar.textContent = role === 'ai' ? '✦' : '↑';

    const bubble = document.createElement('div');
    bubble.className = 'ag-bubble';
    bubble.innerHTML = text.replace(/\n/g, '<br>');

    if (cta) {
      const btn = document.createElement('div');
      btn.className = 'ag-cta-btn';
      btn.textContent = 'Start free trial →';
      btn.addEventListener('click', () => window.open(SIGNUP_URL, '_blank'));
      bubble.appendChild(document.createElement('br'));
      bubble.appendChild(btn);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;

    if (role === 'user') {
      document.getElementById('ag-sugs').style.display = 'none';
    }
  }

  function showTyping() {
    const msgs = document.getElementById('ag-messages');
    const wrap = document.createElement('div');
    wrap.className = 'ag-msg ai ag-typing-wrap';
    wrap.innerHTML = `<div class="ag-avatar">✦</div>
      <div class="ag-typing"><span></span><span></span><span></span></div>`;
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── SEND TEXT ────────────────────────────────────────────
  function sendText() {
    const input = document.getElementById('ag-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text);
  }

  // ── ASK ──────────────────────────────────────────────────
  async function ask(userMessage) {
    addMessage('user', userMessage);
    history.push({ role: 'user', text: userMessage });
    setStatus('thinking', 'Thinking...');
    showTyping();

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: history.slice(-10)
        })
      });

      const data = await resp.json();
      const reply = data.reply || "I'm having trouble right now. Please try again in a moment.";

      history.push({ role: 'model', text: reply });

      const showCTA = history.length >= 6 ||
        /trial|sign up|get started|try arvguard/i.test(reply);

      addMessage('ai', reply, showCTA);
      setStatus('', 'Ask me anything about digital estate planning');

      // Speak response
      speak(reply);

    } catch (err) {
      console.error('[ArvGuard widget]', err);
      const msgs = document.getElementById('ag-messages');
      const typing = msgs.querySelector('.ag-typing-wrap');
      if (typing) typing.remove();
      addMessage('ai', "I'm having trouble connecting. Please try again in a moment.");
      setStatus('', 'Ask me anything about digital estate planning');
    }
  }

  // ── SPEECH SYNTHESIS ────────────────────────────────────
  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/<[^>]*>/g, '').substring(0, 350);
    const utt = new SpeechSynthesisUtterance(clean);
    utt.rate = 0.95; utt.pitch = 1.0; utt.volume = 0.85;
    const voices = speechSynthesis.getVoices();
    const pref = voices.find(v =>
      v.name.includes('Samantha') || v.name.includes('Karen') ||
      v.name.includes('Google US') || (v.lang === 'en-US' && !v.name.includes('compact'))
    );
    if (pref) utt.voice = pref;
    utt.onstart = () => setStatus('speaking', 'Speaking...');
    utt.onend   = () => setStatus('', 'Ask me anything about digital estate planning');
    speechSynthesis.speak(utt);
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // ── SPEECH RECOGNITION ──────────────────────────────────
  function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = e => {
      const transcript = e.results[0][0].transcript;
      ask(transcript);
    };

    recognition.onerror = () => {
      setStatus('', 'Could not hear that — please type your question');
      stopListeningUI();
    };

    recognition.onend = () => stopListeningUI();
  }

  function toggleMic() {
    if (isListening) {
      if (recognition) recognition.stop();
      stopListeningUI();
    } else {
      if (!recognition) {
        setStatus('', 'Voice not supported in this browser — please type');
        return;
      }
      isListening = true;
      document.getElementById('ag-mic').classList.add('active');
      document.getElementById('ag-viz').classList.add('show');
      setStatus('listening', 'Listening... tap mic to stop');
      vizInterval = setInterval(animateViz, 80);
      recognition.start();
    }
  }

  function stopListeningUI() {
    isListening = false;
    document.getElementById('ag-mic').classList.remove('active');
    document.getElementById('ag-viz').classList.remove('show');
    clearInterval(vizInterval);
    resetViz();
  }

  function animateViz() {
    for (let i = 1; i <= 12; i++) {
      const bar = document.getElementById(`ag-vb${i}`);
      if (bar) {
        bar.style.height = (4 + Math.random() * 32) + 'px';
        bar.style.opacity = 0.35 + Math.random() * 0.65;
      }
    }
  }

  function resetViz() {
    for (let i = 1; i <= 12; i++) {
      const bar = document.getElementById(`ag-vb${i}`);
      if (bar) { bar.style.height = '4px'; bar.style.opacity = '0.35'; }
    }
  }

  // ── INIT ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
  } else {
    buildWidget();
  }

})();
