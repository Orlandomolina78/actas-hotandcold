/* Hot and Cold · Orden de servicio (empresa, 1 hoja carta) y Cuenta de cobro (persona natural, 1 hoja carta).
 * jsPDF. Requiere jspdf.umd.min.js y numero-letras.js. Expone self.HCDOCS.
 * Nunca agrega páginas: si el contenido no cabe, reduce la escala y recorta textos largos con "…". */
(function (g) {
  'use strict';
  var NAVY = [27, 54, 93], TEAL = [12, 107, 107], GRAY = [85, 85, 85], LINE = [160, 172, 188];
  var WHITE = [255, 255, 255], BLACK = [25, 25, 25], SOFT = [238, 243, 249], RED = [178, 28, 28];
  var PW = 215.9, PH = 279.4;                       // carta
  var SCALES = [1.16, 1.12, 1.08, 1.04, 1, 0.95, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7];

  var TIPOS_OS = ['Reparación', 'Mantenimiento preventivo', 'Instalación', 'Diagnóstico / visita', 'Garantía'];
  var PAGOS_OS = ['Nequi', 'Daviplata', 'Davivienda', 'Bancolombia', 'Efectivo', 'Tarjeta (Bold)'];
  var MARCAS_OS = ['WHIRLPOOL', 'LG', 'SAMSUNG', 'ELECTROLUX', 'GE'];
  var SERVICIOS_TXT = 'Reparación, mantenimiento e instalación de línea blanca e industrial: lavadoras, secadoras, neveras, congeladores, hornos, estufas, cocinas industriales y aire acondicionado.';
  var GARANTIA_TXT = 'Reparaciones: 90 días sobre el trabajo realizado y los repuestos instalados. Mantenimiento preventivo: 15 días, solo para ajustes. La garantía se cuenta desde la fecha de esta orden y se hace válida presentando este documento. No cubre daños por mal uso, golpes, variaciones de voltaje, humedad, insectos o roedores, manipulación por terceros ni repuestos no suministrados por Hot and Cold.';
  var CARD_NOTE = 'Si el pago es realizado con tarjeta se sumará el 5% al valor final.';

  function str(v) { return String(v == null ? '' : v).trim(); }
  function money(n) { n = Math.round(Number(n) || 0); return '$ ' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtDate(iso) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)); }
  function fmtTime(iso) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)); }
  function fmtLong(iso) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)); }
  /* "2026-11-14T09:30" (hora local del formulario) -> "14/11/2026 09:30" */
  function fmtLocal(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(str(v));
    if (!m) return str(v);
    return m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }
  function ymdLong(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
    if (!m) return str(v);
    var MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return parseInt(m[3], 10) + ' de ' + MES[parseInt(m[2], 10) - 1] + ' de ' + m[1];
  }
  function osNumber(o) { return o.numero ? String(o.numero) : String(o.id || '').replace(/^OS-/, ''); }

  function totalsOS(o) {
    var sub = (o.lineas || []).reduce(function (s, l) { return s + (Math.round(Number(l.valor) || 0)); }, 0);
    var pct = Number(o.ivaPct) || 19;
    var iva = o.aplicaIva ? Math.round(sub * pct / 100) : 0;
    var total = sub + iva;
    return { subtotal: sub, iva: iva, ivaPct: pct, total: total, conTarjeta: Math.round(total * 1.05) };
  }
  function totalCC(c) {
    var items = (c.items || []).filter(function (it) { return str(it.desc) || Number(it.vu); });
    if (items.length) return items.reduce(function (s, it) { return s + (Number(it.cant) || 1) * (Math.round(Number(it.vu) || 0)); }, 0);
    return Math.round(Number(c.valor) || 0);
  }

  function kit(doc, f) {
    var k = {
      f: f,
      font: function (s, b, i) { doc.setFont('helvetica', b ? (i ? 'bolditalic' : 'bold') : (i ? 'italic' : 'normal')); doc.setFontSize(s * f); },
      color: function (c) { doc.setTextColor(c[0], c[1], c[2]); },
      lh: function (s) { return s * f * 0.3528 * 1.2; },
      wrap: function (t, w, s, b, max) {
        k.font(s, b);
        var ls = doc.splitTextToSize(str(t), w);
        if (max && ls.length > max) {
          ls = ls.slice(0, max);
          var last = ls[max - 1];
          while (last.length > 1 && doc.getTextWidth(last + '…') > w) last = last.slice(0, -1);
          ls[max - 1] = last.replace(/\s+$/, '') + '…';
        }
        return ls;
      },
      text: function (t, x, y, o) { o = o || {}; k.font(o.size || 10, o.bold, o.italic); k.color(o.color || BLACK); doc.text(t, x, y, { align: o.align || 'left' }); },
      fit: function (t, x, y, w, o) {   // una línea que se encoge para caber en w
        o = o || {}; var s = o.size || 10;
        k.font(s, o.bold); while (s > 5 && doc.getTextWidth(t) > w) { s -= 0.25; k.font(s, o.bold); }
        k.color(o.color || BLACK); doc.text(t, x, y, { align: o.align || 'left' });
      },
      rect: function (x, y, w, h, fill, stroke) {
        doc.setLineWidth(0.25);
        if (fill) doc.setFillColor(fill[0], fill[1], fill[2]);
        var s = stroke || LINE; doc.setDrawColor(s[0], s[1], s[2]);
        doc.rect(x, y, w, h, fill ? (stroke === false ? 'F' : 'FD') : 'S');
      },
      box: function (x, y, on, s) {   // casilla; y = línea base del texto
        s = (s || 3.2) * f;
        var by = y - s + 0.4;
        doc.setLineWidth(0.3);
        if (on) {
          doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]); doc.setDrawColor(TEAL[0], TEAL[1], TEAL[2]); doc.rect(x, by, s, s, 'FD');
          doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.55);
          doc.line(x + s * .2, by + s * .55, x + s * .42, by + s * .78); doc.line(x + s * .42, by + s * .78, x + s * .82, by + s * .22);
        } else { doc.setDrawColor(70, 70, 70); doc.rect(x, by, s, s, 'S'); }
        return s;
      },
      opts: function (x, y, w, list, size, draw) {   // casillas en flujo; devuelve alto
        var lh = k.lh(size) + 1.6 * f, cx = x, cy = y;
        list.forEach(function (o) {
          k.font(size, o.on); var s = 3.2 * f, iw = s + 1.2 + doc.getTextWidth(o.label) + 4 * f;
          if (cx > x && cx + iw > x + w) { cx = x; cy += lh; }
          if (draw) { k.box(cx, cy, o.on); k.text(o.label, cx + s + 1.2, cy, { size: size, bold: o.on, color: o.on ? BLACK : GRAY }); }
          cx += iw;
        });
        return cy - y + lh;
      },
      watermark: function (txt) {
        if (doc.GState) { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.10 })); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(80); doc.setTextColor(RED[0], RED[1], RED[2]);
        doc.text(txt, PW / 2 - 10, PH / 2 + 35, { align: 'center', angle: 35 });
        if (doc.GState) doc.restoreGraphicsState();
      }
    };
    return k;
  }

  function newDoc(title, author) {
    var doc = new g.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({ title: title, author: author, creator: 'App Hot and Cold' });
    return doc;
  }

  function signature(doc, k, x, y, w, h, sig, rol, lines) {
    var f = k.f;
    k.rect(x, y, w, h, WHITE);
    k.text(rol, x + 2.2, y + 4 * f + 0.6, { size: 8.5, bold: true, color: NAVY });
    var lineY = y + h - lines.length * k.lh(8.6) - 3.2;
    if (sig && sig.firma) {
      var iw = sig.firmaW || 3, ih = sig.firmaH || 1, top = y + 5.6 * f + 0.6, bw = w - 12, bh = lineY - top - 0.6, sc = Math.min(bw / iw, bh / ih);
      if (bh > 2) doc.addImage(sig.firma, 'PNG', x + (w - iw * sc) / 2, top + (bh - ih * sc), iw * sc, ih * sc);
    }
    doc.setDrawColor(50, 50, 50); doc.setLineWidth(0.35); doc.line(x + 4, lineY, x + w - 4, lineY);
    lines.forEach(function (l, i) { k.fit(l, x + 3, lineY + 3.6 * f + 0.4 + i * k.lh(8.6), w - 6, { size: i === 0 ? 8.8 : 8.2, bold: i === 0 }); });
  }

  /* =============================== ORDEN DE SERVICIO =============================== */
  function renderOrden(doc, k, o, S, logo, lim) {
    var f = k.f, E = S.empresa || {}, M = 10, CW = PW - 2 * M, y;
    var T = totalsOS(o);

    // ---- Encabezado ----
    var LG = 25 * Math.max(f, 0.85);
    if (logo) doc.addImage(logo, 'JPEG', M - 0.5, 6.5, LG, LG);
    var bw = 58, bx = PW - M - bw, tx = M + LG + 2.5, tw = bx - tx - 3;
    var ty = 10.5;
    k.fit(E.nombre || 'HOT ANDA COLD SYSTEM SAS', tx, ty, tw, { size: 14.5, bold: true, color: NAVY }); ty += k.lh(14.5) - 0.4;
    k.fit('NIT ' + (E.nit || '901.694.443-5') + '   ·   Marca comercial: ' + (E.marca || 'Hot and Cold'), tx, ty, tw, { size: 9, bold: true, color: TEAL }); ty += k.lh(9) + 0.3;
    var sv = k.wrap(SERVICIOS_TXT, tw, 7.4, false, 3); k.color(GRAY); doc.text(sv, tx, ty); ty += sv.length * k.lh(7.4) + 0.3;
    var sedes = (S.sedes && S.sedes.length ? S.sedes : [{ nombre: 'Principal', direccion: E.direccion }]).map(function (s) {
      return 'Sede ' + str(s.nombre) + (str(s.direccion) ? ': ' + str(s.direccion) : '') + (str(s.telefono) ? ' (Tel. ' + str(s.telefono) + ')' : '');
    }).join('  ·  ');
    var sl = k.wrap(sedes, tw, 7.6, true, 2); k.color(BLACK); doc.text(sl, tx, ty); ty += sl.length * k.lh(7.6) + 0.3;
    k.fit((E.ciudad || 'Bogotá D.C.') + '   ·   Tel. ' + [E.tel1, E.tel2].filter(Boolean).join(' / ') + '   ·   ' + (E.email || 'hycsystem176746@gmail.com'), tx, ty, tw, { size: 7.8, color: GRAY });
    var hb = Math.max(ty + 2, 6.5 + LG + 0.5);
    // caja del número
    k.rect(bx, 6, bw, hb - 6, NAVY, false);
    k.text('ORDEN DE SERVICIO', bx + bw / 2, 11.2, { size: 12, bold: true, color: WHITE, align: 'center' });
    k.rect(bx + 4, 13.2, bw - 8, 10.8 * f + 1.5, WHITE, false);
    k.text('No.', bx + 7, 13.2 + 7.4 * f + 0.6, { size: 9, bold: true, color: GRAY });
    k.text(osNumber(o), bx + bw / 2 + 4, 13.2 + 8.4 * f + 0.8, { size: 21, bold: true, color: RED, align: 'center' });
    k.text('Fecha: ' + fmtDate(o.createdAt) + '   Hora: ' + fmtTime(o.createdAt), bx + bw / 2, hb - 2.2, { size: 8.4, color: WHITE, align: 'center' });
    y = hb + 1.6;
    // franja de marcas
    var mh = 6 * f + 0.6;
    k.rect(M, y, CW, mh, TEAL, false);
    k.fit('SERVICIO TÉCNICO:   ' + MARCAS_OS.join('   ·   ') + '   ·   Y OTRAS MARCAS', PW / 2, y + mh / 2 + 1.25 * f, CW - 6, { size: 9.4, bold: true, color: WHITE, align: 'center' });
    y += mh + 1.6;

    function bar(t, right) {
      var h = 5.4 * f + 0.4;
      k.rect(M, y, CW, h, NAVY, false);
      k.text(t, M + 2.2, y + h / 2 + 1.15 * f, { size: 8.8, bold: true, color: WHITE });
      if (right) k.text(right, PW - M - 2.2, y + h / 2 + 1.15 * f, { size: 8, color: WHITE, align: 'right' });
      y += h;
    }
    /* fila de celdas: etiqueta pequeña arriba, valor debajo. cells = [[label, value, width, bold]] */
    function row(cells, maxLines) {
      var LS = 6.6, VS = 9.6, h = 0;
      var prep = cells.map(function (c) {
        var vl = str(c[1]) ? k.wrap(c[1], c[2] - 3.2, VS, !!c[3], maxLines || 2) : [''];
        h = Math.max(h, k.lh(LS) + 0.9 + vl.length * k.lh(VS) + 1.3);
        return vl;
      });
      h = Math.max(h, 8.6 * f);
      var x = M;
      cells.forEach(function (c, i) {
        k.rect(x, y, c[2], h, WHITE);
        k.text(c[0], x + 1.6, y + k.lh(LS) + 0.15, { size: LS, bold: true, color: TEAL });
        k.font(VS, !!c[3]); k.color(BLACK); doc.text(prep[i], x + 1.6, y + k.lh(LS) + 0.9 + k.lh(VS) * 0.82);
        x += c[2];
      });
      y += h;
    }
    function textBox(label, val, minLines, maxLines) {
      var VS = 9.6, ls = str(val) ? k.wrap(val, CW - 4, VS, false, maxLines) : [];
      var n = Math.max(ls.length, minLines), h = k.lh(6.6) + 1 + n * k.lh(VS) + 1.6;
      k.rect(M, y, CW, h, WHITE);
      k.text(label, M + 1.6, y + k.lh(6.6) + 0.15, { size: 6.6, bold: true, color: TEAL });
      if (ls.length) { k.font(VS); k.color(BLACK); doc.text(ls, M + 1.6, y + k.lh(6.6) + 1 + k.lh(VS) * 0.82); }
      else {   // renglones para escribir a mano
        doc.setDrawColor(205, 212, 222); doc.setLineWidth(0.15);
        for (var i = 1; i <= n; i++) { var ly = y + k.lh(6.6) + 1 + i * k.lh(VS) + 0.4; if (ly < y + h - 0.6) doc.line(M + 1.6, ly, M + CW - 1.6, ly); }
      }
      y += h;
    }

    // ---- 1. Cliente ----
    bar('1.  DATOS DEL CLIENTE');
    var c1 = CW * 0.6, c2 = CW - c1, h1 = CW * 0.38, h2 = CW * 0.22;
    row([['NOMBRE / RAZÓN SOCIAL', o.cliente, c1, true], ['NIT / C.C.', o.nit, c2]], 1);
    row([['DIRECCIÓN', o.direccion, c1], ['CIUDAD', o.ciudad, c2]], 2);
    row([['TELÉFONO', o.telefono, CW - h1 - h2 - CW * 0.2], ['E-MAIL', o.correoCliente, h1], ['TICKET / OC', o.ticket, h2], ['FECHA Y HORA DE VISITA', fmtLocal(o.visita), CW * 0.2]], 1);
    y += 1.4;

    // ---- 2. Equipo ----
    bar('2.  EQUIPO Y SERVICIO');
    var q = CW / 4;
    row([['ELECTRODOMÉSTICO', o.equipo && o.equipo.tipo, q, true], ['MARCA', o.equipo && o.equipo.marca, q], ['MODELO', o.equipo && o.equipo.modelo, q], ['SERIE', (o.equipo && o.equipo.serie) || 'N/A', q]], 1);
    var tl = TIPOS_OS.map(function (t) { return { label: t, on: o.tipoServicio === t }; });
    var th = k.opts(M + 22 * f + 2, 0, CW - 24 * f - 3, tl, 8.6, false) + 1.6 * f;
    k.rect(M, y, CW, th, WHITE);
    k.text('TIPO DE SERVICIO', M + 1.6, y + k.lh(8.6) + 0.6 * f, { size: 6.6, bold: true, color: TEAL });
    k.opts(M + 22 * f + 2, y + k.lh(8.6) + 0.6 * f, CW - 24 * f - 3, tl, 8.6, true);
    y += th;
    textBox('FALLA REPORTADA POR EL CLIENTE', o.falla, 2, lim.falla);
    textBox('OBSERVACIONES TÉCNICAS / TRABAJO REALIZADO', o.observaciones, 3, lim.obs);
    y += 1.4;

    // ---- 3. Valores y pago ----
    bar('3.  DETALLE Y VALORES');
    var tw2 = CW * 0.6, rx = M + tw2 + 2.5, rw = CW - tw2 - 2.5, ty0 = y;
    var vw = 30;
    var hh = 5 * f + 0.4;
    k.rect(M, y, tw2 - vw, hh, SOFT); k.rect(M + tw2 - vw, y, vw, hh, SOFT);
    k.text('DESCRIPCIÓN', M + 1.6, y + hh / 2 + 1.1 * f, { size: 7.6, bold: true, color: NAVY });
    k.text('VALOR', M + tw2 - vw / 2, y + hh / 2 + 1.1 * f, { size: 7.6, bold: true, color: NAVY, align: 'center' });
    y += hh;
    var lines = (o.lineas || []).filter(function (l) { return str(l.desc) || Number(l.valor); });
    var minRows = Math.max(lim.minRows, lines.length);
    for (var i = 0; i < minRows; i++) {
      var l = lines[i], dl = l ? k.wrap(l.desc, tw2 - vw - 3.2, 9, false, 2) : [''];
      var rh = Math.max(5.6 * f + 0.4, dl.length * k.lh(9) + 1.8);
      k.rect(M, y, tw2 - vw, rh, WHITE); k.rect(M + tw2 - vw, y, vw, rh, WHITE);
      if (l) {
        k.font(9); k.color(BLACK); doc.text(dl, M + 1.6, y + k.lh(9) * 0.85 + 0.7);
        k.text(Number(l.valor) ? money(l.valor) : '', M + tw2 - 1.6, y + k.lh(9) * 0.85 + 0.7, { size: 9, align: 'right' });
      }
      y += rh;
    }
    var leftEnd = y;
    // columna derecha: totales + forma de pago
    y = ty0;
    var trows = [['Valor antes de IVA', money(T.subtotal), false]];
    trows.push([o.aplicaIva ? 'IVA (' + T.ivaPct + ' %)' : 'IVA', o.aplicaIva ? money(T.iva) : 'No aplica', false]);
    trows.push(['TOTAL', money(T.total), true]);
    trows.forEach(function (r) {
      var h = (r[2] ? 7.4 : 5.8) * f + 0.4;
      k.rect(rx, y, rw, h, r[2] ? NAVY : WHITE, r[2] ? false : undefined);
      k.text(r[0], rx + 1.8, y + h / 2 + (r[2] ? 1.5 : 1.15) * f, { size: r[2] ? 10.5 : 8.6, bold: true, color: r[2] ? WHITE : NAVY });
      k.text(r[1], rx + rw - 1.8, y + h / 2 + (r[2] ? 1.6 : 1.15) * f, { size: r[2] ? 12.5 : 9.4, bold: r[2], color: r[2] ? WHITE : BLACK, align: 'right' });
      y += h;
    });
    var tarjeta = (o.formaPago || []).indexOf('Tarjeta (Bold)') >= 0;
    var nl = k.wrap(CARD_NOTE + (tarjeta && T.total ? '  Total con tarjeta: ' + money(T.conTarjeta) + '.' : ''), rw - 2, 7.2, tarjeta, 3);
    k.font(7.2, tarjeta); k.color(tarjeta ? RED : GRAY); doc.text(nl, rx + 1, y + k.lh(7.2) + 0.2); y += nl.length * k.lh(7.2) + 1.2;
    var pl = PAGOS_OS.map(function (p) { return { label: p, on: (o.formaPago || []).indexOf(p) >= 0 }; });
    var ph = k.opts(rx + 1.8, 0, rw - 3, pl, 8.4, false) + k.lh(6.6) + 2;
    k.rect(rx, y, rw, ph, WHITE);
    k.text('FORMA DE PAGO', rx + 1.6, y + k.lh(6.6) + 0.15, { size: 6.6, bold: true, color: TEAL });
    k.opts(rx + 1.8, y + k.lh(6.6) + 1 + k.lh(8.4), rw - 3, pl, 8.4, true);
    y += ph;
    y = Math.max(y, leftEnd) + 1.4;

    // ---- Garantía ----
    var gopts = [['90', 'Reparación: 90 días'], ['15', 'Mant. preventivo: 15 días (solo ajustes)'], ['na', 'No aplica']].map(function (x) { return { label: x[1], on: o.garantia === x[0] }; });
    var gt = k.wrap(GARANTIA_TXT, CW - 4, 7, false);
    var goh = k.opts(M + 22 * f + 2, 0, CW - 24 * f - 3, gopts, 8.4, false);
    var gh = goh + gt.length * k.lh(7) + 2;
    k.rect(M, y, CW, gh, [250, 251, 253]);
    k.text('GARANTÍA', M + 1.6, y + k.lh(8.4) + 0.6 * f, { size: 8.6, bold: true, color: NAVY });
    k.opts(M + 22 * f + 2, y + k.lh(8.4) + 0.6 * f, CW - 24 * f - 3, gopts, 8.4, true);
    k.font(7); k.color(GRAY); doc.text(gt, M + 1.6, y + goh + k.lh(7) * 0.6 + 0.6);
    y += gh + 1.4;

    // ---- Firmas ----
    var acc = k.wrap('Con su firma, el cliente declara que recibió el servicio descrito y acepta los valores y las condiciones de garantía. Este documento no es factura de venta. Datos personales tratados según la Ley 1581 de 2012.', CW, 6.8, false, 2);
    k.font(6.8, false, true); k.color(GRAY); doc.text(acc, M, y + k.lh(6.8) * 0.8); y += acc.length * k.lh(6.8) + 0.8;
    var sw = (CW - 4) / 2, sh = 27 * f;
    var fc = o.firmaCliente || {}, ft = o.firmaTecnico || {};
    signature(doc, k, M, y, sw, sh, fc, 'QUIEN RECIBE (CLIENTE)', ['Nombre: ' + (str(fc.nombre) || '______________________________'), 'C.C.: ' + (str(fc.cedula) || '____________________')]);
    signature(doc, k, M + sw + 4, y, sw, sh, ft, 'TÉCNICO ' + String(E.marca || 'Hot and Cold').toUpperCase(), ['Nombre: ' + (str(ft.nombre) || '______________________________'), 'C.C.: ' + (str(ft.cedula) || '____________________')]);
    y += sh;
    return y;
  }

  function buildOrden(o, S, logo, opts) {
    opts = opts || {};
    var E = S.empresa || {};
    var doc, y, f, i;
    for (i = 0; i < SCALES.length; i++) {
      f = SCALES[i];
      var lim = { falla: i < 8 ? 4 : 3, obs: i < 8 ? 9 : (i < 10 ? 7 : 5), minRows: i < 7 ? 4 : (i < 10 ? 3 : 2) };
      doc = newDoc('Orden de servicio No. ' + osNumber(o), E.nombre || 'HOT ANDA COLD SYSTEM SAS');
      y = renderOrden(doc, kit(doc, f), o, S, logo, lim);
      if (y <= PH - 10) break;
    }
    var k = kit(doc, 1);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(10, PH - 8.2, PW - 10, PH - 8.2);
    k.text((E.nombre || '') + ' · NIT ' + (E.nit || '') + ' · Original: cliente · Copia: ' + (E.marca || 'Hot and Cold'), 10, PH - 4.8, { size: 7, color: GRAY });
    k.text('Orden de servicio No. ' + osNumber(o), PW - 10, PH - 4.8, { size: 7, color: GRAY, align: 'right' });
    if (opts.watermark) k.watermark(opts.watermark);
    doc.__scale = f;
    return doc;
  }

  /* =============================== CUENTA DE COBRO =============================== */
  /* Emisor = persona natural P (S.persona), sin logo ni NIT de la empresa. */
  function renderCuenta(doc, k, c, P, lim) {
    var f = k.f, M = 16, CW = PW - 2 * M, y = 16;
    var blank = function (v, n) { v = str(v); return v || new Array((n || 18) + 1).join('_'); };
    var D = c.deudor || {};

    k.text((str(c.ciudad) || 'Bogotá D.C.') + ', ' + (c.fecha ? ymdLong(c.fecha) : fmtLong(c.createdAt)), M, y + 4, { size: 11 });
    k.rect(PW - M - 62, y - 3, 62, 15 * f + 1, null, NAVY);
    k.text('CUENTA DE COBRO', PW - M - 31, y + 2.4, { size: 10.5, bold: true, color: NAVY, align: 'center' });
    k.text('No. ' + c.id, PW - M - 31, y + 2.4 + 6.4 * f, { size: 13, bold: true, color: NAVY, align: 'center' });
    y += 17 * f + 2;

    k.fit(str(D.nombre).toUpperCase() || '______________________________', PW / 2, y, CW, { size: 14.5, bold: true, align: 'center' }); y += 6.4 * f;
    k.text('NIT / C.C. ' + blank(D.nit), PW / 2, y, { size: 11, align: 'center' }); y += 5.4 * f;
    var dd = [str(D.direccion) && (str(D.direccion) + (str(D.ciudad) ? ', ' + str(D.ciudad) : '')), [str(D.telefono) && 'Tel. ' + str(D.telefono), str(D.email)].filter(Boolean).join('  ·  ')].filter(Boolean);
    dd.forEach(function (t) { k.fit(t, PW / 2, y, CW, { size: 9.6, color: GRAY, align: 'center' }); y += 4.8 * f; });
    y += 2.2 * f;

    k.text('DEBE A:', PW / 2, y, { size: 12.5, bold: true, color: NAVY, align: 'center' }); y += 6.8 * f;
    k.text(str(P.nombre).toUpperCase(), PW / 2, y, { size: 15.5, bold: true, align: 'center' }); y += 6.4 * f;
    var ccLine = 'C.C. ' + (str(P.cedula) || blank('', 16));
    if (str(P.cedulaExpedida)) ccLine += '  de  ' + str(P.cedulaExpedida);
    k.text(ccLine, PW / 2, y, { size: 11.5, align: 'center' }); y += 5.4 * f;
    var emisorBits = [];
    if (str(P.direccion)) emisorBits.push('Dirección: ' + str(P.direccion) + (str(P.ciudad) ? ', ' + str(P.ciudad) : ''));
    emisorBits.push('Tel. ' + (str(P.telefono) || blank('', 12)));
    if (str(P.email)) emisorBits.push('Correo: ' + str(P.email));
    k.fit(emisorBits.join('  ·  '), PW / 2, y, CW, { size: 9.6, color: GRAY, align: 'center' });
    y += 5.6 * f;

    var val = totalCC(c);
    var bh = 10.5 * f + 0.5;
    k.rect(M, y, CW, bh, [235, 242, 250], NAVY);
    k.text('LA SUMA DE:', M + 4, y + bh / 2 + 1.5 * f, { size: 10.5, bold: true, color: NAVY });
    k.text(money(val), M + 33 * f + 2, y + bh / 2 + 2 * f, { size: 16.5, bold: true, color: NAVY });
    y += bh;
    var words = k.wrap(g.numeroALetras(val), CW - 8, 11, true, 2);
    var wh = words.length * k.lh(11) + 4 * f;
    k.rect(M, y, CW, wh, WHITE, NAVY); k.font(11, true); k.color(BLACK); doc.text(words, M + 4, y + k.lh(11) * 0.85 + 2 * f); y += wh + 4.5 * f;

    k.text('POR CONCEPTO DE:', M, y, { size: 10.5, bold: true, color: NAVY }); y += 4.6 * f;
    var cl = k.wrap(c.concepto, CW, 11, false, lim.concepto);
    k.font(11); k.color(BLACK); doc.text(cl, M, y + 1.2); y += cl.length * k.lh(11) + 2.6 * f;
    var items = (c.items || []).filter(function (it) { return str(it.desc) || Number(it.vu); });
    if (items.length) {
      var cols = [['Descripción', CW - 18 - 34 - 34], ['Cant.', 18], ['Vr. unitario', 34], ['Vr. total', 34]];
      var x = M, hh = 6.4 * f + 0.4;
      cols.forEach(function (cc) { k.rect(x, y, cc[1], hh, TEAL, WHITE); k.text(cc[0], x + cc[1] / 2, y + hh / 2 + 1.3 * f, { size: 9, bold: true, color: WHITE, align: 'center' }); x += cc[1]; });
      y += hh;
      items.forEach(function (it) {
        var dl = k.wrap(it.desc, cols[0][1] - 3, 10, false, 2), h = dl.length * k.lh(10) + 2.8 * f; x = M;
        var cant = Number(it.cant) || 1;
        var vals = [dl, String(cant), money(it.vu), money(cant * (Number(it.vu) || 0))];
        cols.forEach(function (cc, i) {
          k.rect(x, y, cc[1], h, WHITE); k.font(10); k.color(BLACK);
          doc.text(vals[i], i === 0 ? x + 1.6 : i === 1 ? x + cc[1] / 2 : x + cc[1] - 1.6, y + k.lh(10) * 0.85 + 1.4 * f, { align: i === 0 ? 'left' : i === 1 ? 'center' : 'right' });
          x += cc[1];
        });
        y += h;
      });
    }
    y += 4.5 * f;

    k.text('DATOS PARA EL PAGO', M, y, { size: 10.5, bold: true, color: NAVY }); y += 2.2;
    var pr = [['Titular', str(P.nombre).toUpperCase() + '  ·  C.C. ' + blank(P.cedula, 14)]];
    var bankVal = [str(P.tipoCuenta), str(P.numeroCuenta) && ('No. ' + str(P.numeroCuenta))].filter(Boolean).join(' ');
    if (str(P.banco) || bankVal) pr.push([str(P.banco) || 'Banco', bankVal || blank('', 18)]);
    else pr.push(['Banco / cuenta', 'Tipo: ' + blank('', 10) + '   No. ' + blank('', 18)]);
    if (str(P.nequi)) pr.push(['Nequi', str(P.nequi)]);
    if (str(P.daviplata)) pr.push(['Daviplata', str(P.daviplata)]);
    if (str(P.breb)) pr.push(['Bre-B (llave)', str(P.breb)]);
    if (str(P.otroPago)) pr.push(['Otro medio', str(P.otroPago)]);
    var rh = 6.4 * f + 0.35;
    pr.forEach(function (r) { k.rect(M, y, 32, rh, SOFT); k.rect(M + 32, y, CW - 32, rh, WHITE); k.text(r[0], M + 2, y + rh / 2 + 1.3 * f, { size: 9.4, bold: true, color: NAVY }); k.fit(r[1], M + 34, y + rh / 2 + 1.3 * f, CW - 36, { size: 10 }); y += rh; });
    y += 5 * f;

    k.text('DECLARACIONES (bajo la gravedad del juramento)', M, y, { size: 10.5, bold: true, color: NAVY }); y += 5 * f;
    var DS = 8.8;
    function para(n, t) {
      var ls = k.wrap(t, CW - 6, DS);
      k.text(n, M, y, { size: DS, bold: true }); k.font(DS); k.color(BLACK); doc.text(ls, M + 6, y); y += ls.length * k.lh(DS) + 1.4 * f;
    }
    para('1.', 'No responsable de IVA y no obligado a facturar. Soy persona natural no responsable de IVA por cumplir todas las condiciones del parágrafo 3 del art. 437 del Estatuto Tributario; por ello no estoy obligado a expedir factura electrónica (art. 616-2 E.T.; num. 3 del art. 1.6.1.4.3 del Decreto 1625 de 2016). Adjunto copia de mi RUT. El pagador soporta esta compra con el documento soporte de adquisiciones a no obligados a facturar (art. 1.6.1.4.12 del Decreto 1625 de 2016).');
    para('2.', 'Retención en la fuente (artículos 383 y 392 E.T.; numeral 6 del artículo 1.2.4.1.6 del Decreto 1625 de 2016). Marco una opción:');
    [{ on: c.retencion === 'tabla383', label: 'NO tomaré costos ni deducciones asociados a estos ingresos: aplíquese la tabla del art. 383 E.T.' },
     { on: c.retencion === 'costos', label: 'SÍ tomaré costos y deducciones: aplíquese la tarifa de retención que corresponda (art. 392 E.T.).' }].forEach(function (r) {
      var ls = k.wrap(r.label, CW - 14, DS, r.on);
      k.box(M + 7, y + 0.3, r.on); k.font(DS, r.on); k.color(BLACK); doc.text(ls, M + 12, y); y += ls.length * k.lh(DS) + 1.4 * f;
    });
    var pila = c.pila || {};
    para('3.', 'Seguridad social. Cotizo como trabajador independiente (PILA) sobre un ingreso base de cotización (IBC) del 40 % de los ingresos mensualizados, sin incluir IVA, según la normativa vigente. Planilla No. ' + blank(pila.numero, 14) + '  periodo ' + blank(pila.periodo, 10) + '.');
    y += 3 * f;

    var sw = (CW - 8) / 2, sh = 30 * f;
    var fr = c.firmaRecibe || {};
    signature(doc, k, M, y, sw, sh, c.firmaEmisor, 'Firma del emisor', [str(P.nombre).toUpperCase(), 'C.C. ' + blank(P.cedula, 16)]);
    signature(doc, k, M + sw + 8, y, sw, sh, fr, 'Recibido por el cliente (opcional)', ['Nombre: ' + blank(fr.nombre, 22), 'C.C. / cargo: ' + blank(fr.cedula, 12) + '   Fecha: ' + (fr.firma ? fmtDate(c.createdAt) : blank('', 9))]);
    y += sh;
    return y;
  }

  function buildCuenta(c, P, opts) {
    opts = opts || {};
    var doc, y, f, i;
    for (i = 0; i < SCALES.length; i++) {
      f = SCALES[i];
      doc = newDoc('Cuenta de cobro ' + c.id, P.nombre);
      y = renderCuenta(doc, kit(doc, f), c, P, { concepto: i < 8 ? 8 : 5 });
      if (y <= PH - 12) break;
    }
    var k = kit(doc, 1);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(16, PH - 9.5, PW - 16, PH - 9.5);
    k.text(str(P.nombre) + ' · persona natural · Tel. ' + (str(P.telefono) || '') , 16, PH - 5.8, { size: 7.5, color: GRAY });
    k.text('Cuenta de cobro ' + c.id, PW - 16, PH - 5.8, { size: 7.5, color: GRAY, align: 'right' });
    if (opts.watermark) k.watermark(opts.watermark);
    doc.__scale = f;
    return doc;
  }

  g.HCDOCS = {
    buildOrden: buildOrden, buildCuenta: buildCuenta, totalsOS: totalsOS, totalCC: totalCC,
    TIPOS_OS: TIPOS_OS, PAGOS_OS: PAGOS_OS, MARCAS_OS: MARCAS_OS, CARD_NOTE: CARD_NOTE,
    money: money, fmtLocal: fmtLocal, osNumber: osNumber
  };
})(typeof self !== 'undefined' ? self : this);
