/* Hot and Cold · Actas — generación del PDF (jsPDF, A4 horizontal).
 * Replica el formato en papel: encabezado navy/teal, secciones 1–5, firmas y anexo fotográfico. */
(function (g) {
  'use strict';
  var NAVY = [27, 54, 93], TEAL = [12, 107, 107], GRAY = [85, 85, 85], MUTED = [125, 125, 125];
  var ROW = [244, 247, 251], LINE = [184, 193, 206], WHITE = [255, 255, 255], BLACK = [28, 28, 28];
  var PW = 297, PH = 210, M = 11.5, CW = PW - 2 * M, BOTTOM = PH - 11.5;

  var SERVICIOS = {
    retiro: ['Diagnóstico', 'Reparación', 'Mantenimiento preventivo', 'Garantía', 'Devolución / no autorizado', 'Otro'],
    entrega: ['Reparación', 'Mantenimiento preventivo', 'Diagnóstico', 'Garantía', 'Instalación / puesta en marcha', 'Otro']
  };
  var GARANTIAS = { '90': '90 días (reparación)', '15': '15 días (preventivo, solo ajustes)', 'na': 'No aplica' };

  function fmtDate(iso) {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  }
  function fmtTime(iso) {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  }
  function titleOf(kind) { return kind === 'retiro' ? 'ACTA DE RECEPCIÓN DE EQUIPOS' : 'ACTA DE ENTREGA DE EQUIPOS'; }
  function na(v) { v = String(v == null ? '' : v).trim(); return v ? v : 'N/A'; }

  function P(doc) {
    var api = {
      fill: function (c) { doc.setFillColor(c[0], c[1], c[2]); },
      draw: function (c) { doc.setDrawColor(c[0], c[1], c[2]); },
      color: function (c) { doc.setTextColor(c[0], c[1], c[2]); },
      font: function (size, bold, italic) {
        doc.setFont('helvetica', bold ? (italic ? 'bolditalic' : 'bold') : (italic ? 'italic' : 'normal'));
        doc.setFontSize(size);
      },
      lh: function (size) { return size * 0.3528 * 1.17; },
      wrap: function (text, w, size, bold) { api.font(size, bold); return doc.splitTextToSize(String(text == null ? '' : text), w); },
      text: function (t, x, y, o) {
        o = o || {};
        api.font(o.size || 9, o.bold, o.italic);
        api.color(o.color || BLACK);
        doc.text(t, x, y, { align: o.align || 'left', baseline: 'alphabetic' });
      },
      rect: function (x, y, w, h, fill, stroke, lw) {
        doc.setLineWidth(lw || 0.2);
        if (fill) api.fill(fill);
        api.draw(stroke || LINE);
        doc.rect(x, y, w, h, fill ? (stroke === false ? 'F' : 'FD') : 'S');
      },
      /* Casilla tipo papel; marcada = relleno teal con chulo blanco */
      box: function (x, y, checked, s) {
        s = s || 2.6;
        doc.setLineWidth(0.25);
        api.draw(checked ? TEAL : [110, 110, 110]);
        if (checked) { api.fill(TEAL); doc.rect(x, y - s + 0.35, s, s, 'FD'); }
        else doc.rect(x, y - s + 0.35, s, s, 'S');
        if (checked) {
          doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.45);
          var bx = x, by = y - s + 0.35;
          doc.line(bx + s * 0.2, by + s * 0.55, bx + s * 0.42, by + s * 0.78);
          doc.line(bx + s * 0.42, by + s * 0.78, bx + s * 0.82, by + s * 0.24);
        }
        return s;
      },
      /* Lista de opciones con casilla; hace salto de línea si no cabe. Devuelve alto usado. */
      opts: function (x, y, w, options, size, draw) {
        size = size || 8;
        var lh = api.lh(size) + 1.1, cx = x, cy = y, gap = 1.8, s = 2.5;
        api.font(size, false);
        options.forEach(function (o) {
          var label = o.label + (o.extra ? (': ' + o.extra) : '');
          api.font(size, !!o.checked);
          var tw = doc.getTextWidth(label);
          api.font(size, false);
          var iw = s + 0.9 + tw;
          if (cx > x && cx + iw > x + w) { cx = x; cy += lh; }
          if (draw) {
            api.box(cx, cy, !!o.checked, s);
            api.font(size, !!o.checked);
            api.color(o.checked ? BLACK : GRAY);
            doc.text(label, cx + s + 0.9, cy);
            api.font(size, false);
          }
          cx += iw + gap;
        });
        return (cy - y) + lh;
      }
    };
    return api;
  }

  function build(a, S, logo, annexLabel) {
    var jsPDF = g.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    var p = P(doc);
    var E = S.empresa;
    var kind = a.kind;
    var title = titleOf(kind);
    doc.setProperties({ title: title + ' ' + a.id, author: E.nombre, subject: 'Acta de movimiento de equipos · ' + (a.cliente || ''), creator: 'App Actas Hot and Cold' });

    var st = { y: 0 };

    function header() {
      // Logo completo (llama + H&C + HOT AND COLD), sin recortes
      if (logo) doc.addImage(logo, 'JPEG', M - 1, 6.5, 25, 25);
      p.text(E.nombre, M + 27, 14.5, { size: 16, bold: true, color: NAVY });
      p.text('Marca comercial:  ' + E.marca, M + 27, 19.8, { size: 10, color: TEAL });
      p.text('NIT ' + E.nit + '   ·   ' + E.direccion + ', ' + E.ciudad, M + 27, 24.2, { size: 9, color: GRAY });
      p.text('Tel. ' + E.tel1 + '  /  ' + E.tel2 + '   ·   ' + E.email, M + 27, 28.2, { size: 9, color: GRAY });
      var bx = PW - M - 96, bw = 96;
      p.rect(bx, 7, bw, 24, NAVY, false);
      p.text(title, bx + 4, 14.2, { size: 12, bold: true, color: WHITE });
      p.text('Consecutivo No.', bx + 4, 21, { size: 9, color: [205, 214, 228] });
      p.text(a.id, bx + 30, 21.2, { size: 12.5, bold: true, color: WHITE });
      p.text('Fecha  ' + fmtDate(a.createdAt) + '      Hora  ' + fmtTime(a.createdAt) + '  (Bogotá)', bx + 4, 27.4, { size: 9, color: WHITE });
      p.fill(TEAL); doc.rect(M, 33.4, CW, 0.9, 'F');
      st.y = 36;
    }

    function contHeader(sub) {
      if (logo) doc.addImage(logo, 'JPEG', M - 0.5, 5.5, 13, 13);
      p.text(title + '  ·  ' + a.id, M + 15, 11.5, { size: 12, bold: true, color: NAVY });
      p.text(sub || 'Continuación', M + 15, 16.2, { size: 9, color: TEAL });
      p.text(E.nombre + '  ·  NIT ' + E.nit, PW - M, 11.5, { size: 8.5, color: GRAY, align: 'right' });
      p.fill(TEAL); doc.rect(M, 19.6, CW, 0.8, 'F');
      st.y = 23.5;
    }

    function ensure(h, onBreak) {
      if (st.y + h > BOTTOM) {
        doc.addPage();
        contHeader();
        if (onBreak) onBreak();
        return true;
      }
      return false;
    }

    function sectionBar(t, minAfter) {
      ensure(5.4 + (minAfter || 10));
      p.rect(M, st.y, CW, 5, NAVY, false);
      p.text(t, M + 2, st.y + 3.5, { size: 9, bold: true, color: WHITE });
      st.y += 5;
    }

    /* ---------- 1. Datos del cliente ---------- */
    function seccion1() {
      sectionBar('1.  DATOS DEL CLIENTE Y DEL SITIO', 26);
      var LW = 26, VW = 42.5;
      var dirLabel = kind === 'retiro' ? 'Dirección de recepción' : 'Dirección de entrega';
      var rows = [
        [['Cliente', a.cliente, VW, true], ['NIT', a.nit, VW], ['OC / REQ / Pedido No.', a.oc, VW], ['Albarán / remisión No.', a.albaran, VW]],
        [[dirLabel, a.direccion, VW * 2 + LW], ['Sede / tienda / área', a.sede, VW], ['Ciudad', a.ciudad, VW]],
        [['Contacto en sitio', a.contacto, VW], ['Teléfono', a.telefono, VW], ['Cargo del contacto', a.cargoContacto, VW], ['Correo del cliente', a.correoCliente, VW]]
      ];
      rows.forEach(function (r) {
        var h = 6;
        var prepared = r.map(function (c) {
          var ll = p.wrap(c[0], LW - 2.4, 8, true);
          var vl = p.wrap(c[1] || '', c[2] - 2.6, c[3] ? 10 : 9, !!c[3]);
          h = Math.max(h, ll.length * p.lh(8) + 2.4, vl.length * p.lh(c[3] ? 10 : 9) + 2.4);
          return { ll: ll, vl: vl, c: c };
        });
        ensure(h);
        var x = M;
        prepared.forEach(function (o) {
          p.rect(x, st.y, LW, h, NAVY, LINE);
          p.font(8, true); p.color(WHITE);
          doc.text(o.ll, x + 1.2, st.y + 1.2 + p.lh(8) * 0.8);
          x += LW;
          p.rect(x, st.y, o.c[2], h, WHITE, LINE);
          var sz = o.c[3] ? 10 : 9;
          p.font(sz, !!o.c[3]); p.color(BLACK);
          doc.text(o.vl, x + 1.3, st.y + 1.2 + p.lh(sz) * 0.8);
          x += o.c[2];
        });
        st.y += h;
      });
      // Tipo de servicio
      var ops = SERVICIOS[kind].map(function (s) {
        var checked = (a.tipoServicio || []).indexOf(s) >= 0;
        return { label: s, checked: checked, extra: (s === 'Otro' && checked && a.tipoOtro) ? a.tipoOtro : '' };
      });
      var oh = p.opts(0, 0, CW - 26 - 3, ops, 9, false) + 1.6;
      var h = Math.max(6.2, oh);
      ensure(h);
      p.rect(M, st.y, 26, h, NAVY, LINE);
      p.text('Tipo de servicio', M + 1.2, st.y + 4, { size: 8, bold: true, color: WHITE });
      p.rect(M + 26, st.y, CW - 26, h, WHITE, LINE);
      p.opts(M + 28, st.y + 4.1, CW - 26 - 3, ops, 9, true);
      st.y += h + 2.2;
    }

    /* ---------- tablas genéricas ---------- */
    function tableHeader(cols) {
      var h = 8.6;
      var x = M;
      cols.forEach(function (c) {
        p.rect(x, st.y, c.w, h, TEAL, [255, 255, 255]);
        var lines = p.wrap(c.h, c.w - 1.6, 8, true);
        var ty = st.y + h / 2 - (lines.length - 1) * p.lh(8) / 2 + 0.9;
        p.color(WHITE);
        doc.text(lines, x + c.w / 2, ty, { align: 'center' });
        x += c.w;
      });
      st.y += h;
    }

    function tableRows(cols, items, rowFn) {
      items.forEach(function (it, i) {
        var cells = rowFn(it, i);
        var h = 6.4;
        cells.forEach(function (c, k) { h = Math.max(h, c.measure(cols[k].w) + 2.2); });
        ensure(h, function () { tableHeader(cols); });
        var x = M;
        var bg = i % 2 ? ROW : WHITE;
        cells.forEach(function (c, k) {
          p.rect(x, st.y, cols[k].w, h, bg, LINE);
          c.draw(x, st.y, cols[k].w, h);
          x += cols[k].w;
        });
        st.y += h;
      });
    }

    function tcell(text, o) {
      o = o || {};
      var size = o.size || 8.8;
      return {
        measure: function (w) { return p.wrap(text || '', w - 2.2, size, o.bold).length * p.lh(size); },
        draw: function (x, y, w, h) {
          var lines = p.wrap(text || '', w - 2.2, size, o.bold);
          p.color(o.color || BLACK);
          if (o.center) doc.text(lines, x + w / 2, y + h / 2 - (lines.length - 1) * p.lh(size) / 2 + size * 0.13, { align: 'center' });
          else doc.text(lines, x + 1.1, y + 1.1 + p.lh(size) * 0.82);
        }
      };
    }

    function ocell(options, after) {
      var size = 7.8;
      return {
        measure: function (w) {
          var hh = p.opts(0, 0, w - 2.4, options, size, false);
          if (after) hh += p.wrap(after, w - 2.4, 8).length * p.lh(8);
          return hh;
        },
        draw: function (x, y, w, h) {
          var hh = p.opts(x + 1.2, y + 1.1 + 2.3, w - 2.4, options, size, true);
          if (after) {
            var lines = p.wrap(after, w - 2.4, 8);
            p.font(8, false); p.color(BLACK);
            doc.text(lines, x + 1.2, y + 1.1 + hh + 1.8);
          }
        }
      };
    }

    /* celda con pares etiqueta/valor (sangría francesa) */
    function kvcell(pairs) {
      var size = 8, labW = 16;
      var list = pairs.filter(function (pr) { return pr[1]; });
      function lines(w) { return list.map(function (pr) { return p.wrap(pr[1], w - labW - 2.2, size); }); }
      return {
        measure: function (w) { return lines(w).reduce(function (s, l) { return s + l.length * p.lh(size); }, 0); },
        draw: function (x, y, w) {
          var ls = lines(w), cy = y + 1.1 + p.lh(size) * 0.82;
          list.forEach(function (pr, i) {
            p.text(pr[0], x + 1.1, cy, { size: size, bold: true, color: TEAL });
            p.font(size, false); p.color(BLACK);
            doc.text(ls[i], x + 1.1 + labW, cy);
            cy += ls[i].length * p.lh(size);
          });
        }
      };
    }

    function yn(v, a1, a2) { return [{ label: a1 || 'Sí', checked: v === 'si' }, { label: a2 || 'No', checked: v === 'no' }]; }

    /* ---------- 2. Identificación ---------- */
    function seccion2() {
      sectionBar('2.  IDENTIFICACIÓN DE LOS EQUIPOS', 16);
      var cols = [
        { h: 'Ítem', w: 8.5 }, { h: 'Tipo de equipo', w: 37 }, { h: 'Marca', w: 24.5 }, { h: 'Modelo', w: 27 },
        { h: 'Serie', w: 30.5 }, { h: 'Cód. interno / activo fijo del cliente', w: 33.5 },
        { h: 'Características (voltaje, capacidad, color, accesorios)', w: 98 }, { h: 'Cant.', w: 15 }
      ];
      tableHeader(cols);
      tableRows(cols, a.items, function (it, i) {
        return [tcell(String(i + 1), { center: true, bold: true }), tcell(na(it.tipo), { bold: true }), tcell(na(it.marca)), tcell(na(it.modelo)),
          tcell(na(it.serie)), tcell(na(it.activo), { bold: true }), tcell(na(it.caracteristicas)), tcell(String(it.cantidad || 1), { center: true })];
      });
      st.y += 2.2;
    }

    /* ---------- 3. Estado ---------- */
    function seccion3() {
      var ent = kind === 'entrega';
      sectionBar(ent ? '3.  ESTADO DE CADA EQUIPO, TRABAJO REALIZADO Y PRUEBAS (al momento de la entrega)' : '3.  ESTADO DE CADA EQUIPO (al momento de la recepción)', 16);
      var cols = ent
        ? [{ h: 'Ítem', w: 8.5 }, { h: 'Estado físico', w: 36 }, { h: 'Enciende', w: 18 }, { h: 'Golpes o rayones', w: 18 },
          { h: 'Partes faltantes', w: 30 }, { h: 'Accesorios entregados', w: 52 }, { h: 'Pruebas', w: 22 },
          { h: 'Trabajo realizado / repuestos / garantía / observaciones', w: 89.5 }]
        : [{ h: 'Ítem', w: 8.5 }, { h: 'Estado físico', w: 38 }, { h: 'Enciende', w: 22 }, { h: 'Golpes o rayones', w: 22 },
          { h: 'Partes faltantes', w: 34 }, { h: 'Accesorios que acompañan el equipo', w: 76 }, { h: 'Observaciones', w: 73.5 }];
      tableHeader(cols);
      tableRows(cols, a.items, function (it, i) {
        var acc = it.accesorios || {};
        var accOpts = [
          { label: 'Cable', checked: !!acc.cable }, { label: 'Bandejas', checked: !!acc.bandejas },
          { label: 'Puertas', checked: !!acc.puertas }, { label: 'Manuales', checked: !!acc.manuales },
          { label: 'Otro', checked: !!acc.otro, extra: acc.otro ? (acc.otroTexto || '') : '' }
        ];
        var cells = [
          tcell(String(i + 1), { center: true, bold: true }),
          ocell([{ label: 'Bueno', checked: it.estado === 'bueno' }, { label: 'Regular', checked: it.estado === 'regular' }, { label: 'Malo', checked: it.estado === 'malo' }]),
          ocell(yn(it.enciende)),
          ocell(yn(it.golpes)),
          ocell([{ label: 'No', checked: it.faltantes === 'no' }, { label: 'Sí', checked: it.faltantes === 'si' }], it.faltantes === 'si' ? (it.faltantesDetalle || '') : ''),
          ocell(accOpts)
        ];
        if (ent) {
          cells.push(ocell([{ label: 'OK', checked: it.pruebas === 'ok' }, { label: 'No OK', checked: it.pruebas === 'nook' }]));
          cells.push(kvcell([['Trabajo:', it.trabajo], ['Repuestos:', it.repuestos], ['Garantía:', GARANTIAS[it.garantia] || ''], ['Obs.:', it.observaciones]]));
        } else {
          cells.push(tcell(na(it.observaciones), { size: 8.4 }));
        }
        return cells;
      });
      st.y += 2.2;
    }

    /* ---------- 4 y 5 ---------- */
    function seccion45(annexPage) {
      var ent = kind === 'entrega';
      var nf = (a.fotos || []).length;
      var lw = 78, rw = CW - lw - 3, rx = M + lw + 3;
      var legalT = ent ? '5.  CONSTANCIA DE RECIBO Y GARANTÍA' : '5.  CONSTANCIA DE CUSTODIA';
      var legal = ent
        ? 'El cliente recibe el(los) equipo(s) a satisfacción, en el estado y con los accesorios aquí descritos. La garantía aplica según las condiciones del servicio: 90 días calendario en reparaciones (mano de obra) y 15 días calendario en ajustes derivados de mantenimiento preventivo. No cubre mal uso, golpes posteriores ni repuestos no instalados por Hot and Cold. Queda sujeta a la facturación y a la cotización u orden correspondiente.'
        : 'El(los) equipo(s) relacionado(s) en esta acta queda(n) bajo custodia de ' + E.nombre + ' para diagnóstico y/o reparación. Este documento constituye constancia de la recepción y del estado en que se recibe el equipo. Cualquier hallazgo adicional se reportará por escrito al cliente.';
      var ll = p.wrap(legal, rw - 4, 8);
      var gOps = null;
      if (ent) {
        var used = {};
        a.items.forEach(function (it) { if (it.garantia) used[it.garantia] = true; });
        gOps = [{ label: '90 días (reparación)', checked: !!used['90'] }, { label: '15 días (preventivo, solo ajustes)', checked: !!used['15'] }, { label: 'No aplica', checked: !!used.na }];
      }
      var rh = 5.6 + ll.length * p.lh(8) + (ent ? 5 : 0) + 2;
      var h = Math.max(rh, 19);
      ensure(h + 2.2 + 56);   // la constancia se mantiene en la misma página que las firmas
      var y = st.y;
      p.rect(M, y, lw, h, [247, 249, 252], NAVY, 0.35);
      p.text('4.  REGISTRO FOTOGRÁFICO', M + 2, y + 4.4, { size: 8.5, bold: true, color: NAVY });
      p.opts(M + 2, y + 9.4, lw - 4, [{ label: 'Sí', checked: nf > 0 }, { label: 'No', checked: nf === 0 }], 8.5, true);
      p.text('No. de fotos:  ' + nf, M + 26, y + 9.4, { size: 8.5, bold: true });
      p.text(nf ? ('Anexo fotográfico: ' + annexPage) : 'Sin fotos adjuntas', M + 2, y + 15, { size: 8, color: GRAY });
      p.rect(rx, y, rw, h, [247, 249, 252], NAVY, 0.35);
      p.text(legalT, rx + 2, y + 4.4, { size: 8.5, bold: true, color: NAVY });
      p.font(8, false); p.color(BLACK);
      doc.text(ll, rx + 2, y + 8.2);
      if (ent) {
        var gy = y + 8.2 + ll.length * p.lh(8) + 1.6;
        p.text('Garantía informada:', rx + 2, gy, { size: 8, bold: true, color: TEAL });
        p.opts(rx + 36, gy, rw - 38, gOps, 8, true);
      }
      st.y += h + 2.2;
    }

    /* ---------- Firmas ---------- */
    function firmas() {
      var ent = kind === 'entrega';
      var tec = a.firmaTecnico || {}, cli = a.firmaCliente || {};
      var left, right;
      if (ent) {
        left = { t: 'QUIEN ENTREGA  ·  Técnico ' + E.marca, s: 'Entrega el equipo reparado o intervenido', d: tec };
        right = { t: 'QUIEN RECIBE  ·  Cliente', s: 'Recibe el equipo a satisfacción', d: cli };
      } else {
        left = { t: 'QUIEN ENTREGA  ·  Cliente', s: 'Persona autorizada en el sitio de recepción', d: cli };
        right = { t: 'QUIEN RECIBE  ·  Técnico ' + E.marca, s: 'Recibe el equipo en custodia', d: tec };
      }
      var h = 56;
      ensure(h);
      var w = (CW - 4) / 2;
      [left, right].forEach(function (b, i) {
        var x = M + i * (w + 4), y = st.y;
        p.rect(x, y, w, h, WHITE, NAVY, 0.35);
        p.rect(x, y, w, 9, NAVY, false);
        p.text(b.t, x + 2.2, y + 4, { size: 9, bold: true, color: WHITE });
        p.text(b.s, x + 2.2, y + 7.6, { size: 7.4, color: [205, 214, 228] });
        p.text('Firma:', x + 2.2, y + 13.2, { size: 8.5, color: GRAY });
        var sx = x + 16, sy = y + 11, sw = w - 20, sh = 22;
        p.draw(LINE); doc.setLineWidth(0.25); doc.line(sx, sy + sh, sx + sw, sy + sh);
        if (b.d.firma) {
          var ar = (b.d.firmaW && b.d.firmaH) ? b.d.firmaW / b.d.firmaH : 3;
          var iw = sw, ih = iw / ar;
          if (ih > sh) { ih = sh; iw = ih * ar; }
          doc.addImage(b.d.firma, 'PNG', sx + (sw - iw) / 2, sy + (sh - ih), iw, ih);
        }
        var ny = y + 36.6;
        p.text('Nombre de quien firma:', x + 2.2, ny, { size: 8.4, color: GRAY });
        p.text(na(b.d.nombre), x + 42, ny, { size: 9.2, bold: true });
        p.text('Cédula:', x + 2.2, ny + 5.4, { size: 8.4, color: GRAY });
        p.text(na(b.d.cedula), x + 16, ny + 5.4, { size: 9 });
        p.text('Cargo:', x + w / 2, ny + 5.4, { size: 8.4, color: GRAY });
        p.text(na(b.d.cargo), x + w / 2 + 13, ny + 5.4, { size: 9 });
        p.text('Firmado en el celular el ' + fmtDate(b.d.firmadoEn || a.createdAt) + ' a las ' + fmtTime(b.d.firmadoEn || a.createdAt) + ' (hora de Bogotá, UTC-5)', x + 2.2, y + h - 2.4, { size: 7.2, italic: true, color: MUTED });
      });
      st.y += h;
    }

    /* ---------- Anexo fotográfico ---------- */
    function anexo() {
      var fotos = a.fotos || [];
      if (!fotos.length) return;
      var perPage = 6, cols = 3, gap = 4;
      var cw = (CW - gap * (cols - 1)) / cols;
      for (var i = 0; i < fotos.length; i++) {
        if (i % perPage === 0) {
          doc.addPage();
          contHeader('ANEXO FOTOGRÁFICO  ·  ' + fotos.length + ' foto' + (fotos.length === 1 ? '' : 's') + '  ·  ' + (a.cliente || ''));
        }
        var k = i % perPage, r = Math.floor(k / cols), c = k % cols;
        var ch = (BOTTOM - st.y - gap) / 2;
        var x = M + c * (cw + gap), y = st.y + r * (ch + gap);
        p.rect(x, y, cw, ch, [250, 251, 253], LINE);
        var f = fotos[i];
        var aw = cw - 4, ah = ch - 10;
        var ar = (f.w && f.h) ? f.w / f.h : 4 / 3;
        var iw = aw, ih = aw / ar;
        if (ih > ah) { ih = ah; iw = ah * ar; }
        try { doc.addImage(f.data, 'JPEG', x + (cw - iw) / 2, y + 2 + (ah - ih) / 2, iw, ih); } catch (e) {}
        var cap = 'Foto ' + (i + 1) + (f.caption ? ('  ·  ' + f.caption) : '');
        var cl = p.wrap(cap, cw - 4, 8.2, true);
        p.font(8.2, true); p.color(NAVY);
        doc.text(cl.slice(0, 2), x + 2, y + ch - 5.4);
      }
    }

    function footers() {
      var n = doc.getNumberOfPages();
      var label = (kind === 'retiro' ? 'Acta de recepción ' : 'Acta de entrega ') + a.id;
      for (var i = 1; i <= n; i++) {
        doc.setPage(i);
        p.draw(LINE); doc.setLineWidth(0.2); doc.line(M, PH - 9.6, PW - M, PH - 9.6);
        p.text(E.nombre + '  ·  NIT ' + E.nit + '  ·  ' + E.direccion + ', ' + E.ciudad.replace(' D.C.', '') + '  ·  Original: cliente  ·  Copia: ' + E.marca, M, PH - 6, { size: 7.6, color: GRAY });
        p.text(label + '  ·  pág. ' + i + ' de ' + n, PW - M, PH - 6, { size: 7.6, color: GRAY, align: 'right' });
      }
    }

    header();
    seccion1();
    seccion2();
    seccion3();
    seccion45(annexLabel || 'al final del documento');
    firmas();
    var mainPages = doc.getNumberOfPages();
    var nf = (a.fotos || []).length;
    var label = '';
    if (nf) {
      var first = mainPages + 1, last = mainPages + Math.ceil(nf / 6);
      label = first === last ? ('pág. ' + first) : ('págs. ' + first + ' a ' + last);
    }
    anexo();
    footers();
    return { doc: doc, annexLabel: label };
  }

  /* Dos pasadas cuando hay fotos, para citar la página exacta del anexo en la sección 4. */
  function buildPdf(a, S, logo) {
    var r = build(a, S, logo, '');
    if (r.annexLabel) r = build(a, S, logo, r.annexLabel);
    return r.doc.output('blob');
  }

  g.HCPDF = { buildPdf: buildPdf, fmtDate: fmtDate, fmtTime: fmtTime, titleOf: titleOf, SERVICIOS: SERVICIOS, GARANTIAS: GARANTIAS };
})(typeof self !== 'undefined' ? self : this);
