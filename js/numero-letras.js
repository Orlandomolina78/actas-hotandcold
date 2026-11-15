/* Número a letras en español (Colombia) para valores en pesos.
 * numeroALetras(1250000) -> "UN MILLÓN DOSCIENTOS CINCUENTA MIL PESOS M/CTE"
 * Reglas: "un"/"veintiún" delante de "mil", "millones" y "pesos"; "cien" exacto; "de pesos" tras millón(es) exactos. */
(function (g) {
  'use strict';
  var U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
    'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  var D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  var C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  /* 0..999; apocope=true convierte la unidad final "UNO" en "UN" / "VEINTIUNO" en "VEINTIÚN" */
  function cientos(n, apocope) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    var c = Math.floor(n / 100), r = n % 100, out = [];
    if (c) out.push(C[c]);
    if (r) {
      var w;
      if (r < 30) w = U[r];
      else { var d = Math.floor(r / 10), u = r % 10; w = D[d] + (u ? ' Y ' + U[u] : ''); }
      if (apocope) w = w.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
      out.push(w);
    }
    return out.join(' ');
  }

  /* 0..999.999 */
  function miles(n, apocope) {
    var m = Math.floor(n / 1000), r = n % 1000, out = [];
    if (m === 1) out.push('MIL');
    else if (m > 1) out.push(cientos(m, true) + ' MIL');
    if (r) out.push(cientos(r, apocope));
    return out.join(' ');
  }

  function enteroALetras(n) {
    if (n === 0) return 'CERO';
    var out = [];
    var billones = Math.floor(n / 1e12); n = n % 1e12;
    var millones = Math.floor(n / 1e6); var resto = n % 1e6;
    if (billones) out.push(billones === 1 ? 'UN BILLÓN' : miles(billones, true) + ' BILLONES');
    if (millones) out.push(millones === 1 ? 'UN MILLÓN' : miles(millones, true) + ' MILLONES');
    if (resto) out.push(miles(resto, true));
    return out.join(' ');
  }

  function numeroALetras(valor, opts) {
    opts = opts || {};
    var n = Math.round(Math.abs(Number(valor) || 0));
    var txt = enteroALetras(n);
    var deMillon = n >= 1e6 && n % 1e6 === 0;          // "UN MILLÓN DE PESOS"
    var moneda = n === 1 ? 'PESO' : 'PESOS';
    if (n === 1) txt = 'UN';
    return txt + (deMillon ? ' DE ' : ' ') + moneda + (opts.sinMcte ? '' : ' M/CTE');
  }

  g.numeroALetras = numeroALetras;
  if (typeof module !== 'undefined') module.exports = { numeroALetras: numeroALetras };
})(typeof self !== 'undefined' ? self : this);
