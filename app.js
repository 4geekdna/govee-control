(() => {
  'use strict';

  const API_BASE = 'https://openapi.api.govee.com/router/api/v1';

  const state = {
    apiKey: null,
    devices: []
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const els = {
    viewLogin: $('#view-login'),
    viewDevices: $('#view-devices'),
    apiKeyInput: $('#api-key'),
    btnConnect: $('#btn-connect'),
    btnLogout: $('#btn-logout'),
    btnRefresh: $('#btn-refresh'),
    btnAllOn: $('#btn-all-on'),
    btnAllOff: $('#btn-all-off'),
    deviceList: $('#device-list'),
    toast: $('#toast')
  };

  function showToast(msg, type = '') {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (type ? ` ${type}` : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

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
      try {
        const body = await res.json();
        msg = body.message || msg;
      } catch {}
      throw new Error(msg);
    }

    return res.json();
  }

  async function loadDevices() {
    els.deviceList.innerHTML = `<div class="state"><div class="spinner"></div>Loading devices…</div>`;

    try {
      const result = await api('/user/devices');
      state.devices = result.data || [];

      if (state.devices.length === 0) {
        els.deviceList.innerHTML = `<div class="state">No devices found</div>`;
        return;
      }

      renderDevices();
    } catch (err) {
      els.deviceList.innerHTML = `<div class="state">${err.message}</div>`;
      showToast(err.message, 'error');
    }
  }

  function hasCapability(device, type, instance) {
    return (device.capabilities || []).some(c => c.type === type && c.instance === instance);
  }

  function renderDevices() {
    els.deviceList.innerHTML = state.devices.map((d, idx) => {
      const canPower = hasCapability(d, 'devices.capabilities.on_off', 'powerSwitch');
      const canBright = hasCapability(d, 'devices.capabilities.range', 'brightness');
      const canColor = hasCapability(d, 'devices.capabilities.color_setting', 'colorRgb');
      const canTemp = hasCapability(d, 'devices.capabilities.color_setting', 'colorTemperatureK');

      return `
        <div class="device-card" data-idx="${idx}">
          <div class="device-header">
            <div>
              <div class="device-name">${escapeHtml(d.deviceName || d.sku || 'Device')}</div>
              <div class="device-model">${escapeHtml(d.sku)} · ${escapeHtml(d.device)}</div>
            </div>
            ${canPower ? `<button class="power-btn" data-action="power" data-idx="${idx}">⏻</button>` : ''}
          </div>

          <div class="controls">
            ${canBright ? `
              <div class="control-row">
                <label>Brightness</label>
                <input type="range" min="1" max="100" value="50" data-action="brightness" data-idx="${idx}" />
                <span class="bright-val">50%</span>
              </div>` : ''}

            ${canColor ? `
              <div class="control-row">
                <label>Color</label>
                <input type="color" value="#ffffff" data-action="color" data-idx="${idx}" />
              </div>` : ''}

            ${canTemp ? `
              <div class="control-row">
                <label>Temp (K)</label>
                <input type="range" min="2000" max="9000" value="4000" step="100" data-action="temp" data-idx="${idx}" />
                <span class="temp-val">4000K</span>
              </div>` : ''}
          </div>
        </div>`;
    }).join('');

    // Event listeners
    $$('.power-btn').forEach(btn => {
      btn.addEventListener('click', () => togglePower(Number(btn.dataset.idx), btn));
    });

    $$('input[data-action="brightness"]').forEach(input => {
      input.addEventListener('input', (e) => {
        const val = e.target.value;
        e.target.nextElementSibling.textContent = val + '%';
      });
      input.addEventListener('change', (e) => {
        setBrightness(Number(e.target.dataset.idx), Number(e.target.value));
      });
    });

    $$('input[data-action="color"]').forEach(input => {
      input.addEventListener('change', (e) => {
        setColor(Number(e.target.dataset.idx), e.target.value);
      });
    });

    $$('input[data-action="temp"]').forEach(input => {
      input.addEventListener('input', (e) => {
        e.target.nextElementSibling.textContent = e.target.value + 'K';
      });
      input.addEventListener('change', (e) => {
        setColorTemp(Number(e.target.dataset.idx), Number(e.target.value));
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
    })[m]);
  }

  async function sendControl(device, capability) {
    const body = {
      requestId: uuid(),
      payload: {
        sku: device.sku,
        device: device.device,
        capability
      }
    };

    await api('/device/control', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async function togglePower(idx, btn) {
    const device = state.devices[idx];
    const isOn = btn.classList.contains('on');
    const newValue = isOn ? 0 : 1;

    try {
      await sendControl(device, {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        value: newValue
      });
      btn.classList.toggle('on', !isOn);
      showToast(newValue === 1 ? 'Turned on' : 'Turned off', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function setBrightness(idx, value) {
    const device = state.devices[idx];
    try {
      await sendControl(device, {
        type: 'devices.capabilities.range',
        instance: 'brightness',
        value: value
      });
      showToast(`Brightness ${value}%`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function setColor(idx, hex) {
    const device = state.devices[idx];
    // Convert #RRGGBB to integer
    const rgbInt = parseInt(hex.replace('#', ''), 16);

    try {
      await sendControl(device, {
        type: 'devices.capabilities.color_setting',
        instance: 'colorRgb',
        value: rgbInt
      });
      showToast('Color updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function setColorTemp(idx, kelvin) {
    const device = state.devices[idx];
    try {
      await sendControl(device, {
        type: 'devices.capabilities.color_setting',
        instance: 'colorTemperatureK',
        value: kelvin
      });
      showToast(`${kelvin}K`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function allPower(on) {
    const value = on ? 1 : 0;
    const promises = state.devices
      .filter(d => hasCapability(d, 'devices.capabilities.on_off', 'powerSwitch'))
      .map(d => sendControl(d, {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        value
      }));

    try {
      await Promise.all(promises);
      $$('.power-btn').forEach(btn => btn.classList.toggle('on', on));
      showToast(on ? 'All lights on' : 'All lights off', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function showView(name) {
    els.viewLogin.classList.toggle('hidden', name !== 'login');
    els.viewDevices.classList.toggle('hidden', name !== 'devices');
    els.btnLogout.classList.toggle('hidden', name === 'login');
  }

  function connect(key) {
    if (!key || key.trim().length < 10) {
      showToast('Please enter a valid API key', 'error');
      return;
    }

    state.apiKey = key.trim();
    localStorage.setItem('govee-api-key', state.apiKey);
    showView('devices');
    loadDevices();
  }

  function logout() {
    state.apiKey = null;
    state.devices = [];
    localStorage.removeItem('govee-api-key');
    els.apiKeyInput.value = '';
    showView('login');
    showToast('Logged out');
  }

  // Init
  function boot() {
    els.btnConnect.addEventListener('click', () => connect(els.apiKeyInput.value));
    els.apiKeyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') connect(els.apiKeyInput.value);
    });

    els.btnLogout.addEventListener('click', logout);
    els.btnRefresh.addEventListener('click', () => {
      if (state.apiKey) loadDevices();
    });

    els.btnAllOn.addEventListener('click', () => allPower(true));
    els.btnAllOff.addEventListener('click', () => allPower(false));

    const saved = localStorage.getItem('govee-api-key');
    if (saved) {
      els.apiKeyInput.value = saved;
      connect(saved);
    } else {
      showView('login');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
