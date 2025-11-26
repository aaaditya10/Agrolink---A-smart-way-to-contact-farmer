/**
 * agrolink app.js - consolidated, robust front-end
 * - Handles role selection, signup/login (OTP simulated), dashboards,
 *   listings, orders, chat (BroadcastChannel realtime), payments, admin.
 * - Safe to overwrite previous app.js versions.
 *
 * Usage: put this file next to index.html & style.css and open index.html.
 */

// === Utilities ===
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const byId = id => document.getElementById(id);
const LS_USERS = 'agrolink_users_v3';
const LS_LISTINGS = 'agrolink_listings_v3';
const LS_ORDERS = 'agrolink_orders_v3';
const LS_CHATS = 'agrolink_chats_v3';
const REALTIME_TAG_PREFIX = 'agrolink_realtime_';
const CHANNEL_NAME = 'agrolink_chat_channel';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch (e) { console.warn('parse err', key, e); return fallback; }
}
function saveJSON(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }

// safe show/hide
function show(id) { const el = byId(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = byId(id); if (el) el.classList.add('hidden'); }

// timestamp formatting
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return sameDay ? `${h12}:${mm} ${ampm}` : `${h12}:${mm} ${ampm} • ${d.toLocaleDateString()}`;
  } catch (e) { return ''; }
}

function escapeHtml(s='') {
  return s.replace(/[&<"']/g, m => ({'&':'&amp;','<':'&lt;','"':'&quot;',"'":'&#039;'}[m]));
}

// avatar helper
function avatarFor(phone) {
  const users = loadJSON(LS_USERS, {});
  const u = users[phone];
  let initials = phone ? phone.slice(-2) : '?';
  if (u && u.name) {
    const parts = u.name.trim().split(' ');
    initials = (parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '');
    initials = initials.toUpperCase();
  }
  const sum = (phone || '').split('').reduce((s,c)=> s + (parseInt(c)||0), 0);
  const color = `color-${sum % 6}`;
  return { initials, color };
}

// === Realtime channel (BroadcastChannel with localStorage fallback) ===
let bc = null;
try { if ('BroadcastChannel' in window) bc = new BroadcastChannel(CHANNEL_NAME); } catch(e){ bc = null; }

function sendRealtime(payload) {
  try {
    if (bc) { bc.postMessage(payload); }
    else {
      const key = REALTIME_TAG_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      localStorage.setItem(key, JSON.stringify(payload));
      setTimeout(() => localStorage.removeItem(key), 3000);
    }
  } catch(e) { console.warn('realtime send failed', e); }
}

function handleRealtimePayload(payload) {
  if (!payload) return;
  if (payload.type === 'new_message') {
    const chats = loadJSON(LS_CHATS, []);
    let chat = chats.find(c => c.id === payload.chatId);
    if (!chat) {
      // create minimal chat container
      chat = { id: payload.chatId, participants: payload.participants || [], title: payload.title || 'Chat', messages: [payload.message], lastMessage: payload.message.text.slice(0,50) };
      chats.push(chat);
    } else {
      const exists = chat.messages.some(m => m.id === payload.message.id);
      if (!exists) {
        chat.messages.push(payload.message);
        chat.lastMessage = payload.message.text.slice(0,50);
      }
    }
    saveJSON(LS_CHATS, chats);
    // If chat open and matches, re-render; else update dashboard previews
    if (payload.chatId === appState.currentChatId) renderChatThread();
    renderDashboardContent();
  }
}

if (bc) {
  bc.onmessage = ev => handleRealtimePayload(ev.data);
} else {
  window.addEventListener('storage', ev => {
    if (!ev.key) return;
    if (ev.key.startsWith(REALTIME_TAG_PREFIX) && ev.newValue) {
      try { handleRealtimePayload(JSON.parse(ev.newValue)); }
      catch(e) {}
    }
    if (ev.key === LS_CHATS && typeof renderChatThread === 'function') {
      // re-render if current chat displayed
      if (appState.currentChatId) renderChatThread();
      renderDashboardContent();
    }
  });
}

// === Application state ===
const appState = {
  selectedRole: null,
  currentUser: null,
  currentChatId: null,
  currentPaymentOrderId: null,
  lastOTP: null
};

// === DOM ready init ===
document.addEventListener('DOMContentLoaded', () => {
  console.log('agrolink: DOMContentLoaded');
  bindRoleButtons();
  bindAuthButtons();
  bindGlobalButtons();
  seedDemoData(); // ensure demo data present
  restoreSessionIfAny();
});

// === Bind role selection robustly (delegation) ===
function bindRoleButtons() {
  const grid = byId('role-grid') || $('.role-grid');
  if (!grid) { console.error('role grid not found'); return; }
  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest && ev.target.closest('.role-btn');
    if (!btn) return;
    const r = btn.dataset.role;
    if (!r) return;
    appState.selectedRole = r;
    const selTextEl = byId('selected-role'); if (selTextEl) selTextEl.innerText = `Selected role: ${r.toUpperCase()}`;
    show('signup-section'); hide('role-section');
    clearSignupForm();
  });
  // also ensure direct listeners (safe)
  $$('.role-btn').forEach(b => {
    b.removeEventListener('click', dummy); // no-op remove
    b.addEventListener('click', () => {});
  });
}

function dummy() {}

// === Auth bindings ===
function bindAuthButtons() {
  if (byId('back-to-role')) byId('back-to-role').addEventListener('click', () => { hide('signup-section'); show('role-section'); });
  if (byId('back-to-role2')) byId('back-to-role2').addEventListener('click', () => { hide('login-section'); show('role-section'); });
  if (byId('goto-login')) byId('goto-login').addEventListener('click', () => { hide('signup-section'); show('login-section'); });
  if (byId('to-signup')) byId('to-signup').addEventListener('click', () => { hide('login-section'); show('signup-section'); });

  if (byId('send-otp')) byId('send-otp').addEventListener('click', () => {
    const phone = (byId('phone') && byId('phone').value.trim()) || '';
    if (!phone || phone.length < 6) { alert('Enter valid phone'); return; }
    appState.lastOTP = (Math.floor(100000 + Math.random() * 900000)).toString();
    if (byId('otp-display')) byId('otp-display').innerText = appState.lastOTP;
    if (byId('otp-box')) show('otp-box');
    alert('Simulated OTP sent (displayed on page).');
  });

  if (byId('verify-otp')) byId('verify-otp').addEventListener('click', () => {
    const v = (byId('otp-input') && byId('otp-input').value.trim()) || '';
    if (!appState.lastOTP) return alert('Send OTP first');
    if (v === appState.lastOTP) { alert('Phone verified (simulated)'); if (byId('signup-btn')) show('signup-btn'); }
    else alert('Wrong OTP');
  });

  if (byId('signup-btn')) byId('signup-btn').addEventListener('click', () => {
    const user = {
      role: appState.selectedRole,
      name: (byId('name') && byId('name').value.trim()) || '',
      age: (byId('age') && byId('age').value.trim()) || '',
      phone: (byId('phone') && byId('phone').value.trim()) || '',
      password: (byId('password') && byId('password').value) || '',
      aadhar: (byId('aadhar') && byId('aadhar').value.trim()) || '',
      address: (byId('address') && byId('address').value.trim()) || '',
      verified: false, createdAt: new Date().toISOString()
    };
    if (!user.phone || !user.password || !user.name || !user.aadhar) return alert('Fill name, phone, password and aadhar.');
    const users = loadJSON(LS_USERS, {});
    if (users[user.phone]) return alert('User exists; login instead.');
    users[user.phone] = user; saveJSON(LS_USERS, users);
    alert('Signup done. Please login.');
    hide('signup-section'); show('login-section');
  });

  if (byId('login-btn')) byId('login-btn').addEventListener('click', () => {
    const phone = (byId('login-phone') && byId('login-phone').value.trim()) || '';
    const pass = (byId('login-password') && byId('login-password').value) || '';
    const users = loadJSON(LS_USERS, {});
    const u = users[phone];
    if (!u) return alert('User not found. Signup.');
    if (u.password !== pass) return alert('Incorrect password.');
    appState.currentUser = u;
    sessionStorage.setItem('agrolink_current_user', JSON.stringify(u));
    showDashboardForUser();
  });
}

// === Global binds (logout, chat, payment back) ===
function bindGlobalButtons() {
  if (byId('logout-btn')) byId('logout-btn').addEventListener('click', () => {
    appState.currentUser = null;
    sessionStorage.removeItem('agrolink_current_user');
    hide('dashboard'); show('role-section');
  });
  if (byId('chat-back')) byId('chat-back').addEventListener('click', () => { appState.currentChatId = null; hide('chat-section'); showDashboardForUser(); } );
  if (byId('payment-back')) byId('payment-back').addEventListener('click', () => { appState.currentPaymentOrderId = null; hide('payment-section'); showDashboardForUser(); } );
  if (byId('chat-send-btn')) byId('chat-send-btn').addEventListener('click', () => {
    const editor = byId('editor');
    if (!editor) return;
    const text = editor.innerText.trim();
    if (!text) return;
    sendMessageFromEditor(text);
    editor.innerText = '';
  });
  // editor Enter behaviour
  const editor = byId('editor');
  if (editor) editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = editor.innerText.trim(); if (t) { sendMessageFromEditor(t); editor.innerText = ''; } }
  });

  if (byId('pay-now')) byId('pay-now').addEventListener('click', payNowHandler);
  if (byId('simulate-fail')) byId('simulate-fail').addEventListener('click', () => { if (byId('payment-result')) byId('payment-result').innerText = 'Payment failed (simulated)'; });
}

// === Session restore ===
function restoreSessionIfAny() {
  const sess = sessionStorage.getItem('agrolink_current_user');
  if (sess) {
    try {
      appState.currentUser = JSON.parse(sess);
      showDashboardForUser();
    } catch (e) { console.warn('invalid session'); }
  }
}

// === Dashboard rendering switch ===
function showDashboardForUser() {
  if (!appState.currentUser) return;
  hide('role-section'); hide('signup-section'); hide('login-section'); hide('chat-section'); hide('payment-section');
  show('dashboard');
  const title = byId('dashboard-title'); if (title) title.innerText = `${appState.currentUser.role.toUpperCase()} DASHBOARD`;
  const meta = byId('user-meta'); if (meta) meta.innerText = `${appState.currentUser.name || ''} • ${appState.currentUser.phone} ${appState.currentUser.verified ? '• Verified' : '• Not verified'}`;
  renderDashboardContent();
}

// Expose renderDashboardContent to other modules (re-used by realtime handlers)
window.renderDashboardContent = renderDashboardContent;

function renderDashboardContent() {
  const user = appState.currentUser;
  if (!user) return;
  const container = byId('dashboard-content');
  if (!container) return;
  container.innerHTML = ''; // clear

  if (user.role === 'farmer') return renderFarmerDashboard();
  if (user.role === 'retailer' || user.role === 'buyer') return renderMarketplaceDashboard();
  if (user.role === 'logistics') return renderLogisticsDashboard();
  if (user.role === 'admin') return renderAdminDashboard();

  // fallback (should not happen)
  container.innerHTML = `<div class="widget"><h3>Welcome</h3><p class="small muted">Logged in as ${user.name || user.phone} (${user.role})</p></div>`;
}

// === Farmer Dashboard ===
function renderFarmerDashboard() {
  const content = byId('dashboard-content');
  content.innerHTML = '';

  // left column (create listing, my listings, orders)
  const left = document.createElement('div');

  const createWidget = document.createElement('div');
  createWidget.className = 'widget';
  createWidget.innerHTML = `
    <h3>Create Crop Listing</h3>
    <div class="form-grid">
      <input id="f-crop" placeholder="Crop name (eg. Wheat)" />
      <input id="f-qty" placeholder="Quantity (kg)" />
      <input id="f-price" placeholder="Price per unit" />
      <input id="f-quality" placeholder="Quality (Good/Avg/Poor)" />
    </div>
    <div style="margin-top:8px;">
      <button id="publish-listing" class="primary">Publish Listing</button>
    </div>
    <p class="small muted">Listings are visible to buyers in Marketplace (demo).</p>`;
  left.appendChild(createWidget);

  const myListWidget = document.createElement('div');
  myListWidget.className = 'widget';
  myListWidget.innerHTML = `<h3>My Listings</h3><div id="my-listings-area"></div>`;
  left.appendChild(myListWidget);

  const ordersWidget = document.createElement('div');
  ordersWidget.className = 'widget';
  ordersWidget.innerHTML = `<h3>Orders Received</h3><div id="farmer-orders-area"></div>`;
  left.appendChild(ordersWidget);

  content.appendChild(left);

  // right column (chats)
  const right = document.createElement('div');
  right.className = 'widget';
  right.innerHTML = `<h3>Messages</h3><div id="farmer-chats"></div>`;
  content.appendChild(right);

  // attach publish handler
  if (byId('publish-listing')) byId('publish-listing').addEventListener('click', () => {
    const crop = (byId('f-crop') && byId('f-crop').value.trim()) || '';
    const qty = (byId('f-qty') && byId('f-qty').value.trim()) || '';
    const price = (byId('f-price') && byId('f-price').value.trim()) || '';
    const quality = (byId('f-quality') && byId('f-quality').value.trim()) || 'Good';
    if (!crop || !qty || !price) return alert('Fill crop, qty and price.');
    const listings = loadJSON(LS_LISTINGS, []);
    const l = { id: Date.now().toString(), farmerPhone: appState.currentUser.phone, crop, qty, price, quality, status: 'published', createdAt: new Date().toISOString() };
    listings.unshift(l); saveJSON(LS_LISTINGS, listings);
    alert('Listing published (demo).');
    renderDashboardContent();
  });

  // populate my listings
  const allListings = loadJSON(LS_LISTINGS, []);
  const mine = allListings.filter(x => x.farmerPhone === appState.currentUser.phone);
  const myListingsArea = byId('my-listings-area');
  if (!mine.length) myListingsArea.innerHTML = '<p class="small muted">No listings yet</p>';
  else {
    let html = `<table class="table"><thead><tr><th>Crop</th><th>Qty</th><th>Price</th><th>Quality</th><th>Actions</th></tr></thead><tbody>`;
    mine.forEach(l => {
      html += `<tr><td>${escapeHtml(l.crop)}</td><td>${escapeHtml(l.qty)}</td><td>${escapeHtml(l.price)}</td><td>${escapeHtml(l.quality)}</td>
        <td><button class="small" onclick="editListing('${l.id}')">Edit</button> <button class="small" onclick="removeListing('${l.id}')">Remove</button></td></tr>`;
    });
    html += '</tbody></table>';
    myListingsArea.innerHTML = html;
  }

  // farmer orders
  const orders = loadJSON(LS_ORDERS, []);
  const myOrders = orders.filter(o => o.sellerPhone === appState.currentUser.phone);
  const farmerOrdersArea = byId('farmer-orders-area');
  if (!myOrders.length) farmerOrdersArea.innerHTML = '<p class="small muted">No orders yet</p>';
  else {
    let html = '';
    myOrders.forEach(o => {
      html += `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(o.crop)} • ${escapeHtml(o.qty)}kg</strong>
        <div class="small">Buyer: ${escapeHtml(o.buyerPhone)} • Status: ${escapeHtml(o.status)}</div>
        <div style="margin-top:6px">${ o.status === 'placed' ? `<button onclick="confirmOrder('${o.id}')">Confirm</button>` : '' } <button onclick="openChat('${o.chatId || ''}')">Open Chat</button></div>
      </div>`;
    });
    farmerOrdersArea.innerHTML = html;
  }

  // farmer chats
  const chats = loadJSON(LS_CHATS, []);
  const farmerChats = chats.filter(c => c.participants.includes(appState.currentUser.phone));
  const farmerChatsArea = byId('farmer-chats');
  if (!farmerChats.length) farmerChatsArea.innerHTML = '<p class="small muted">No conversations</p>';
  else {
    farmerChatsArea.innerHTML = farmerChats.map(c => `<div style="padding:6px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(c.title)}</strong>
      <div class="small">${escapeHtml(c.lastMessage || '')}</div>
      <div style="margin-top:6px"><button onclick="openChat('${c.id}')">Open Chat</button></div></div>`).join('');
  }
}

// allow inline calls expected by HTML
window.editListing = function(listingId) {
  const listings = loadJSON(LS_LISTINGS, []);
  const item = listings.find(x => x.id === listingId);
  if (!item) return alert('Listing not found');
  const newPrice = prompt('Set new price', item.price);
  if (newPrice) { item.price = newPrice; saveJSON(LS_LISTINGS, listings); alert('Price updated'); renderDashboardContent(); }
};
window.removeListing = function(listingId) {
  if (!confirm('Remove this listing?')) return;
  let listings = loadJSON(LS_LISTINGS, []);
  listings = listings.filter(l => l.id !== listingId);
  saveJSON(LS_LISTINGS, listings);
  alert('Removed');
  renderDashboardContent();
};

window.confirmOrder = function(orderId) {
  const orders = loadJSON(LS_ORDERS, []);
  const o = orders.find(x => x.id === orderId);
  if (!o) return alert('Order not found');
  o.status = 'confirmed';
  saveJSON(LS_ORDERS, orders);
  alert('Order confirmed. Buyer can pay now.');
  renderDashboardContent();
};

// === Marketplace (Retailer/Buyer) ===
function renderMarketplaceDashboard() {
  const container = byId('dashboard-content');
  container.innerHTML = '';

  const left = document.createElement('div');
  const searchWidget = document.createElement('div'); searchWidget.className = 'widget';
  searchWidget.innerHTML = `<h3>Marketplace</h3>
    <input id="search-key" placeholder="Search crop or farmer phone" />
    <div style="margin-top:8px;"><label class="small">Min price</label><input id="min-price" placeholder="Min price" /></div>
    <div style="margin-top:8px;"><button id="search-btn" class="primary">Search</button></div>`;
  left.appendChild(searchWidget);

  const listingsWidget = document.createElement('div'); listingsWidget.className = 'widget';
  listingsWidget.innerHTML = `<h3>Listings</h3><div id="market-listings"></div>`;
  left.appendChild(listingsWidget);

  const right = document.createElement('div'); right.className = 'widget';
  right.innerHTML = `<h3>My Orders & Chats</h3><div id="buyer-orders"></div><div id="buyer-chats" style="margin-top:10px"></div>`;

  container.appendChild(left); container.appendChild(right);

  const renderListings = (filter = {}) => {
    const listings = loadJSON(LS_LISTINGS, []);
    let filtered = listings.filter(l => l.status === 'published');
    if (filter.q) filtered = filtered.filter(l => l.crop.toLowerCase().includes(filter.q.toLowerCase()) || (l.farmerPhone||'').includes(filter.q));
    if (filter.minPrice) filtered = filtered.filter(l => Number(l.price) >= Number(filter.minPrice));
    const area = byId('market-listings');
    if (!filtered.length) return area.innerHTML = '<p class="small muted">No listings found</p>';
    area.innerHTML = filtered.map(l => `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(l.crop)}</strong> • ${escapeHtml(l.qty)}kg • ₹${escapeHtml(l.price)} • <span class="small">Farmer: ${escapeHtml(l.farmerPhone||'-')}</span>
      <div style="margin-top:6px"><button onclick="placeOrder('${l.id}')">Place Order</button> <button onclick="openChatForListing('${l.id}')">Chat</button></div></div>`).join('');
  };

  if (byId('search-btn')) byId('search-btn').addEventListener('click', () => {
    const q = byId('search-key').value.trim(); const min = byId('min-price').value.trim();
    renderListings({ q, minPrice: min });
  });
  renderListings();

  // buyer orders & chats
  const myOrders = loadJSON(LS_ORDERS, []).filter(o => o.buyerPhone === appState.currentUser.phone);
  const buyerOrdersArea = byId('buyer-orders');
  buyerOrdersArea.innerHTML = myOrders.length ? myOrders.map(o => `<div style="padding:6px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(o.crop)}</strong>
    <div class="small">Qty:${escapeHtml(o.qty)} • Seller:${escapeHtml(o.sellerPhone)} • Status:${escapeHtml(o.status)}</div>
    <div style="margin-top:6px">${ o.status === 'confirmed' ? `<button onclick="startPayment('${o.id}')">Pay Now</button>` : '' } <button onclick="openChat('${o.chatId || ''}')">Open Chat</button></div></div>`).join('') : '<p class="small muted">No orders placed</p>';

  const chats = loadJSON(LS_CHATS, []).filter(c => c.participants.includes(appState.currentUser.phone));
  const buyerChatsArea = byId('buyer-chats');
  buyerChatsArea.innerHTML = chats.length ? chats.map(c => `<div style="padding:6px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(c.title)}</strong><div class="small">${escapeHtml(c.lastMessage||'')}</div><div style="margin-top:6px"><button onclick="openChat('${c.id}')">Open Chat</button></div></div>`).join('') : '<p class="small muted">No conversations</p>';
}

window.placeOrder = function(listingId) {
  const listings = loadJSON(LS_LISTINGS, []);
  const l = listings.find(x => x.id === listingId);
  if (!l) return alert('Listing not found');
  const qty = prompt('Enter quantity (kg)', l.qty);
  if (!qty) return;
  // create or reuse chat between buyer & seller
  const participants = [appState.currentUser.phone, l.farmerPhone].sort();
  const chats = loadJSON(LS_CHATS, []);
  let chat = chats.find(c => c.participants.join('|') === participants.join('|'));
  if (!chat) { chat = { id: Date.now().toString(), participants, title: `Chat: ${l.crop} • ${l.farmerPhone}`, messages: [], lastMessage: ''}; chats.push(chat); saveJSON(LS_CHATS, chats); }
  const orders = loadJSON(LS_ORDERS, []);
  const order = { id: Date.now().toString(), listingId, crop: l.crop, qty, price: l.price, buyerPhone: appState.currentUser.phone, sellerPhone: l.farmerPhone, status: 'placed', chatId: chat.id, createdAt: new Date().toISOString() };
  orders.unshift(order); saveJSON(LS_ORDERS, orders);
  alert('Order placed (demo). Farmer will see it.');
  renderDashboardContent();
};

window.openChatForListing = function(listingId) {
  const listings = loadJSON(LS_LISTINGS, []);
  const l = listings.find(x => x.id === listingId);
  if (!l) return alert('Listing not found');
  const participants = [appState.currentUser.phone, l.farmerPhone].sort();
  const chats = loadJSON(LS_CHATS, []);
  let chat = chats.find(c => c.participants.join('|') === participants.join('|'));
  if (!chat) { chat = { id: Date.now().toString(), participants, title: `Chat: ${l.crop} • ${l.farmerPhone}`, messages: [], lastMessage: '' }; chats.push(chat); saveJSON(LS_CHATS, chats); }
  openChat(chat.id);
};

// === Chat page handling (pretty thread + BroadcastChannel realtime) ===
window.openChat = function(chatId) {
  if (!chatId) { alert('Chat not found'); return; }
  const chats = loadJSON(LS_CHATS, []);
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return alert('Chat not found');
  appState.currentChatId = chatId;
  hide('dashboard'); hide('signup-section'); hide('login-section'); hide('payment-section'); show('chat-section');
  const other = chat.participants.find(p => p !== appState.currentUser.phone) || chat.participants[0];
  const av = avatarFor(other);
  if (byId('chat-avatar')) { byId('chat-avatar').innerText = av.initials; byId('chat-avatar').className = `avatar-lg ${av.color}`; }
  if (byId('chat-title')) byId('chat-title').innerText = chat.title || 'Chat';
  if (byId('chat-meta')) byId('chat-meta').innerText = `Participants: ${chat.participants.join(', ')}`;
  renderChatThread();
};

function renderChatThread() {
  const chats = loadJSON(LS_CHATS, []);
  const chat = chats.find(c => c.id === appState.currentChatId);
  const thread = byId('chat-thread');
  if (!thread) return;
  thread.innerHTML = '';
  if (!chat || !chat.messages.length) { thread.innerHTML = `<div class="timestamp">No messages yet. Start the conversation.</div>`; thread.scrollTop = thread.scrollHeight; return; }
  chat.messages.forEach(m => {
    const row = document.createElement('div'); row.className = 'msg-row';
    const fromMe = m.from === appState.currentUser.phone;
    const av = avatarFor(m.from);
    const avatarEl = document.createElement('div'); avatarEl.className = `avatar ${av.color}`; avatarEl.innerText = av.initials;
    const bubble = document.createElement('div'); bubble.className = 'msg ' + (fromMe ? 'me' : 'them');
    bubble.innerHTML = `<div class="bubble-text">${escapeHtml(m.text)}</div><div class="msg-meta"><span class="small">${escapeHtml(m.from)}</span><span class="time">${fmtTime(m.at)}</span></div>`;
    if (fromMe) { row.appendChild(bubble); row.appendChild(avatarEl); } else { row.appendChild(avatarEl); row.appendChild(bubble); }
    thread.appendChild(row);
  });
  thread.scrollTop = thread.scrollHeight;
}

function sendMessageFromEditor(text) {
  const chats = loadJSON(LS_CHATS, []);
  const chat = chats.find(c => c.id === appState.currentChatId);
  if (!chat) return alert('Chat not found');
  const message = { id: 'm' + Date.now() + '_' + Math.random().toString(36).slice(2,6), from: appState.currentUser.phone, text, at: new Date().toISOString() };
  chat.messages = chat.messages || []; chat.messages.push(message); chat.lastMessage = `${appState.currentUser.phone}: ${text.slice(0,50)}`;
  saveJSON(LS_CHATS, chats);
  // broadcast to other tabs
  sendRealtime({ type: 'new_message', chatId: chat.id, message, participants: chat.participants, title: chat.title });
  renderChatThread();
  renderDashboardContent();
}

// Listen to BroadcastChannel or localStorage events (already handled globally above)
// but also listen to LS_CHATS storage to update thread if necessary
window.addEventListener('storage', (ev) => {
  if (!ev.key) return;
  if (ev.key === LS_CHATS) {
    if (appState.currentChatId) renderChatThread();
    renderDashboardContent();
  }
});

// === Logistics dashboard ===
function renderLogisticsDashboard() {
  const content = byId('dashboard-content');
  content.innerHTML = '';
  const container = document.createElement('div');
  const ordersWidget = document.createElement('div'); ordersWidget.className = 'widget';
  ordersWidget.innerHTML = `<h3>Assigned Orders</h3><div id="log-orders"></div>`;
  container.appendChild(ordersWidget);
  content.appendChild(container);

  const allOrders = loadJSON(LS_ORDERS, []);
  const relevant = allOrders.filter(o => ['confirmed','in-transit','paid'].includes(o.status));
  const logOrdersArea = byId('log-orders');
  if (!relevant.length) logOrdersArea.innerHTML = '<p class="small muted">No pickups assigned</p>';
  else logOrdersArea.innerHTML = relevant.map(o => `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(o.crop)}</strong>
    <div class="small">Seller:${escapeHtml(o.sellerPhone)} • Buyer:${escapeHtml(o.buyerPhone)} • Status:${escapeHtml(o.status)}</div>
    <div style="margin-top:6px">${ o.status === 'confirmed' ? `<button onclick="markPicked('${o.id}')">Mark Picked</button>` : '' } ${ o.status === 'in-transit' ? `<button onclick="markDelivered('${o.id}')">Mark Delivered</button>` : '' } ${ o.status === 'paid' ? `<button onclick="markPicked('${o.id}')">Mark Picked (paid)</button>` : '' }</div></div>`).join('');
}

window.markPicked = function(orderId) {
  const orders = loadJSON(LS_ORDERS, []); const o = orders.find(x=>x.id===orderId); if (!o) return alert('Order not found'); o.status = 'in-transit'; saveJSON(LS_ORDERS, orders); alert('Marked as picked (demo).'); renderDashboardContent();
};
window.markDelivered = function(orderId) {
  const orders = loadJSON(LS_ORDERS, []); const o = orders.find(x=>x.id===orderId); if (!o) return alert('Order not found'); o.status = 'delivered'; saveJSON(LS_ORDERS, orders); alert('Marked delivered (demo).'); renderDashboardContent();
};

// === Admin dashboard ===
function renderAdminDashboard() {
  const content = byId('dashboard-content'); content.innerHTML = '';
  const container = document.createElement('div');
  const usersWidget = document.createElement('div'); usersWidget.className = 'widget'; usersWidget.innerHTML = `<h3>Users</h3><div id="admin-users"></div>`; container.appendChild(usersWidget);
  const listWidget = document.createElement('div'); listWidget.className = 'widget'; listWidget.innerHTML = `<h3>All Listings</h3><div id="admin-listings"></div>`; container.appendChild(listWidget);
  const ordersWidget = document.createElement('div'); ordersWidget.className = 'widget'; ordersWidget.innerHTML = `<h3>All Orders</h3><div id="admin-orders"></div>`; container.appendChild(ordersWidget);
  content.appendChild(container);

  const users = loadJSON(LS_USERS, {}); const usersArea = byId('admin-users'); const keys = Object.keys(users);
  usersArea.innerHTML = !keys.length ? '<p class="small muted">No users</p>' : keys.map(k => { const u = users[k]; return `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(u.name||u.phone)}</strong><div class="small">${escapeHtml(u.role)} • ${escapeHtml(u.phone)} • ${u.verified? 'Verified' : 'Not verified'}</div><div style="margin-top:6px">${ u.verified ? '' : `<button onclick="verifyUser('${u.phone}')">Verify user</button>` } <button onclick="impersonate('${u.phone}')">Impersonate</button></div></div>`; }).join('');

  const listings = loadJSON(LS_LISTINGS, []); const listArea = byId('admin-listings');
  listArea.innerHTML = !listings.length ? '<p class="small muted">No listings</p>' : listings.map(l => `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(l.crop)}</strong><div class="small">Farmer:${escapeHtml(l.farmerPhone)} • Price:${escapeHtml(l.price)} • Status:${escapeHtml(l.status)}</div><div style="margin-top:6px;"><button onclick="removeListing('${l.id}')">Remove</button></div></div>`).join('');

  const orders = loadJSON(LS_ORDERS, []); const ordersArea = byId('admin-orders');
  ordersArea.innerHTML = !orders.length ? '<p class="small muted">No orders</p>' : orders.map(o => `<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(o.crop)}</strong><div class="small">Buyer:${escapeHtml(o.buyerPhone)} • Seller:${escapeHtml(o.sellerPhone)} • Status:${escapeHtml(o.status)}</div></div>`).join('');
}

window.verifyUser = function(phone) {
  const users = loadJSON(LS_USERS, {}); const u = users[phone]; if (!u) return alert('User not found'); u.verified = true; users[phone] = u; saveJSON(LS_USERS, users); alert('User verified (demo).'); renderDashboardContent();
};
window.impersonate = function(phone) {
  const users = loadJSON(LS_USERS, {}); if (!users[phone]) return alert('User not found'); sessionStorage.setItem('agrolink_current_user', JSON.stringify(users[phone])); appState.currentUser = users[phone]; alert(`Now impersonating ${phone}.`); showDashboardForUser();
};

// === Payment flow ===
window.startPayment = function(orderId) {
  const orders = loadJSON(LS_ORDERS, []); const o = orders.find(x => x.id === orderId); if (!o) return alert('Order not found');
  appState.currentPaymentOrderId = orderId;
  sessionStorage.setItem('agrolink_current_payment', orderId);
  hide('dashboard'); hide('chat-section'); show('payment-section');
  if (byId('payment-meta')) byId('payment-meta').innerText = `Order: ${o.crop} • Qty:${o.qty}kg • Amount: ₹${Number(o.price) * Number(o.qty || 1)}`;
  if (byId('payment-details')) byId('payment-details').innerText = `Paying ₹${Number(o.price) * Number(o.qty || 1)} to seller ${o.sellerPhone}`;
  if (byId('payment-result')) byId('payment-result').innerText = '';
};

function payNowHandler() {
  const orderId = sessionStorage.getItem('agrolink_current_payment') || appState.currentPaymentOrderId;
  if (!orderId) return alert('No payment target');
  const orders = loadJSON(LS_ORDERS, []); const o = orders.find(x => x.id === orderId); if (!o) return alert('Order not found');
  // simulate payment delay
  if (byId('payment-result')) byId('payment-result').innerText = 'Processing payment...';
  setTimeout(() => {
    o.status = 'paid';
    o.payment = { method: (byId('payment-method') && byId('payment-method').value) || 'upi', at: new Date().toISOString(), txnId: 'TXN' + Date.now() };
    saveJSON(LS_ORDERS, orders);
    if (byId('payment-result')) byId('payment-result').innerText = `Payment successful. Txn: ${o.payment.txnId}`;
    if (byId('payment-details')) byId('payment-details').innerHTML = `Receipt:<br><strong>Order:</strong> ${o.crop} • ${o.qty}kg<br><strong>Amount:</strong> ₹${Number(o.price) * Number(o.qty || 1)}<br><strong>Txn:</strong> ${o.payment.txnId}`;
    setTimeout(() => { sessionStorage.removeItem('agrolink_current_payment'); appState.currentPaymentOrderId = null; showDashboardForUser(); }, 1100);
  }, 900);
}

// === Seed demo data ===
function seedDemoData() {
  if (Object.keys(loadJSON(LS_USERS, {})).length === 0) {
    const demoUsers = {
      '9000000001': { phone: '9000000001', name: 'Ram Farmer', role: 'farmer', aadhar: '111122223333', verified: true, password: '1234' },
      '9000000002': { phone: '9000000002', name: 'Sita Retail', role: 'retailer', aadhar: '111122223334', verified: true, password: '1234' },
      '9000000003': { phone: '9000000003', name: 'Logistics One', role: 'logistics', aadhar: '111122223335', verified: true, password: '1234' },
      '9000000004': { phone: '9000000004', name: 'Admin User', role: 'admin', aadhar: '111122223336', verified: true, password: 'admin' }
    };
    saveJSON(LS_USERS, demoUsers);
  }
  if (loadJSON(LS_LISTINGS, []).length === 0) {
    saveJSON(LS_LISTINGS, [{ id: 'l1', farmerPhone: '9000000001', crop: 'Wheat', qty: '200', price: '1200', quality: 'Good', status: 'published', createdAt: new Date().toISOString() }]);
  }
  if (loadJSON(LS_CHATS, []).length === 0) {
    // leave empty; created when orders placed / users chat
    saveJSON(LS_CHATS, []);
  }
  if (loadJSON(LS_ORDERS, []).length === 0) {
    saveJSON(LS_ORDERS, []);
  }
}

// === Small debug helper to inspect storage quickly ===
window._agro_dbg = {
  users: () => loadJSON(LS_USERS, {}),
  listings: () => loadJSON(LS_LISTINGS, []),
  orders: () => loadJSON(LS_ORDERS, []),
  chats: () => loadJSON(LS_CHATS, [])
};

console.log('agrolink app.js loaded (v3).');
