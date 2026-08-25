(() => {
  'use strict';

  const API_BASE = 'https://openapi.api.govee.com/router/api/v1';

  const LS_KEY = 'govee-api-key';
  const LS_NAMES = 'govee-custom-names';
  const LS_ROOMS = 'govee-rooms';

  const PRESETS = [
    { name: 'Warm',    color: '#FFB347', temp: 2700 },
    { name: 'Soft',    color: '#FFE4B5', temp: 3000 },
    { name: 'Neutral', color: '#FFF8E7', temp: 4000 },
    { name: 'Cool',    color: '#E0F0FF', temp: 5500 },
    { name: 'Day',     color: '#FFFFFF', temp: 6500 },
    { name: 'Red',     color: '#FF3B30' },
    { name: 'Orange',  color: '#FF9500' },
    { name: 'Green',   color: '#34C759' },
    { name: 'Blue',    color: '#007AFF' },
    { name: 'Purple',  color: '#AF52DE' },
    { name: 'Pink',    color: '#FF2D55' }
  ];

  const state = {
    apiKey: null,
    devices: [],
    customNames: {},
    rooms: {},
    filterRoom: '',
    search: '',
    editingIdx: null
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const els = {
    viewLogin: $('#view-login'),
    viewDevices: $('#view-devices'),
    apiKeyInput: $('#api-key'),
    btnConnect: $('#btn-connect'),
    btnLogout: $('#btn-logout'),
    btnRefresh: $('#btn-refresh'),
    btnAllOn: $('#btn-all-on'),
    btnAllOff: $('#btn-all-off'),
    search: $('#search'),
    roomFilter: $('#room-filter'),
    deviceList: $('#device-list'),
    modalEdit: $('#modal-edit'),
    editName: $('#edit-name'),
    editRoom: $('#edit-room'),
    roomList: $('#room-list'),
    toast: $('#toast')
  };

  function showToast(msg, type = '') {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (type ? ` ${type}` : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m =>
      ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' })[m]);
  }

  function loadLocal() {
    try {
      state.customNames = JSON.parse(localStorage.getItem(LS_NAMES) || '{}');
      state.rooms = JSON.parse(localStorage.getItem(LS_ROOMS) || '{}');
    } catch {
      state.customNames = {};
      state.rooms = {};
    }
  }

  function saveNames() { localStorage.setItem(LS_NAMES, JSON.stringify(state.customNames)); }
  function saveRooms() { localStorage.setItem(LS_ROOMS, JSON.stringify(state.rooms)); }

  function deviceId(d) { return d.device || d.sku; }

  function displayName(d) {
    const id = deviceId(d);
    return state.customNames[id] || d.deviceName || d.sku || 'Device';
  }

  function roomOf(d) { return state.rooms[deviceId(d)] || ''; }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Govee-API-Key': state.apiKey,
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try { const body = await res.json(); msg = body.message || body.msg || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function fetchDevices() {
    const result = await api('/user/devices');
    return result.data || [];
  }

  async function fetchState(device) {
    const body = { requestId: uuid(), payload: { sku: device.sku, device: device.device } };
    const result = await api('/device/state', { method: 'POST', body: JSON.stringify(body) });
    return result.payload || {};
  }

  async function sendControl(device, capability) {
    const body = {
      requestId: uuid(),
      payload: { sku: device.sku, device: device.device, capability }
    };
    await api('/device/control', { method: 'POST', body: JSON.stringify(body) });
  }

  async function fetchDiyScenes(device) {
    try {
      const body = { requestId: uuid(), payload: { sku: device.sku, device: device.device } };
      const result = await api('/device/diy-scenes', { method: 'POST', body: JSON.stringify(body) });
      const caps = result.payload?.capabilities || [];
      const diy = caps.find(c => c.instance === 'diyScene');
      return diy?.parameters?.options || [];
    } catch { return []; }
  }

  function applyStateToDevice(device, statePayload) {
    const caps = statePayload.capabilities || [];
    device._state = {};
    for (const c of caps) {
      if (c.instance === 'powerSwitch') device._state.power = c.state?.value === 1;
      if (c.instance === 'brightness') device._state.brightness = c.state?.value;
      if (c.instance === 'colorRgb' && typeof c.state?.value === 'number') {
        device._state.color = '#' + c.state.value.toString(16).padStart(6, '0');
      }
      if (c.instance === 'colorTemperatureK') device._state.temp = c.state?.value;
      if (c.instance === 'online') device._state.online = c.state?.value;
    }
  }

  function getFilteredDevices() {
    let list = [...state.devices];
    if (state.filterRoom) list = list.filter(d => roomOf(d) === state.filterRoom);
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(d => {
        const name = displayName(d).toLowerCase();
        const room = roomOf(d).toLowerCase();
        const sku = (d.sku || '').toLowerCase();
        return name.includes(q) || room.includes(q) || sku.includes(q);
      });
    }
    list.sort((a, b) => {
      const ra = roomOf(a) || 'zzz';
      const rb = roomOf(b) || 'zzz';
      if (ra !== rb) return ra.localeCompare(rb);
      return displayName(a).localeCompare(displayName(b));
    });
    return list;
  }

  function updateRoomFilterOptions() {
    const rooms = [...new Set(Object.values(state.rooms).filter(Boolean))].sort();
    const current = state.filterRoom;
    els.roomFilter.innerHTML = `<option value="">All Rooms</option>` +
      rooms.map(r => `<option value="${escapeHtml(r)}"${r === current ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
    els.roomList.innerHTML = rooms.map(r => `<option value="${escapeHtml(r)}">`).join('');
  }

  function renderDevices() {
    const list = getFilteredDevices();
    if (list.length === 0) {
      els.deviceList.innerHTML = `<div class="state">No lights match your filter</div>`;
      return;
    }

    els.deviceList.innerHTML = list.map(d => {
      const idx = state.devices.indexOf(d);
      const id = deviceId(d);
      const name = displayName(d);
      const room = roomOf(d);
      const st = d._state || {};
      const isOn = !!st.power;

      const canPower = (d.capabilities || []).some(c => c.instance === 'powerSwitch');
      const canBright = (d.capabilities || []).some(c => c.instance === 'brightness');
      const canColor = (d.capabilities || []).some(c => c.instance === 'colorRgb');
      const canTemp = (d.capabilities || []).some(c => c.instance === 'colorTemperatureK');

      const brightVal = st.brightness ?? 50;
      const colorVal = st.color || '#ffffff';
      const tempVal = st.temp ?? 4000;

      return `
        <div class="device-card" data-idx="${idx}" data-id="${escapeHtml(id)}">
          <div class="device-header">
            <div class="device-info">
              <div class="device-name">
                ${escapeHtml(name)}
                <button class="edit-btn" data-action="edit" data-idx="${idx}" title="Edit name / room">✏️</button>
              </div>
              <div class="device-meta">${escapeHtml(d.sku)}</div>
              ${room ? `<span class="room-tag">${escapeHtml(room)}</span>` : ''}
            </div>
            ${canPower ? `<button class="power-btn ${isOn ? 'on' : ''}" data-action="power" data-idx="${idx}">⏻</button>` : ''}
          </div>
          <div class="controls">
            ${canBright ? `
              <div class="control-row">
                <label>Brightness</label>
                <input type="range" min="1" max="100" value="${brightVal}" data-action="brightness" data-idx="${idx}" />
                <span class="val">${brightVal}%</span>
              </div>` : ''}
            ${canColor || canTemp ? `
              <div class="control-row">
                <label>Presets</label>
                <div class="presets">
                  ${PRESETS.map(p => `
                    <button class="preset-btn" style="background:${p.color}"
                      title="${p.name}" data-action="preset" data-idx="${idx}"
                      data-color="${p.color}" data-temp="${p.temp || ''}"></button>`).join('')}
                </div>
              </div>` : ''}
            ${canColor ? `
              <div class="control-row">
                <label>Color</label>
                <input type="color" value="${colorVal}" data-action="color" data-idx="${idx}" />
              </div>` : ''}
            ${canTemp ? `
              <div class="control-row">
                <label>Temp</label>
                <input type="range" min="2000" max="9000" value="${tempVal}" step="100"
                  data-action="temp" data-idx="${idx}" />
                <span class="val">${tempVal}K</span>
              </div>` : ''}
            <div class="scenes-row" data-scenes-for="${idx}"></div>
          </div>
        </div>`;
    }).join('');

    bindDeviceEvents();
    list.slice(0, 6).forEach(d => loadScenesForDevice(d));
  }

  function bindDeviceEvents() {
    $$('[data-action="power"]').forEach(btn => {
      btn.addEventListener('click', () => togglePower(Number(btn.dataset.idx), btn));
    });
    $$('[data-action="brightness"]').forEach(input => {
      input.addEventListener('input', e => { e.target.nextElementSibling.textContent = e.target.value + '%'; });
      input.addEventListener('change', e => {
        setBrightness(Number(e.target.dataset.idx), Number(e.target.value), e.target.closest('.device-card'));
      });
    });
    $$('[data-action="color"]').forEach(input => {
      input.addEventListener('change', e => {
        setColor(Number(e.target.dataset.idx), e.target.value, e.target.closest('.device-card'));
      });
    });
    $$('[data-action="temp"]').forEach(input => {
      input.addEventListener('input', e => { e.target.nextElementSibling.textContent = e.target.value + 'K'; });
      input.addEventListener('change', e => {
        setColorTemp(Number(e.target.dataset.idx), Number(e.target.value), e.target.closest('.device-card'));
      });
    });
    $$('[data-action="preset"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const color = btn.dataset.color;
        const temp = btn.dataset.temp ? Number(btn.dataset.temp) : null;
        applyPreset(idx, color, temp, btn.closest('.device-card'));
      });
    });
    $$('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(Number(btn.dataset.idx)));
    });
  }

  async function loadScenesForDevice(device) {
    const idx = state.devices.indexOf(device);
    const container = $(`[data-scenes-for="${idx}"]`);
    if (!container || container.dataset.loaded) return;
    container.dataset.loaded = '1';
    const scenes = await fetchDiyScenes(device);
    if (!scenes.length) return;
    container.innerHTML = scenes.slice(0, 8).map(s =>
      `<button class="scene-btn" data-scene-value="${s.value}" data-idx="${idx}">${escapeHtml(s.name)}</button>`
    ).join('');
    container.querySelectorAll('.scene-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const d = state.devices[Number(btn.dataset.idx)];
        const card = btn.closest('.device-card');
        setCardLoading(card, true);
        try {
          await sendControl(d, {
            type: 'devices.capabilities.diy_color_setting',
            instance: 'diyScene',
            value: Number(btn.dataset.sceneValue)
          });
          showToast(`Scene: ${btn.textContent}`, 'success');
        } catch (err) { showToast(err.message, 'error'); }
        finally { setCardLoading(card, false); }
      });
    });
  }

  function setCardLoading(card, on) {
    if (card) card.classList.toggle('loading', on);
  }

  async function togglePower(idx, btn) {
    const device = state.devices[idx];
    const currentlyOn = btn.classList.contains('on');
    const newVal = currentlyOn ? 0 : 1;
    btn.classList.add('loading');
    try {
      await sendControl(device, { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: newVal });
      btn.classList.toggle('on', !currentlyOn);
      if (!device._state) device._state = {};
      device._state.power = !currentlyOn;
      showToast(newVal === 1 ? 'On' : 'Off', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.classList.remove('loading'); }
  }

  async function setBrightness(idx, value, card) {
    const device = state.devices[idx];
    setCardLoading(card, true);
    try {
      await sendControl(device, { type: 'devices.capabilities.range', instance: 'brightness', value });
      if (!device._state) device._state = {};
      device._state.brightness = value;
      showToast(`${value}%`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCardLoading(card, false); }
  }

  async function setColor(idx, hex, card) {
    const device = state.devices[idx];
    const rgbInt = parseInt(hex.replace('#', ''), 16);
    setCardLoading(card, true);
    try {
      await sendControl(device, { type: 'devices.capabilities.color_setting', instance: 'colorRgb', value: rgbInt });
      if (!device._state) device._state = {};
      device._state.color = hex;
      showToast('Color set', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCardLoading(card, false); }
  }

  async function setColorTemp(idx, kelvin, card) {
    const device = state.devices[idx];
    setCardLoading(card, true);
    try {
      await sendControl(device, { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', value: kelvin });
      if (!device._state) device._state = {};
      device._state.temp = kelvin;
      showToast(`${kelvin}K`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCardLoading(card, false); }
  }

  async function applyPreset(idx, color, temp, card) {
    const device = state.devices[idx];
    setCardLoading(card, true);
    try {
      if (temp) {
        await sendControl(device, { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', value: temp });
        if (!device._state) device._state = {};
        device._state.temp = temp;
      } else if (color) {
        const rgbInt = parseInt(color.replace('#', ''), 16);
        await sendControl(device, { type: 'devices.capabilities.color_setting', instance: 'colorRgb', value: rgbInt });
        if (!device._state) device._state = {};
        device._state.color = color;
      }
      showToast('Preset applied', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setCardLoading(card, false); }
  }

  async function allPower(on) {
    const value = on ? 1 : 0;
    const targets = getFilteredDevices().filter(d => (d.capabilities || []).some(c => c.instance === 'powerSwitch'));
    els.btnAllOn.disabled = true;
    els.btnAllOff.disabled = true;
    try {
      await Promise.all(targets.map(d =>
        sendControl(d, { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value }).then(() => {
          if (!d._state) d._state = {};
          d._state.power = on;
        })
      ));
      renderDevices();
      showToast(on ? 'All on' : 'All off', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally {
      els.btnAllOn.disabled = false;
      els.btnAllOff.disabled = false;
    }
  }

  function openEditModal(idx) {
    const d = state.devices[idx];
    state.editingIdx = idx;
    els.editName.value = displayName(d);
    els.editRoom.value = roomOf(d);
    els.modalEdit.classList.add('open');
  }

  function closeEditModal() {
    els.modalEdit.classList.remove('open');
    state.editingIdx = null;
  }

  function saveEdit() {
    if (state.editingIdx == null) return;
    const d = state.devices[state.editingIdx];
    const id = deviceId(d);
    const name = els.editName.value.trim();
    const room = els.editRoom.value.trim();
    if (name) state.customNames[id] = name; else delete state.customNames[id];
    if (room) state.rooms[id] = room; else delete state.rooms[id];
    saveNames();
    saveRooms();
    updateRoomFilterOptions();
    renderDevices();
    closeEditModal();
    showToast('Saved', 'success');
  }

  async function loadAll() {
    els.deviceList.innerHTML = `<div class="state"><div class="spinner"></div>Loading lights…</div>`;
    try {
      const devices = await fetchDevices();
      state.devices = devices;
      const toFetch = devices.slice(0, 8);
      await Promise.all(toFetch.map(async (d) => {
        try { const st = await fetchState(d); applyStateToDevice(d, st); } catch {}
      }));
      updateRoomFilterOptions();
      renderDevices();
    } catch (err) {
      els.deviceList.innerHTML = `<div class="state">${escapeHtml(err.message)}</div>`;
      showToast(err.message, 'error');
    }
  }

  function showView(name) {
    els.viewLogin.classList.toggle('hidden', name !== 'login');
    els.viewDevices.classList.toggle('hidden', name !== 'devices');
    els.btnLogout.classList.toggle('hidden', name === 'login');
  }

  function connect(key) {
    if (!key || key.trim().length < 8) {
      showToast('Please enter a valid API key', 'error');
      return;
    }
    state.apiKey = key.trim();
    localStorage.setItem(LS_KEY, state.apiKey);
    showView('devices');
    loadAll();
  }

  function logout() {
    state.apiKey = null;
    state.devices = [];
    localStorage.removeItem(LS_KEY);
    els.apiKeyInput.value = '';
    showView('login');
    showToast('Logged out');
  }

  function boot() {
    loadLocal();
    els.btnConnect.addEventListener('click', () => connect(els.apiKeyInput.value));
    els.apiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') connect(els.apiKeyInput.value); });
    els.btnLogout.addEventListener('click', logout);
    els.btnRefresh.addEventListener('click', () => { if (state.apiKey) loadAll(); });
    els.btnAllOn.addEventListener('click', () => allPower(true));
    els.btnAllOff.addEventListener('click', () => allPower(false));
    els.search.addEventListener('input', () => { state.search = els.search.value.trim(); renderDevices(); });
    els.roomFilter.addEventListener('change', () => { state.filterRoom = els.roomFilter.value; renderDevices(); });
    $('#modal-edit-close').addEventListener('click', closeEditModal);
    $('#modal-edit-cancel').addEventListener('click', closeEditModal);
    $('#modal-edit-save').addEventListener('click', saveEdit);
    els.modalEdit.addEventListener('click', e => { if (e.target === els.modalEdit) closeEditModal(); });

    const saved = localStorage.getItem(LS_KEY);
    if (saved) { els.apiKeyInput.value = saved; connect(saved); }
    else showView('login');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
