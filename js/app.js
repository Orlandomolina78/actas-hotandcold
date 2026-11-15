/* Hot and Cold · Actas — lógica de la interfaz */
(function () {
  'use strict';
  var APP_VERSION = '1.3.0';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = null;              // ajustes
  var kind = 'entrega';      // tipo del formulario abierto
  var photos = [];           // [{data,w,h,caption}]
  var pads = {};             // {sigTec:{pad,url}, sigCli:{...}}
  var logoData = null;
  var uidSeq = 0;
  var lastActa = null;       // acta mostrada en el modal
  var draftTimer = null;
  var restoring = false;

  /* ---------- utilidades ---------- */
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nowLabel(iso) { return HCPDF.fmtDate(iso) + ' · ' + HCPDF.fmtTime(iso); }
  function blobToDataURL(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
  function kindTitle(k) { return HC.kindTitle(k); }
  function recipientsOf(a) {
    var r = [S.empresa.email];
    if (a.correoCliente && validEmail(a.correoCliente)) r.push(a.correoCliente);
    return r;
  }

  /* ---------- navegación por hash (el botón atrás de Android funciona) ---------- */
  var VIEWS = { home: 'Actas de equipos', form: '', orden: 'Orden de servicio', cobro: 'Cuenta de cobro', history: 'Historial', settings: 'Ajustes' };
  function go(v) { if (location.hash !== '#' + v) location.hash = v; else render(); }
  function currentView() { var h = (location.hash || '#home').slice(1); return VIEWS.hasOwnProperty(h) ? h : 'home'; }
  function render() {
    var v = currentView();
    Object.keys(VIEWS).forEach(function (k) { $('#view-' + k).hidden = k !== v; });
    $('#btnBack').hidden = v === 'home';
    $('#tbTitle').textContent = v === 'form' ? kindTitle(kind) : VIEWS[v];
    window.scrollTo(0, 0);
    if (v === 'home') renderHome();
    if (v === 'history') renderHistory();
    if (v === 'settings') renderSettings();
    if (v === 'form') { if (!$('#items').children.length) openForm(kind); setTimeout(resizePads, 30); }
    if (v === 'orden' || v === 'cobro') { (docInit[v] ? Promise.resolve() : openDoc(v)).then(function () { setTimeout(resizePads, 30); }); }
  }

  /* ---------- red ---------- */
  function renderNet() {
    var on = navigator.onLine !== false;
    var b = $('#netBadge'); b.textContent = on ? 'En línea' : 'Sin señal'; b.classList.toggle('off', !on);
  }

  /* ---------- INICIO ---------- */
  async function renderHome() {
    S = await HC.getSettings();
    $('#homeEmpresa').textContent = S.empresa.nombre;
    $('#homeNit').textContent = 'NIT ' + S.empresa.nit + ' · Marca ' + S.empresa.marca;
    $('#nextRetLbl').textContent = HC.previewConsecutive(S, 'retiro');
    $('#nextEntLbl').textContent = HC.previewConsecutive(S, 'entrega');
    $('#nextOSLbl').textContent = 'No. ' + HC.previewConsecutive(S, 'orden').replace(/^OS-/, '');
    $('#nextCCLbl').textContent = HC.previewConsecutive(S, 'cobro');
    var all = await HC.listActas();
    var pend = all.filter(function (a) { return a.status !== 'enviado'; });
    var c = $('#outboxCard');
    if (!all.length) c.innerHTML = '<span class="ob-i">&#128228;</span><div><b>Sin documentos todavía</b><span class="muted">Aquí verá el estado de envío por correo.</span></div>';
    else if (!pend.length) c.innerHTML = '<span class="ob-i">&#9989;</span><div><b>Todo enviado</b><span class="muted">' + all.length + ' documento(s) en el historial de este equipo.</span></div>';
    else {
      var why = !S.apiUrl ? 'Falta configurar el script de envío en Ajustes.' : (navigator.onLine === false ? 'Sin señal: saldrán solas al volver la conexión.' : 'Se están enviando / se reintentarán automáticamente.');
      c.innerHTML = '<span class="ob-i">&#9203;</span><div><b>' + pend.length + ' documento(s) pendiente(s) de envío</b><span class="muted">' + why + '</span></div>';
    }
  }

  /* ---------- FORMULARIO ---------- */
  function blankData(k) {
    var cli = findClient(S.clienteDefault) || { nombre: S.clienteDefault || '' };
    return {
      kind: k, cliente: cli.nombre || '', nit: cli.nit || '', correoCliente: cli.correo || S.correoClienteDefault || '', oc: '', albaran: '',
      direccion: cli.direccion || '', sede: cli.sede || '', ciudad: cli.ciudad || 'Bogotá', contacto: cli.contacto || '',
      telefono: cli.telefono || '', cargoContacto: cli.cargo || '', tipoServicio: [], tipoOtro: '',
      items: [{ cantidad: 1 }], fotos: [],
      tecNombre: S.tecnico.nombre || '', tecCedula: S.tecnico.cedula || '', tecCargo: S.tecnico.cargo || 'Técnico',
      cliNombre: '', cliCedula: '', cliCargo: '', sigTec: null, sigCli: null
    };
  }
  function findClient(name) {
    if (!name) return null;
    var n = String(name).trim().toLowerCase();
    return (S.clientes || []).filter(function (c) { return (c.nombre || '').trim().toLowerCase() === n; })[0] || null;
  }

  async function openForm(k, fresh) {
    kind = k;
    S = await HC.getSettings();
    var draft = fresh ? null : await HC.kvGet('draft_' + k);
    applyKindUI();
    fillForm(draft || blankData(k));
    $('#formErrors').hidden = true;
    $('#tbTitle').textContent = kindTitle(kind);
  }

  function applyKindUI() {
    var ent = kind === 'entrega';
    var f = $('#actaForm');
    f.classList.toggle('form-entrega', ent); f.classList.toggle('form-retiro', !ent);
    $('#fhKind').textContent = ent ? 'ACTA DE ENTREGA DE EQUIPOS' : 'ACTA DE RECEPCIÓN DE EQUIPOS';
    $('#fhNum').textContent = HC.previewConsecutive(S, kind);
    $('#fhDate').textContent = nowLabel(new Date().toISOString()) + '\n(hora de Bogotá)';
    $('#dirLabel').textContent = ent ? 'Dirección de entrega' : 'Dirección de recepción';
    $('#sigTecTitle').textContent = ent ? 'Quien entrega · Técnico ' + S.empresa.marca : 'Quien recibe · Técnico ' + S.empresa.marca;
    $('#sigCliTitle').textContent = ent ? 'Quien recibe · Cliente' : 'Quien entrega · Cliente';
    // Orden de firmas como en el papel: primero quien entrega
    var tec = $('#sigTecBlock'), cli = $('#sigCliBlock');
    if (ent) tec.parentNode.insertBefore(tec, cli); else cli.parentNode.insertBefore(cli, tec);
    $$('.acc-k').forEach(function (e) { e.textContent = ent ? 'entregados' : 'que acompañan el equipo'; });
    var chips = $('#tipoServicio');
    chips.innerHTML = HCPDF.SERVICIOS[kind].map(function (s) {
      return '<label class="chip"><input type="checkbox" name="tipoServicio" value="' + esc(s) + '"><span>' + esc(s) + '</span></label>';
    }).join('');
    $('#clientesList').innerHTML = (S.clientes || []).map(function (c) { return '<option value="' + esc(c.nombre) + '">'; }).join('');
    var fijo = $('#correoEmpresaFijo');
    if (fijo) fijo.textContent = S.empresa.email || HC.COMPANY_EMAIL;
  }

  var SIMPLE = ['cliente', 'nit', 'correoCliente', 'oc', 'albaran', 'direccion', 'sede', 'ciudad', 'contacto', 'telefono', 'cargoContacto', 'tipoOtro', 'tecNombre', 'tecCedula', 'tecCargo', 'cliNombre', 'cliCedula', 'cliCargo'];

  function fillForm(d) {
    restoring = true;
    var f = $('#actaForm');
    SIMPLE.forEach(function (n) { if (f.elements[n]) f.elements[n].value = d[n] || ''; });
    $$('input[name="tipoServicio"]', f).forEach(function (c) { c.checked = (d.tipoServicio || []).indexOf(c.value) >= 0; });
    $('#items').innerHTML = '';
    (d.items && d.items.length ? d.items : [{ cantidad: 1 }]).forEach(function (it) { addItem(it); });
    photos = (d.fotos || []).slice();
    renderPhotos();
    setPadData('sigTec', d.sigTec);
    setPadData('sigCli', d.sigCli);
    restoring = false;
  }

  function collectForm() {
    var f = $('#actaForm');
    var d = { kind: kind };
    SIMPLE.forEach(function (n) { d[n] = (f.elements[n].value || '').trim(); });
    d.tipoServicio = $$('input[name="tipoServicio"]:checked', f).map(function (c) { return c.value; });
    d.items = $$('#items .item').map(collectItem);
    d.fotos = photos.slice();
    d.sigTec = pads.sigTec && pads.sigTec.url ? pads.sigTec.url : null;
    d.sigCli = pads.sigCli && pads.sigCli.url ? pads.sigCli.url : null;
    return d;
  }

  /* ---------- equipos ---------- */
  function addItem(data) {
    data = data || { cantidad: 1 };
    var uid = 'i' + (++uidSeq);
    var node = document.importNode($('#tplItem').content, true).firstElementChild;
    node.dataset.uid = uid;
    $$('[data-r]', node).forEach(function (g) {
      $$('input', g).forEach(function (r) { r.name = uid + '-' + g.dataset.r; r.checked = data[g.dataset.r] === r.value; });
    });
    $$('[data-f]', node).forEach(function (i) {
      var k = i.dataset.f;
      if (k === 'accOtro') i.value = (data.accesorios && data.accesorios.otroTexto) || '';
      else if (data[k] != null) i.value = data[k];
    });
    $$('[data-c]', node).forEach(function (c) { c.checked = !!(data.accesorios && data.accesorios[c.dataset.c]); });
    $('[data-act="remove"]', node).addEventListener('click', function () {
      var n = $$('#items .item').length;
      if (n <= 1) { toast('El acta necesita al menos un equipo'); return; }
      var it = collectItem(node);
      if ((it.tipo || it.marca || it.modelo) && !confirm('¿Quitar este equipo del acta?')) return;
      node.remove(); renumber(); saveDraftSoon();
    });
    $('#items').appendChild(node);
    renumber();
    return node;
  }
  function renumber() {
    var items = $$('#items .item');
    items.forEach(function (n, i) { $('.item-n', n).textContent = 'Equipo ' + (i + 1); });
    $('#itemsCount').textContent = '(' + items.length + ')';
  }
  function collectItem(node) {
    var it = {};
    $$('[data-f]', node).forEach(function (i) { it[i.dataset.f] = (i.value || '').trim(); });
    $$('[data-r]', node).forEach(function (g) { var c = $('input:checked', g); it[g.dataset.r] = c ? c.value : ''; });
    it.accesorios = {};
    $$('[data-c]', node).forEach(function (c) { it.accesorios[c.dataset.c] = c.checked; });
    it.accesorios.otroTexto = it.accOtro || '';
    delete it.accOtro;
    it.cantidad = parseInt(it.cantidad, 10) || 1;
    if (kind !== 'entrega') { delete it.trabajo; delete it.repuestos; delete it.pruebas; delete it.garantia; }
    return it;
  }

  /* ---------- fotos ---------- */
  function compressImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1400, w = img.naturalWidth, h = img.naturalHeight;
        var sc = Math.min(1, max / Math.max(w, h));
        var cw = Math.round(w * sc), ch = Math.round(h * sc);
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        res({ data: c.toDataURL('image/jpeg', 0.72), w: cw, h: ch, caption: '' });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }
  async function onFiles(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    for (var i = 0; i < files.length; i++) {
      try { photos.push(await compressImage(files[i])); } catch (err) { toast(err.message); }
    }
    e.target.value = '';
    renderPhotos(); saveDraftSoon();
  }
  function renderPhotos() {
    var box = $('#photos');
    box.innerHTML = '';
    photos.forEach(function (p, i) {
      var d = document.createElement('div'); d.className = 'ph';
      d.innerHTML = '<img alt="Foto ' + (i + 1) + '"><button type="button" aria-label="Quitar foto">&times;</button><input placeholder="Descripción (opcional)">';
      $('img', d).src = p.data;
      var inp = $('input', d); inp.value = p.caption || '';
      inp.addEventListener('input', function () { p.caption = inp.value; saveDraftSoon(); });
      $('button', d).addEventListener('click', function () { photos.splice(i, 1); renderPhotos(); saveDraftSoon(); });
      box.appendChild(d);
    });
  }

  /* ---------- firmas ---------- */
  function initPad(id) {
    var canvas = document.getElementById(id);
    var pad = new SignaturePad(canvas, { minWidth: 0.9, maxWidth: 2.6, penColor: '#0d1b2e', backgroundColor: 'rgba(0,0,0,0)', throttle: 8 });
    pads[id] = { pad: pad, url: null, canvas: canvas };
    pad.addEventListener('endStroke', function () {
      pads[id].url = pad.toDataURL('image/png');
      canvas.parentNode.classList.add('signed');
      padChanged(id);
    });
  }
  function padChanged(id) {
    if (/^os/.test(id)) saveDocDraftSoon('orden');
    else if (/^cc/.test(id)) saveDocDraftSoon('cobro');
    else saveDraftSoon();
  }
  function resizePads() {
    Object.keys(pads).forEach(function (id) {
      var o = pads[id], c = o.canvas;
      if (!c.offsetWidth) return;
      var ratio = Math.max(window.devicePixelRatio || 1, 1);
      var w = Math.round(c.offsetWidth * ratio), h = Math.round(c.offsetHeight * ratio);
      if (c.width === w && c.height === h) return;
      c.width = w; c.height = h;
      c.getContext('2d').scale(ratio, ratio);
      o.pad.clear();
      if (o.url) o.pad.fromDataURL(o.url, { ratio: ratio, width: c.offsetWidth, height: c.offsetHeight });
    });
  }
  function setPadData(id, url) {
    var o = pads[id]; if (!o) return;
    o.pad.clear(); o.url = url || null;
    o.canvas.parentNode.classList.toggle('signed', !!url);
    if (url && o.canvas.offsetWidth) {
      var ratio = Math.max(window.devicePixelRatio || 1, 1);
      o.pad.fromDataURL(url, { ratio: ratio, width: o.canvas.offsetWidth, height: o.canvas.offsetHeight });
    }
  }
  /* Recorta la firma a su contenido (para que se vea grande y nítida en el PDF) */
  function trimmedSignature(id) {
    var o = pads[id]; if (!o || !o.url) return null;
    var c = o.canvas, ctx = c.getContext('2d');
    var w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    var pad = Math.round(6 * (window.devicePixelRatio || 1));
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    var tw = x1 - x0 + 1, th = y1 - y0 + 1;
    var t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
    return { data: t.toDataURL('image/png'), w: tw, h: th };
  }

  /* ---------- borrador automático (por si se cierra la app) ---------- */
  function saveDraftSoon() {
    if (restoring) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { HC.kvSet('draft_' + kind, collectForm()).catch(function () {}); }, 500);
  }

  /* ---------- validación ---------- */
  function validate(d) {
    var errs = [];
    $$('.invalid').forEach(function (e) { e.classList.remove('invalid'); });
    function bad(name, msg) { errs.push(msg); var el = $('#actaForm').elements[name]; if (el) el.classList.add('invalid'); }
    if (!d.cliente) bad('cliente', 'Escriba el cliente.');
    if (d.correoCliente && !validEmail(d.correoCliente)) bad('correoCliente', 'El correo del cliente no es válido.');
    if (!d.items.some(function (it) { return it.tipo; })) {
      errs.push('Indique el tipo de cada equipo (horno, lavadora, nevera…). Puede elegir de la lista o escribir otro.');
      var first = $('#items .item [data-f="tipo"]'); if (first) first.classList.add('invalid');
    }
    if (!d.tecNombre) bad('tecNombre', 'Falta el nombre del técnico.');
    if (!d.cliNombre) bad('cliNombre', 'Falta el nombre de quien firma por el cliente.');
    if (!d.sigTec) errs.push('Falta la firma del técnico.');
    if (!d.sigCli) errs.push('Falta la firma del cliente.');
    return errs;
  }

  /* ---------- generar y enviar ---------- */
  async function generate() {
    var btn = $('#btnGenerate');
    if (btn.disabled) return;
    var d = collectForm();
    var errs = validate(d);
    var box = $('#formErrors');
    if (errs.length) {
      box.innerHTML = '<b>Revise antes de generar:</b><ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    box.hidden = true;
    btn.disabled = true; btn.textContent = 'Generando PDF…';
    try {
      S = await HC.getSettings();
      var id = await HC.takeConsecutive(kind);
      var now = new Date().toISOString();
      var tSig = trimmedSignature('sigTec'), cSig = trimmedSignature('sigCli');
      var acta = {
        id: id, kind: kind, createdAt: now,
        cliente: d.cliente, nit: d.nit, correoCliente: d.correoCliente, oc: d.oc, albaran: d.albaran,
        direccion: d.direccion, sede: d.sede, ciudad: d.ciudad, contacto: d.contacto, telefono: d.telefono, cargoContacto: d.cargoContacto,
        tipoServicio: d.tipoServicio, tipoOtro: d.tipoOtro,
        items: d.items.filter(function (it) { return it.tipo || it.marca || it.modelo || it.serie || it.activo; }),
        fotos: d.fotos,
        firmaTecnico: { nombre: d.tecNombre, cedula: d.tecCedula, cargo: d.tecCargo, firma: tSig && tSig.data, firmaW: tSig && tSig.w, firmaH: tSig && tSig.h, firmadoEn: now },
        firmaCliente: { nombre: d.cliNombre, cedula: d.cliCedula, cargo: d.cliCargo, firma: cSig && cSig.data, firmaW: cSig && cSig.w, firmaH: cSig && cSig.h, firmadoEn: now },
        status: 'pendiente', attempts: 0, appVersion: APP_VERSION
      };
      if (!logoData) logoData = await loadLogo();
      acta.pdf = HCPDF.buildPdf(acta, S, logoData);
      acta.pdfSize = acta.pdf.size;
      await HC.putActa(acta);
      await rememberClient(acta);
      await HC.kvDel('draft_' + kind);
      lastActa = acta;
      // nuevo formulario en blanco detrás del modal
      await openForm(kind, true);
      showModal(acta);
      requestSync();
      HC.processOutbox().then(updateModalStatus);
    } catch (e) {
      console.error(e);
      alert('No se pudo generar el acta: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = 'Generar y enviar';
    }
  }

  async function rememberClient(a) {
    S = await HC.getSettings();
    var c = findClient(a.cliente);
    if (!c) { c = { nombre: a.cliente }; S.clientes = (S.clientes || []).concat([c]); }
    var map = { nit: 'nit', correo: 'correoCliente', direccion: 'direccion', sede: 'sede', ciudad: 'ciudad', contacto: 'contacto', telefono: 'telefono', cargo: 'cargoContacto' };
    Object.keys(map).forEach(function (k) { if (a[map[k]]) c[k] = a[map[k]]; });
    await HC.saveSettings(S);
  }

  function loadLogo() {
    return fetch('assets/logo.jpg').then(function (r) { return r.blob(); }).then(blobToDataURL);
  }

  /* ---------- modal de resultado / compartir ---------- */
  function showModal(a) {
    $('#mTitle').textContent = HC.docLabel(a);
    $('#mSub').textContent = a.cliente + ' · ' + nowLabel(a.createdAt) + ' (hora de Bogotá) · ' + Math.round(a.pdf.size / 1024) + ' KB';
    $('#modal').hidden = false;
    updateModalStatus();
  }
  async function updateModalStatus() {
    if (!lastActa || $('#modal').hidden) return;
    var a = await HC.getActa(lastActa.id); if (!a) return;
    lastActa = a;
    $('#mStatus').innerHTML = statusHtml(a, true);
  }
  function statusHtml(a, long) {
    var to = esc(recipientsOf(a).join(' y '));
    if (a.status === 'enviado') return '<span class="badge ok">Enviado</span> ' + (long ? 'Correo enviado a ' + to + '.' : esc(nowLabel(a.sentAt)));
    if (a.sendingSince) return '<span class="badge pend">Enviando…</span> ' + (long ? 'a ' + to : '');
    var why;
    if (!S.apiUrl || !S.apiToken) why = 'Falta configurar el script de envío en Ajustes.';
    else if (navigator.onLine === false) why = 'Sin señal: se enviará solo a ' + to + ' apenas vuelva la conexión.';
    else if (a.lastError) why = 'Último intento: ' + esc(a.lastError) + '. Se reintentará automáticamente.';
    else why = 'En cola para ' + to + '.';
    return '<span class="badge ' + (a.lastError ? 'err' : 'pend') + '">Pendiente de envío</span> ' + why;
  }
  function pdfFile(a) { return new File([a.pdf], a.id + '_' + (a.cliente || 'acta').replace(/[^\w-]+/g, '_') + '.pdf', { type: 'application/pdf' }); }
  function shareText(a) {
    if (a.kind === 'orden' || a.kind === 'cobro') {
      var head = a.kind === 'cobro' ? HC.docLabel(a) + ' · ' + ((S.persona && S.persona.nombre) || '') : HC.docLabel(a) + ' · ' + S.empresa.nombre;
      var foot = a.kind === 'cobro' ? ((S.persona && S.persona.nombre) || '') + ' · Tel. ' + ((S.persona && S.persona.telefono) || '') : S.empresa.marca + ' · Tel. ' + S.empresa.tel1 + ' · ' + S.empresa.email;
      return [head, 'Cliente: ' + a.cliente, 'Fecha: ' + nowLabel(a.createdAt), HC.resumenTexto(a), '', foot].join('\n');
    }
    var lines = [kindTitle(a.kind) + ' ' + a.id + ' · ' + S.empresa.nombre, 'Cliente: ' + a.cliente + (a.sede ? ' · ' + a.sede : ''), a.oc ? 'OC / REQ: ' + a.oc : '', 'Fecha: ' + nowLabel(a.createdAt), 'Equipos:', HC.resumenTexto(a), '', S.empresa.marca + ' · Tel. ' + S.empresa.tel1 + ' · ' + S.empresa.email];
    return lines.filter(function (l, i) { return l !== '' || i === 6; }).join('\n');
  }
  async function shareActa(a) {
    var f = pdfFile(a);
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: HC.docLabel(a), text: shareText(a) }); }
      catch (e) { if (e && e.name !== 'AbortError') { toast('No se pudo compartir; se descargó el PDF'); downloadActa(a); } }
    } else {
      downloadActa(a);
      toast('Este navegador no comparte archivos: se descargó el PDF para adjuntarlo', 4000);
    }
  }
  function downloadActa(a) {
    var url = URL.createObjectURL(a.pdf);
    var l = document.createElement('a'); l.href = url; l.download = pdfFile(a).name; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  function viewActa(a) {
    var url = URL.createObjectURL(a.pdf);
    var w = window.open(url, '_blank');
    if (!w) downloadActa(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }
  async function whatsActa(a) {
    var f = pdfFile(a);
    var text = shareText(a);
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title: HC.docLabel(a), text: text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    downloadActa(a);
    var tel = String((S && S.whatsappDefault) || a.telefono || '').replace(/\D/g, '');
    if (tel.length === 10 && tel[0] === '3') tel = '57' + tel;
    var url = 'https://wa.me/' + (tel.length >= 11 ? tel : '') + '?text=' + encodeURIComponent(text + '\n\n(El PDF se descargó; adjúntelo en el chat.)');
    toast('Se descargó el PDF para adjuntarlo en WhatsApp', 4000);
    window.open(url, '_blank');
  }
  function mailActa(a) {
    var to = a.correoCliente && validEmail(a.correoCliente) ? a.correoCliente : S.empresa.email;
    var cc = to === S.empresa.email ? '' : S.empresa.email;
    var url = 'mailto:' + encodeURIComponent(to) + '?' + (cc ? 'cc=' + encodeURIComponent(cc) + '&' : '') +
      'subject=' + encodeURIComponent(HC.emailSubject(a, S)) +
      '&body=' + encodeURIComponent(shareText(a) + '\n\nAdjunto el PDF.');
    location.href = url;
  }

  /* ---------- cola de envío ---------- */
  function requestSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.sync && reg.sync.register) return reg.sync.register('enviar-actas');
    }).catch(function () {});
  }
  async function kickOutbox(force) {
    var r = await HC.processOutbox({ force: !!force });
    if (r && r.sent) toast(r.sent === 1 ? 'Acta enviada por correo ✓' : r.sent + ' actas enviadas por correo ✓');
    refreshLists();
    return r;
  }
  function refreshLists() {
    var v = currentView();
    if (v === 'home') renderHome();
    if (v === 'history') renderHistory();
    updateModalStatus();
  }

  /* ---------- HISTORIAL ---------- */
  async function renderHistory() {
    S = await HC.getSettings();
    var list = await HC.listActas();
    var box = $('#historyList');
    if (!list.length) { box.innerHTML = '<div class="empty">Todavía no hay documentos en este equipo.</div>'; return; }
    var KB = { entrega: ['Entrega', 'ent'], retiro: ['Recepción', ''], orden: ['Orden de servicio', 'os'], cobro: ['Cuenta de cobro', 'cc'] };
    box.innerHTML = list.map(function (a) {
      var det;
      if (a.kind === 'orden') det = [a.equipo && a.equipo.tipo, a.equipo && a.equipo.marca, 'Total ' + HC.money(a.total)].filter(Boolean).join(' · ');
      else if (a.kind === 'cobro') det = 'Valor ' + HC.money(a.total) + ' · ' + String(a.concepto || '').slice(0, 60);
      else det = (a.items || []).map(function (it) {
        return [it.tipo, it.marca, it.modelo, it.serie ? ('Serie ' + it.serie) : '', it.activo ? ('Activo ' + it.activo) : ''].filter(Boolean).join(' · ');
      }).join(' | ');
      var kb = KB[a.kind] || KB.entrega;
      var shown = a.kind === 'orden' ? 'OS No. ' + String(a.id).replace(/^OS-/, '') : a.id;
      return '<div class="hcard" data-id="' + esc(a.id) + '">' +
        '<div class="hc-top"><span class="hc-id">' + esc(shown) + '</span><span class="badge kind ' + kb[1] + '">' + kb[0] + '</span></div>' +
        '<div class="hc-meta">' + esc(a.cliente) + (a.oc ? ' · ' + esc(a.oc) : '') + '<br>' + esc(nowLabel(a.createdAt)) + ' · ' + esc(det) + '</div>' +
        '<div class="hc-meta">' + statusHtml(a, false) + '</div>' +
        '<div class="hc-btns"><button class="btn tiny ghost" data-h="view">Ver PDF</button><button class="btn tiny ghost" data-h="share">Compartir</button>' +
        '<button class="btn tiny whatsapp" data-h="whats">Enviar por WhatsApp</button>' +
        '<button class="btn tiny ghost" data-h="resend">' + (a.status === 'enviado' ? 'Reenviar correo' : 'Reintentar') + '</button><button class="btn tiny danger" data-h="del">Eliminar</button></div></div>';
    }).join('');
  }
  async function onHistoryClick(e) {
    var b = e.target.closest('[data-h]'); if (!b) return;
    var id = b.closest('.hcard').dataset.id;
    var a = await HC.getActa(id); if (!a) return;
    var act = b.dataset.h;
    if (act === 'view') viewActa(a);
    if (act === 'share') shareActa(a);
    if (act === 'whats') whatsActa(a);
    if (act === 'resend') {
      a.status = 'pendiente'; a.sendingSince = null; a.lastError = null; await HC.putActa(a);
      requestSync(); await kickOutbox(true);
      if (navigator.onLine === false) toast('Sin señal: quedó en cola');
    }
    if (act === 'del') {
      if (a.status !== 'enviado' && !confirm('Este documento NO se ha enviado por correo. ¿Eliminarlo igual?')) return;
      if (!confirm('¿Eliminar ' + a.id + ' de este celular? No se puede deshacer.')) return;
      await HC.deleteActa(id); renderHistory();
    }
  }
  async function exportCsv() {
    var list = (await HC.listActas()).slice().reverse();
    var head = ['Clase', 'Fecha', 'Tipo', 'Cliente', 'Sede / dirección', 'OC / REQ / Pedido', 'Tipo de equipo', 'Marca', 'Modelo', 'Serie', 'Código interno / activo fijo del cliente', 'Características', 'Estado', 'Técnico', 'Acta No.', 'Observaciones'];
    var EST = { bueno: 'Bueno', regular: 'Regular', malo: 'Malo' };
    var rows = [head];
    list.forEach(function (a) {
      if (a.kind === 'orden' || a.kind === 'cobro') {
        var env = a.status === 'enviado' ? 'Correo enviado ' + nowLabel(a.sentAt) : 'Correo pendiente de envío';
        if (a.kind === 'orden') {
          var e = a.equipo || {};
          rows.push(['', HCPDF.fmtDate(a.createdAt), 'Orden de servicio', a.cliente, [a.direccion, a.ciudad].filter(Boolean).join(', '), a.ticket, e.tipo, e.marca, e.modelo, e.serie, '', a.tipoServicio, '', (a.firmaTecnico || {}).nombre, 'OS No. ' + a.numero, ['Total ' + HC.money(a.total), a.falla ? 'Falla: ' + a.falla : '', a.observaciones || '', env].filter(Boolean).join(' | ')]);
        } else {
          rows.push(['', HCPDF.fmtDate(a.createdAt), 'Cuenta de cobro', a.cliente, [a.direccion, a.ciudad].filter(Boolean).join(', '), '', '', '', '', '', '', a.concepto, '', '', a.id, ['Valor ' + HC.money(a.total), env].join(' | ')]);
        }
        return;
      }
      (a.items || []).forEach(function (it) {
        var estado = [EST[it.estado] || '', it.enciende ? 'Enciende: ' + (it.enciende === 'si' ? 'Sí' : 'No') : '', it.pruebas ? 'Pruebas: ' + (it.pruebas === 'ok' ? 'OK' : 'No OK') : ''].filter(Boolean).join(' · ');
        var obs = [it.trabajo ? 'Trabajo: ' + it.trabajo : '', it.repuestos ? 'Repuestos: ' + it.repuestos : '', it.garantia ? 'Garantía: ' + (HCPDF.GARANTIAS[it.garantia] || '') : '', it.observaciones || '', a.status === 'enviado' ? 'Correo enviado ' + nowLabel(a.sentAt) : 'Correo pendiente de envío'].filter(Boolean).join(' | ');
        rows.push(['', HCPDF.fmtDate(a.createdAt), a.kind === 'entrega' ? 'Entrega' : 'Recepción', a.cliente, [a.sede, a.direccion, a.ciudad].filter(Boolean).join(', '), a.oc, it.tipo, it.marca, it.modelo, it.serie, it.activo, it.caracteristicas, estado, (a.firmaTecnico || {}).nombre, a.id, obs]);
      });
    });
    var csv = '\ufeff' + rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var name = 'Registro_Entregas_Recepciones_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
    var f = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [f] }) && confirm('¿Compartir el CSV? (Cancelar = descargar)')) {
      try { await navigator.share({ files: [f], title: name }); return; } catch (e) {}
    }
    var url = URL.createObjectURL(blob);
    var l = document.createElement('a'); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* ---------- AJUSTES ---------- */
  function getPath(o, p) { return p.split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'); var last = ks.pop(); var t = ks.reduce(function (x, k) { return x[k] = x[k] || {}; }, o); t[last] = v; }
  var CLIENT_FIELDS = [['nombre', 'Nombre'], ['nit', 'NIT'], ['correo', 'Correo (recibe copia)'], ['direccion', 'Dirección'], ['sede', 'Sede / área'], ['ciudad', 'Ciudad'], ['contacto', 'Contacto'], ['telefono', 'Teléfono'], ['cargo', 'Cargo del contacto']];
  async function renderSettings() {
    S = await HC.getSettings();
    var f = $('#settingsForm');
    $$('input[name]', f).forEach(function (i) { var v = getPath(S, i.name); i.value = v == null ? '' : v; });
    $('#clientsEditor').innerHTML = '';
    (S.clientes || []).forEach(addClientEditor);
    $('#clientesList').innerHTML = (S.clientes || []).map(function (c) { return '<option value="' + esc(c.nombre) + '">'; }).join('');
    $('#versionInfo').textContent = 'Versión ' + APP_VERSION + ' · ID del celular: ' + S.deviceId;
    $('#pingResult').textContent = '';
  }
  function addClientEditor(c) {
    c = c || {};
    var d = document.createElement('div'); d.className = 'client';
    d.innerHTML = '<div class="item-h"><b class="item-n">' + esc(c.nombre || 'Nuevo cliente') + '</b><button type="button" class="btn tiny danger">Quitar</button></div>' +
      CLIENT_FIELDS.map(function (fd) {
        var type = fd[0] === 'correo' ? 'email' : (fd[0] === 'telefono' ? 'tel' : 'text');
        var ph = fd[0] === 'correo' ? ' placeholder="correo@cliente.com (vacío = no se envía al cliente)"' : '';
        return '<label>' + fd[1] + '<input data-cf="' + fd[0] + '" type="' + type + '"' + ph + '></label>';
      }).join('');
    CLIENT_FIELDS.forEach(function (fd) { $('[data-cf="' + fd[0] + '"]', d).value = c[fd[0]] || ''; });
    $('button', d).addEventListener('click', function () { if (confirm('¿Quitar este cliente de la lista?')) d.remove(); });
    $('#clientsEditor').appendChild(d);
  }
  async function saveSettingsForm() {
    var cur = await HC.getSettings();
    var f = $('#settingsForm');
    var errs = [];
    $$('input[name]', f).forEach(function (i) {
      var v = i.value.trim();
      if (i.type === 'number') v = parseInt(v, 10) || 1;
      setPath(cur, i.name, v);
    });
    cur.clientes = $$('#clientsEditor .client').map(function (d) {
      var c = {}; CLIENT_FIELDS.forEach(function (fd) { c[fd[0]] = $('[data-cf="' + fd[0] + '"]', d).value.trim(); }); return c;
    }).filter(function (c) { return c.nombre; });
    cur.clientes.forEach(function (c) { if (c.correo && !validEmail(c.correo)) errs.push('Correo inválido para ' + c.nombre); });
    cur.empresa.email = HC.COMPANY_EMAIL;
    if (cur.correoClienteDefault && !validEmail(cur.correoClienteDefault)) errs.push('El correo del cliente por defecto no es válido');
    if (cur.apiUrl && !/^https?:\/\//i.test(cur.apiUrl)) errs.push('La URL del script debe empezar por https://');
    if (errs.length) { alert(errs.join('\n')); return; }
    await HC.saveSettings(cur);
    S = cur;
    toast('Ajustes guardados');
    kickOutbox();
    go('home');
  }
  async function ping() {
    var f = $('#settingsForm');
    var out = $('#pingResult');
    out.textContent = 'Probando…';
    try {
      var r = await HC.pingServer(f.elements.apiUrl.value.trim(), f.elements.apiToken.value.trim());
      out.textContent = '✅ Conexión correcta' + (r.service ? ' (' + r.service + ')' : '') + '.';
    } catch (e) { out.textContent = '❌ ' + (e.message || e); }
  }

  /* ================= ORDEN DE SERVICIO y CUENTA DE COBRO (v1.3.0) ================= */
  var DOCF = { orden: '#ordenForm', cobro: '#cobroForm' };
  var PADS_OF = { orden: ['osSigCli', 'osSigTec'], cobro: ['ccSigEmi', 'ccSigCli'] };
  var DOC_FIELDS = {
    orden: ['cliente', 'nit', 'telefono', 'direccion', 'ciudad', 'ticket', 'visita', 'correoCliente', 'eqTipo', 'eqMarca', 'eqModelo', 'eqSerie', 'falla', 'observaciones', 'cliNombre', 'cliCedula', 'tecNombre', 'tecCedula'],
    cobro: ['cliente', 'nit', 'telefono', 'direccion', 'ciudad', 'correoCliente', 'ciudadExp', 'fecha', 'concepto', 'pilaNumero', 'pilaPeriodo', 'recNombre', 'recCedula']
  };
  var docInit = {}, docTimer = {}, docRestoring = false;
  var MAX_LINES = { orden: 10, cobro: 8 };

  function digits(v) { return parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10) || 0; }
  function fmtNum(n) { n = digits(n); return n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''; }
  function localNow() {
    var o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day + 'T' + o.hour + ':' + o.minute;
  }
  function docForm(k) { return $(DOCF[k]); }
  function docBlank(k) {
    if (k === 'orden') return {
      ciudad: 'Bogotá D.C.', visita: localNow(), tipoServicio: 'Reparación', lineas: [{}], aplicaIva: false, formaPago: [], garantia: '90',
      tecNombre: S.tecnico.nombre || '', tecCedula: S.tecnico.cedula || ''
    };
    return { ciudad: 'Bogotá D.C.', ciudadExp: (S.persona && S.persona.ciudad) || 'Bogotá D.C.', fecha: localNow().slice(0, 10), items: [{ cant: 1 }], retencion: '' };
  }
  function personaMissing() {
    var P = S.persona || {}, miss = [];
    if (!P.cedula) miss.push('cédula');
    if (!P.direccion) miss.push('dirección');
    if (!P.email) miss.push('correo');
    if (!P.banco || !P.numeroCuenta) miss.push('cuenta donde le pagan');
    return miss;
  }
  function renderIssuer() {
    var P = S.persona || {}, miss = personaMissing();
    $('#ccIssuer').innerHTML = '<span class="muted">Emitida por (persona natural):</span><br><b>' + esc(P.nombre) + '</b><br>' +
      'C.C. ' + esc(P.cedula || '____') + ' · Tel. ' + esc(P.telefono || '____') + '<br>' + esc(P.direccion || 'Dirección: ____') + (P.email ? ' · ' + esc(P.email) : '') +
      (P.banco ? '<br>Pago: ' + esc([P.banco, P.tipoCuenta, P.numeroCuenta].filter(Boolean).join(' · ')) : '') +
      (miss.length ? '<span class="warn">&#9888;&#65039; Faltan sus datos: ' + esc(miss.join(', ')) + '. Llénelos una vez en Ajustes › Mis datos (saldrán en blanco mientras tanto).</span>' : '');
  }

  async function openDoc(k, fresh) {
    S = await HC.getSettings();
    var draft = fresh ? null : await HC.kvGet('draft_' + k);
    var now = new Date().toISOString();
    if (k === 'orden') {
      $('#osNum').textContent = HC.previewConsecutive(S, 'orden').replace(/^OS-/, '');
      $('#osDate').textContent = nowLabel(now) + '\n(hora de Bogotá)';
      $('#osTipos').innerHTML = HCDOCS.TIPOS_OS.map(function (t) { return '<label class="chip"><input type="radio" name="tipoServicio" value="' + esc(t) + '"><span>' + esc(t) + '</span></label>'; }).join('');
      $('#osPagos').innerHTML = HCDOCS.PAGOS_OS.map(function (t) { return '<label class="chip"><input type="checkbox" name="formaPago" value="' + esc(t) + '"><span>' + esc(t) + '</span></label>'; }).join('');
    } else {
      $('#ccNum').textContent = HC.previewConsecutive(S, 'cobro');
      $('#ccDate').textContent = nowLabel(now) + '\n(hora de Bogotá)';
      renderIssuer();
    }
    $('#clientesList').innerHTML = (S.clientes || []).map(function (c) { return '<option value="' + esc(c.nombre) + '">'; }).join('');
    $$('.js-company-email').forEach(function (e) { e.textContent = S.empresa.email || HC.COMPANY_EMAIL; });
    fillDoc(k, draft || docBlank(k));
    $('.js-errors', docForm(k)).hidden = true;
    docInit[k] = true;
  }

  function fillDoc(k, d) {
    docRestoring = true;
    var f = docForm(k);
    DOC_FIELDS[k].forEach(function (n) { if (f.elements[n]) f.elements[n].value = d[n] || ''; });
    var box = $(k === 'orden' ? '#osLines' : '#ccLines'); box.innerHTML = '';
    var lines = k === 'orden' ? d.lineas : d.items;
    (lines && lines.length ? lines : [{}]).forEach(function (l) { addLine(k, l); });
    if (k === 'orden') {
      $$('input[name="tipoServicio"]', f).forEach(function (r) { r.checked = r.value === d.tipoServicio; });
      $$('input[name="formaPago"]', f).forEach(function (c) { c.checked = (d.formaPago || []).indexOf(c.value) >= 0; });
      $$('input[name="garantia"]', f).forEach(function (r) { r.checked = r.value === d.garantia; });
      f.elements.aplicaIva.checked = !!d.aplicaIva;
    } else {
      $$('input[name="retencion"]', f).forEach(function (r) { r.checked = r.value === (d.retencion || ''); });
    }
    PADS_OF[k].forEach(function (id) { setPadData(id, d[id] || null); });
    updateTotals(k);
    docRestoring = false;
  }

  function addLine(k, l) {
    l = l || {};
    var box = $(k === 'orden' ? '#osLines' : '#ccLines');
    if (box.children.length >= MAX_LINES[k]) { toast('Máximo ' + MAX_LINES[k] + ' líneas para que quepa en una hoja'); return null; }
    var d = document.createElement('div');
    d.className = 'line' + (k === 'cobro' ? ' cc' : '');
    d.innerHTML = '<label>Descripción<input data-l="desc"></label>' +
      (k === 'cobro' ? '<label>Cant.<input data-l="cant" inputmode="numeric"></label><label>Valor unitario<input data-l="vu" inputmode="numeric" placeholder="$"></label>'
        : '<label>Valor<input data-l="valor" inputmode="numeric" placeholder="$"></label>') +
      '<button type="button" class="btn tiny danger" aria-label="Quitar línea">&times;</button>';
    $('[data-l="desc"]', d).value = l.desc || '';
    if (k === 'cobro') { $('[data-l="cant"]', d).value = l.cant || 1; $('[data-l="vu"]', d).value = fmtNum(l.vu); }
    else $('[data-l="valor"]', d).value = fmtNum(l.valor);
    $$('[data-l="valor"],[data-l="vu"]', d).forEach(function (i) { i.addEventListener('blur', function () { i.value = fmtNum(i.value); }); });
    $('button', d).addEventListener('click', function () {
      if (box.children.length <= 1) { $$('input', d).forEach(function (i) { i.value = i.dataset.l === 'cant' ? 1 : ''; }); }
      else d.remove();
      updateTotals(k); saveDocDraftSoon(k);
    });
    box.appendChild(d);
    return d;
  }
  function collectLines(k) {
    return $$((k === 'orden' ? '#osLines' : '#ccLines') + ' .line').map(function (d) {
      var desc = $('[data-l="desc"]', d).value.trim();
      if (k === 'cobro') return { desc: desc, cant: digits($('[data-l="cant"]', d).value) || 1, vu: digits($('[data-l="vu"]', d).value) };
      return { desc: desc, valor: digits($('[data-l="valor"]', d).value) };
    });
  }
  function collectDoc(k) {
    var f = docForm(k), d = { kind: k };
    DOC_FIELDS[k].forEach(function (n) { d[n] = (f.elements[n].value || '').trim(); });
    if (k === 'orden') {
      d.lineas = collectLines(k);
      var t = $('input[name="tipoServicio"]:checked', f); d.tipoServicio = t ? t.value : '';
      d.formaPago = $$('input[name="formaPago"]:checked', f).map(function (c) { return c.value; });
      var g = $('input[name="garantia"]:checked', f); d.garantia = g ? g.value : '';
      d.aplicaIva = f.elements.aplicaIva.checked;
    } else {
      d.items = collectLines(k);
      var r = $('input[name="retencion"]:checked', f); d.retencion = r ? r.value : '';
    }
    PADS_OF[k].forEach(function (id) { d[id] = pads[id] && pads[id].url ? pads[id].url : null; });
    return d;
  }
  function updateTotals(k) {
    var lines = collectLines(k), m = HCDOCS.money;
    if (k === 'orden') {
      var f = docForm(k);
      var t = HCDOCS.totalsOS({ lineas: lines, aplicaIva: f.elements.aplicaIva.checked, ivaPct: 19 });
      var tarjeta = $$('input[name="formaPago"]:checked', f).some(function (c) { return c.value === 'Tarjeta (Bold)'; });
      $('#osTotals').innerHTML = '<div class="t-row"><span>Valor antes de IVA</span><b>' + m(t.subtotal) + '</b></div>' +
        '<div class="t-row"><span>IVA' + (f.elements.aplicaIva.checked ? ' (19 %)' : '') + '</span><b>' + (f.elements.aplicaIva.checked ? m(t.iva) : 'No aplica') + '</b></div>' +
        '<div class="t-row t-total"><span>TOTAL</span><span id="osTotal">' + m(t.total) + '</span></div>' +
        (tarjeta ? '<div class="t-card">Pagando con tarjeta (+5 %): ' + m(t.conTarjeta) + '</div>' : '');
    } else {
      var tot = HCDOCS.totalCC({ items: lines });
      $('#ccTotals').innerHTML = '<div class="t-row t-total"><span>TOTAL</span><span id="ccTotal">' + m(tot) + '</span></div><div class="t-words" id="ccWords">' + esc(numeroALetras(tot)) + '</div>';
    }
  }
  function saveDocDraftSoon(k) {
    if (docRestoring || !docInit[k]) return;
    clearTimeout(docTimer[k]);
    docTimer[k] = setTimeout(function () { HC.kvSet('draft_' + k, collectDoc(k)).catch(function () {}); }, 500);
  }

  function validateDoc(k, d) {
    var errs = [], f = docForm(k);
    $$('.invalid', f).forEach(function (e) { e.classList.remove('invalid'); });
    function bad(name, msg) { errs.push(msg); var el = f.elements[name]; if (el && el.classList) el.classList.add('invalid'); }
    if (!d.cliente) bad('cliente', 'Escriba el nombre del cliente.');
    if (d.correoCliente && !validEmail(d.correoCliente)) bad('correoCliente', 'El correo del cliente no es válido.');
    if (k === 'orden') {
      if (!d.eqTipo) bad('eqTipo', 'Indique el electrodoméstico (lavadora, nevera, horno…).');
      if (!d.cliNombre) bad('cliNombre', 'Falta el nombre de quien recibe (cliente).');
      if (!d.tecNombre) bad('tecNombre', 'Falta el nombre del técnico.');
      if (!d.osSigCli) errs.push('Falta la firma del cliente.');
      if (!d.osSigTec) errs.push('Falta la firma del técnico.');
    } else {
      if (!d.concepto) bad('concepto', 'Escriba el concepto del cobro.');
      if (!HCDOCS.totalCC({ items: d.items })) errs.push('Escriba el valor (al menos una línea con valor).');
      if (!d.ccSigEmi) errs.push('Falta la firma del emisor.');
    }
    return errs;
  }

  async function generateDoc(k) {
    var btn = $(k === 'orden' ? '#osGenerate' : '#ccGenerate');
    if (btn.disabled) return;
    S = await HC.getSettings();
    var d = collectDoc(k), errs = validateDoc(k, d), box = $('.js-errors', docForm(k));
    if (errs.length) {
      box.innerHTML = '<b>Revise antes de generar:</b><ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    box.hidden = true;
    if (k === 'cobro') {
      var miss = personaMissing();
      if (miss.length && !confirm('Faltan sus datos (' + miss.join(', ') + '). Saldrán como espacios en blanco. ¿Generar igual?')) return;
    }
    btn.disabled = true; btn.textContent = 'Generando PDF…';
    try {
      var id = await HC.takeConsecutive(k);
      var now = new Date().toISOString(), rec, doc;
      if (!logoData) logoData = await loadLogo();
      if (k === 'orden') {
        var lineas = d.lineas.filter(function (l) { return l.desc || l.valor; });
        var t = HCDOCS.totalsOS({ lineas: lineas, aplicaIva: d.aplicaIva, ivaPct: 19 });
        var sc = trimmedSignature('osSigCli'), st = trimmedSignature('osSigTec');
        rec = {
          id: id, kind: 'orden', numero: parseInt(id.replace(/^OS-/, ''), 10), createdAt: now,
          cliente: d.cliente, nit: d.nit, telefono: d.telefono, direccion: d.direccion, ciudad: d.ciudad, ticket: d.ticket, visita: d.visita, correoCliente: d.correoCliente,
          tipoServicio: d.tipoServicio, equipo: { tipo: d.eqTipo, marca: d.eqMarca, modelo: d.eqModelo, serie: d.eqSerie },
          falla: d.falla, observaciones: d.observaciones, lineas: lineas, aplicaIva: d.aplicaIva, ivaPct: 19,
          subtotal: t.subtotal, iva: t.iva, total: t.total, formaPago: d.formaPago, garantia: d.garantia,
          firmaCliente: { nombre: d.cliNombre, cedula: d.cliCedula, firma: sc && sc.data, firmaW: sc && sc.w, firmaH: sc && sc.h, firmadoEn: now },
          firmaTecnico: { nombre: d.tecNombre, cedula: d.tecCedula, firma: st && st.data, firmaW: st && st.w, firmaH: st && st.h, firmadoEn: now },
          status: 'pendiente', attempts: 0, appVersion: APP_VERSION
        };
        doc = HCDOCS.buildOrden(rec, S, logoData);
      } else {
        var items = d.items.filter(function (l) { return l.desc || l.vu; });
        var se = trimmedSignature('ccSigEmi'), sr = trimmedSignature('ccSigCli');
        rec = {
          id: id, kind: 'cobro', createdAt: now, fecha: d.fecha, ciudadExp: d.ciudadExp || 'Bogotá D.C.',
          cliente: d.cliente, nit: d.nit, telefono: d.telefono, direccion: d.direccion, ciudad: d.ciudad, correoCliente: d.correoCliente,
          deudor: { nombre: d.cliente, nit: d.nit, direccion: d.direccion, ciudad: d.ciudad, telefono: d.telefono, email: d.correoCliente },
          concepto: d.concepto, items: items, total: HCDOCS.totalCC({ items: items }), retencion: d.retencion,
          pila: { numero: d.pilaNumero, periodo: d.pilaPeriodo },
          firmaEmisor: se ? { firma: se.data, firmaW: se.w, firmaH: se.h } : null,
          firmaRecibe: (sr || d.recNombre) ? { nombre: d.recNombre, cedula: d.recCedula, firma: sr && sr.data, firmaW: sr && sr.w, firmaH: sr && sr.h } : null,
          emisor: Object.assign({}, S.persona),
          status: 'pendiente', attempts: 0, appVersion: APP_VERSION
        };
        doc = HCDOCS.buildCuenta(Object.assign({}, rec, { ciudad: rec.ciudadExp }), S.persona);
      }
      rec.pdf = doc.output('blob');
      rec.pdfPages = doc.getNumberOfPages();
      rec.pdfSize = rec.pdf.size;
      await HC.putActa(rec);
      await rememberClient(rec);
      await HC.kvDel('draft_' + k);
      lastActa = rec;
      await openDoc(k, true);
      showModal(rec);
      requestSync();
      HC.processOutbox().then(updateModalStatus);
    } catch (e) {
      console.error(e);
      alert('No se pudo generar el documento: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = 'Generar y enviar';
    }
  }

  function bindDocForms() {
    ['orden', 'cobro'].forEach(function (k) {
      var f = docForm(k);
      f.addEventListener('input', function (e) { if (e.target.dataset && e.target.dataset.l) updateTotals(k); saveDocDraftSoon(k); });
      f.addEventListener('change', function (e) {
        if (e.target.name === 'cliente') {
          var c = findClient(e.target.value);
          if (c) [['nit', 'nit'], ['correoCliente', 'correo'], ['direccion', 'direccion'], ['ciudad', 'ciudad'], ['telefono', 'telefono']]
            .forEach(function (m) { if (c[m[1]]) f.elements[m[0]].value = c[m[1]]; });
        }
        if (e.target.name === 'aplicaIva' || e.target.name === 'formaPago') updateTotals(k);
        e.target.classList && e.target.classList.remove('invalid');
        saveDocDraftSoon(k);
      });
    });
    $('#osAddLine').addEventListener('click', function () { var n = addLine('orden'); if (n) { $('input', n).focus(); saveDocDraftSoon('orden'); } });
    $('#ccAddLine').addEventListener('click', function () { var n = addLine('cobro'); if (n) { $('input', n).focus(); saveDocDraftSoon('cobro'); } });
    $$('[data-newdoc]').forEach(function (b) { b.addEventListener('click', function () { openDoc(b.dataset.newdoc).then(function () { go(b.dataset.newdoc); }); }); });
    $$('[data-generate]').forEach(function (b) { b.addEventListener('click', function () { generateDoc(b.dataset.generate); }); });
    $$('[data-discard]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.discard;
        if (confirm('¿Limpiar el formulario? Se pierde lo que lleva escrito.')) { HC.kvDel('draft_' + k); openDoc(k, true); }
      });
    });
  }

  /* ---------- arranque ---------- */
  async function init() {
    S = await HC.getSettings();
    ['sigTec', 'sigCli', 'osSigCli', 'osSigTec', 'ccSigEmi', 'ccSigCli'].forEach(initPad);
    $$('[data-clear]').forEach(function (b) { b.addEventListener('click', function () { setPadData(b.dataset.clear, null); padChanged(b.dataset.clear); }); });
    bindDocForms();
    $$('[data-new]').forEach(function (b) { b.addEventListener('click', function () { openForm(b.dataset.new).then(function () { go('form'); }); }); });
    $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });
    $('#btnBack').addEventListener('click', function () { if (history.length > 1) history.back(); else go('home'); });
    $('#btnAddItem').addEventListener('click', function () { var n = addItem(); n.scrollIntoView({ behavior: 'smooth', block: 'start' }); saveDraftSoon(); });
    $('#inCamera').addEventListener('change', onFiles);
    $('#inGallery').addEventListener('change', onFiles);
    $('#actaForm').addEventListener('input', saveDraftSoon);
    $('#actaForm').addEventListener('change', function (e) {
      if (e.target.name === 'cliente') {
        var c = findClient(e.target.value);
        if (c) {
          var f = $('#actaForm');
          [['nit', 'nit'], ['correoCliente', 'correo'], ['direccion', 'direccion'], ['sede', 'sede'], ['ciudad', 'ciudad'], ['contacto', 'contacto'], ['telefono', 'telefono'], ['cargoContacto', 'cargo']]
            .forEach(function (m) { f.elements[m[0]].value = c[m[1]] || ''; });
        }
      }
      e.target.classList && e.target.classList.remove('invalid');
      saveDraftSoon();
    });
    $('#btnGenerate').addEventListener('click', generate);
    $('#btnDiscard').addEventListener('click', function () {
      if (confirm('¿Limpiar el formulario? Se pierde lo que lleva escrito.')) { HC.kvDel('draft_' + kind); openForm(kind, true); }
    });
    $('#mShare').addEventListener('click', function () { shareActa(lastActa); });
    $('#mDownload').addEventListener('click', function () { downloadActa(lastActa); });
    $('#mView').addEventListener('click', function () { viewActa(lastActa); });
    $('#mWhats').addEventListener('click', function () { whatsActa(lastActa); });
    $('#mMail').addEventListener('click', function () { mailActa(lastActa); });
    $('#mNew').addEventListener('click', function () { $('#modal').hidden = true; window.scrollTo(0, 0); setTimeout(resizePads, 30); });
    $('#historyList').addEventListener('click', onHistoryClick);
    $('#btnSendNow').addEventListener('click', async function () {
      if (navigator.onLine === false) { toast('Sin señal: se enviarán solas al volver la conexión'); return; }
      var r = await kickOutbox(true);
      if (r && r.noConfig) toast('Configure el script de envío en Ajustes');
      else if (r && !r.sent && !r.failed) toast('No hay actas pendientes');
      else if (r && r.failed) toast(r.failed + ' acta(s) no se pudieron enviar; se reintentará');
    });
    $('#btnCsv').addEventListener('click', exportCsv);
    $('#btnSaveSettings').addEventListener('click', saveSettingsForm);
    $('#btnAddClient').addEventListener('click', function () { addClientEditor({ ciudad: 'Bogotá' }); });
    $('#btnPing').addEventListener('click', ping);

    window.addEventListener('hashchange', render);
    window.addEventListener('resize', function () { clearTimeout(resizePads._t); resizePads._t = setTimeout(resizePads, 150); });
    window.addEventListener('online', function () { renderNet(); toast('Volvió la conexión: enviando pendientes…'); kickOutbox(); });
    window.addEventListener('offline', function () { renderNet(); refreshLists(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') kickOutbox(); });
    try { var ch = new BroadcastChannel('hc-outbox'); ch.onmessage = function () { refreshLists(); }; } catch (e) {}
    setInterval(function () { if (navigator.onLine !== false) HC.processOutbox().then(function (r) { if (r && (r.sent || r.failed)) refreshLists(); }); }, 45000);

    renderNet();
    loadLogo().then(function (d) { logoData = d; }).catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW', e); });
    if (currentView() === 'form') await openForm(kind);
    if (currentView() === 'orden' || currentView() === 'cobro') await openDoc(currentView());
    render();
    kickOutbox();
  }

  window.HCApp = { version: APP_VERSION, kickOutbox: kickOutbox, openDoc: openDoc };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
