/* Hot and Cold · Actas — núcleo de datos y cola de envío (outbox).
 * Se usa desde la página (window) y desde el service worker (self).
 * Sin DOM: solo IndexedDB, fetch y BroadcastChannel.
 *
 * Envío a Google Apps Script:
 *  - POST con Content-Type text/plain;charset=utf-8 y un JSON en el cuerpo.
 *    Así el navegador no hace preflight OPTIONS (Apps Script no lo atiende bien).
 *  - fetch con redirect: 'follow' (Apps Script responde 302 a googleusercontent).
 *  - El acta se marca "Enviado" SOLO si se puede leer un JSON con ok:true.
 *    Una respuesta opaca no cuenta: queda pendiente y se reintenta.
 *  - El script no vuelve a mandar el mismo acta_id.
 */
(function (g) {
  'use strict';
  var DB_NAME = 'hc-actas';
  var DB_VER = 1;
  var LOCK_MS = 2 * 60 * 1000;      // un envío "en curso" caduca a los 2 min
  var TIMEOUT_MS = 90 * 1000;

  var COMPANY_EMAIL = 'hycsystem176746@gmail.com';
  var DEFAULT_TO_EXTRA = 'margarethvog@permoda.com.co';

  var DEFAULTS = {
    empresa: {
      nombre: 'HOT ANDA COLD SYSTEM SAS',
      marca: 'Hot and Cold',
      nit: '901.694.443-5',
      direccion: 'CR 17 No. 67-42',
      ciudad: 'Bogotá D.C.',
      tel1: '311 866 1394',
      tel2: '310 246 5622',
      email: COMPANY_EMAIL
    },
    tecnico: { nombre: '', cedula: '', cargo: 'Técnico' },
    clienteDefault: 'Permoda',
    correoClienteDefault: DEFAULT_TO_EXTRA,
    whatsappDefault: '',
    clientes: [
      { nombre: 'Permoda', nit: '', correo: DEFAULT_TO_EXTRA, direccion: '', sede: '', ciudad: 'Bogotá', contacto: '', telefono: '', cargo: '' }
    ],
    year: 2026,
    nextRet: 1,
    nextEnt: 1,
    apiUrl: '',
    apiToken: '',
    deviceId: ''
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function bogotaYear() {
    return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date()), 10);
  }

  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('actas')) {
          var s = db.createObjectStore('actas', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function reqP(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  async function withStore(name, mode, fn) {
    var db = await openDB();
    try {
      var t = db.transaction(name, mode);
      var done = new Promise(function (res, rej) {
        t.oncomplete = res;
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('Transacción abortada')); };
      });
      var result = await fn(t.objectStore(name));
      await done;
      return result;
    } finally {
      db.close();
    }
  }

  function kvGet(key) { return withStore('kv', 'readonly', function (s) { return reqP(s.get(key)); }); }
  function kvSet(key, val) { return withStore('kv', 'readwrite', function (s) { return reqP(s.put(val, key)); }); }
  function kvDel(key) { return withStore('kv', 'readwrite', function (s) { return reqP(s.delete(key)); }); }

  function mergeSettings(saved) {
    var s = clone(DEFAULTS);
    if (saved) {
      Object.keys(saved).forEach(function (k) {
        if (k === 'empresa' || k === 'tecnico') s[k] = Object.assign({}, s[k], saved[k] || {});
        else s[k] = saved[k];
      });
    }
    s.empresa.email = COMPANY_EMAIL;
    if (!s.correoClienteDefault) s.correoClienteDefault = DEFAULT_TO_EXTRA;
    if (s.whatsappDefault == null) s.whatsappDefault = '';
    (s.clientes || []).forEach(function (c) {
      if ((c.nombre || '').trim().toLowerCase() === 'permoda' && !c.correo) c.correo = DEFAULT_TO_EXTRA;
    });
    if (!s.deviceId) s.deviceId = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return s;
  }

  async function getSettings() {
    var saved = await kvGet('settings');
    var s = mergeSettings(saved);
    if (!saved || !saved.deviceId || saved.empresa && saved.empresa.email !== COMPANY_EMAIL) await kvSet('settings', s);
    return s;
  }
  function saveSettings(s) {
    s = mergeSettings(s);
    return kvSet('settings', s);
  }

  function pad3(n) { return String(n).padStart(3, '0'); }

  function previewConsecutive(s, kind) {
    var y = bogotaYear();
    var n = (s.year !== y) ? 1 : (kind === 'retiro' ? s.nextRet : s.nextEnt);
    return (kind === 'retiro' ? 'REC-' : 'ENT-') + y + '-' + pad3(n);
  }

  /* Reserva el consecutivo de forma atómica (una sola transacción). */
  function takeConsecutive(kind) {
    return withStore('kv', 'readwrite', async function (st) {
      var s = mergeSettings(await reqP(st.get('settings')));
      var y = bogotaYear();
      if (s.year !== y) { s.year = y; s.nextRet = 1; s.nextEnt = 1; }
      var n = kind === 'retiro' ? s.nextRet : s.nextEnt;
      if (kind === 'retiro') s.nextRet = n + 1; else s.nextEnt = n + 1;
      await reqP(st.put(s, 'settings'));
      return (kind === 'retiro' ? 'REC-' : 'ENT-') + y + '-' + pad3(n);
    });
  }

  function putActa(a) { return withStore('actas', 'readwrite', function (s) { return reqP(s.put(a)); }); }
  function getActa(id) { return withStore('actas', 'readonly', function (s) { return reqP(s.get(id)); }); }
  function deleteActa(id) { return withStore('actas', 'readwrite', function (s) { return reqP(s.delete(id)); }); }
  async function listActas() {
    var all = await withStore('actas', 'readonly', function (s) { return reqP(s.getAll()); });
    return all.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  }

  /* ---------- Cola de envío ---------- */
  var chan = null;
  try { chan = new BroadcastChannel('hc-outbox'); } catch (e) { chan = null; }
  function notify(msg) { try { if (chan) chan.postMessage(msg); } catch (e) {} }

  function isOnline() {
    return !(typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  function resumenTexto(a) {
    var eq = (a.items || []).map(function (it, i) {
      return (i + 1) + '. ' + [it.tipo, it.marca, it.modelo, it.serie ? ('Serie ' + it.serie) : '', it.activo ? ('Activo ' + it.activo) : ''].filter(Boolean).join(' · ');
    }).join('\n');
    return eq;
  }

  function kindTitle(k) { return k === 'retiro' ? 'Acta de recepción' : 'Acta de entrega'; }

  function fmtBogota(iso) {
    try {
      var d = new Date(iso);
      var f = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      return f.format(d) + ' (hora de Bogotá)';
    } catch (e) { return iso || ''; }
  }

  function emailSubject(a, s) {
    return kindTitle(a.kind) + ' ' + a.id + ' · ' + (a.cliente || '') + ' · ' + ((s.empresa && s.empresa.marca) || 'Hot and Cold');
  }

  function emailBody(a, s) {
    var rec = (a.firmaCliente && a.firmaCliente.nombre) || '';
    var tec = (a.firmaTecnico && a.firmaTecnico.nombre) || '';
    var recLabel = a.kind === 'retiro' ? 'Entrega (cliente)' : 'Recibe (cliente)';
    var lines = [
      'Cordial saludo,',
      '',
      'Adjuntamos el ' + kindTitle(a.kind).toLowerCase() + ' ' + a.id + ' firmada en sitio.',
      '',
      'Consecutivo: ' + a.id,
      'Cliente: ' + (a.cliente || ''),
      a.oc ? 'OC / REQ: ' + a.oc : '',
      'Sitio: ' + [a.sede, a.direccion, a.ciudad].filter(Boolean).join(' · '),
      'Fecha: ' + fmtBogota(a.createdAt),
      'Técnico: ' + tec,
      rec ? (recLabel + ': ' + rec) : '',
      '',
      'Equipos:',
      resumenTexto(a) || '(sin detalle)',
      '',
      ((s.empresa && s.empresa.nombre) || 'HOT ANDA COLD SYSTEM SAS') +
        ' · NIT ' + ((s.empresa && s.empresa.nit) || '901.694.443-5') +
        ' · Tel. ' + ((s.empresa && s.empresa.tel1) || '311 866 1394') +
        ' · ' + COMPANY_EMAIL
    ];
    return lines.filter(function (l, i) { return l !== '' || i === 1 || i === 4 || i === 12 || i === 15; }).join('\n');
  }

  function asBlob(pdf) {
    if (pdf instanceof Blob) return pdf;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        var i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { rej(r.error || new Error('No se pudo leer el PDF')); };
      r.readAsDataURL(blob);
    });
  }

  function safeFilename(a) {
    return (a.id + '_' + (a.cliente || 'acta')).replace(/[^\w.-]+/g, '_') + '.pdf';
  }

  /* POST text/plain a Apps Script. Solo se considera éxito un JSON {ok:true}. */
  async function postScript(url, payload) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        cache: 'no-store',
        mode: 'cors',
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new Error('Sin conexión con el servidor');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!resp || resp.type === 'opaque' || resp.type === 'opaqueredirect') {
      throw new Error('El servidor respondió pero no se pudo confirmar el envío. Se reintentará (no se duplicará).');
    }
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok || !data || !data.ok) {
      throw new Error((data && data.error) ? data.error : ('El servidor respondió ' + resp.status));
    }
    return data;
  }

  async function sendOne(a, s) {
    var pdfB64 = await blobToBase64(asBlob(a.pdf));
    return postScript(s.apiUrl, {
      token: s.apiToken,
      acta_id: a.id,
      tipo: a.kind,
      to_extra: a.correoCliente || '',
      subject: emailSubject(a, s),
      body: emailBody(a, s),
      pdf_base64: pdfB64,
      filename: safeFilename(a)
    });
  }

  var running = false;
  async function processOutbox(opts) {
    opts = opts || {};
    if (running) return { skipped: true };
    running = true;
    var out = { sent: 0, failed: 0, pending: 0 };
    try {
      var s = await getSettings();
      var all = await listActas();
      var pend = all.filter(function (a) { return a.status !== 'enviado'; })
        .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
      out.pending = pend.length;
      if (!pend.length) return out;
      if (!s.apiUrl || !s.apiToken) { out.noConfig = true; notify({ type: 'outbox', noConfig: true }); return out; }
      if (!isOnline()) { out.offline = true; return out; }
      for (var i = 0; i < pend.length; i++) {
        var a = await getActa(pend[i].id);
        if (!a || a.status === 'enviado') continue;
        if (a.sendingSince && Date.now() - a.sendingSince < LOCK_MS && !opts.force) continue;
        a.sendingSince = Date.now();
        await putActa(a);
        notify({ type: 'acta', id: a.id, status: 'enviando' });
        try {
          var r = await sendOne(a, s);
          a.status = 'enviado';
          a.sentAt = new Date().toISOString();
          a.sentTo = r.to || null;
          a.lastError = null;
          out.sent++;
        } catch (e) {
          a.status = 'pendiente';
          a.lastError = String((e && e.message) || e);
          out.failed++;
        }
        a.attempts = (a.attempts || 0) + 1;
        a.lastAttempt = new Date().toISOString();
        a.sendingSince = null;
        await putActa(a);
        notify({ type: 'acta', id: a.id, status: a.status, error: a.lastError });
        if (out.failed && !isOnline()) break;
      }
      out.pending = out.pending - out.sent;
      return out;
    } finally {
      running = false;
      notify({ type: 'outbox-done', result: out });
    }
  }

  /* Prueba del script: valida URL y token sin enviar correo. */
  async function pingServer(url, token) {
    return postScript(url, { token: token, ping: 1 });
  }

  g.HC = {
    DEFAULTS: DEFAULTS,
    COMPANY_EMAIL: COMPANY_EMAIL,
    DEFAULT_TO_EXTRA: DEFAULT_TO_EXTRA,
    getSettings: getSettings, saveSettings: saveSettings,
    previewConsecutive: previewConsecutive, takeConsecutive: takeConsecutive,
    putActa: putActa, getActa: getActa, deleteActa: deleteActa, listActas: listActas,
    kvGet: kvGet, kvSet: kvSet, kvDel: kvDel,
    processOutbox: processOutbox, pingServer: pingServer, resumenTexto: resumenTexto
  };
})(typeof self !== 'undefined' ? self : this);
