// Wires the FLICK OFF for writers page: pick or drop a file, read it with FlickWriter, show the plan.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n).toLocaleString('en-GB'); };
  var usdRate = null;
  fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate').then(function (r) { return r.json(); }).then(function (j) { usdRate = Number(j.rate) || null; if (last) show(last); }).catch(function () {});
  var price = function (sats) {
    if (!usdRate) return fmt(sats) + ' sats';
    var d = (sats / 1e8) * usdRate;
    if (d < 0.01) return fmt(sats) + ' sats';
    return '$' + d.toFixed(d < 10 ? 2 : 0);
  };
  var last = null;
  var msg = function (t, bad) { var m = $('msg'); m.textContent = t || ''; m.className = 'msg' + (bad ? ' bad' : ''); };

  function show(r) {
    last = r;
    var p = r.plan;
    $('res').className = 'res show';
    $('rk').textContent = 'Found your ' + r.kind + ' writing';
    $('rsub').textContent = fmt(r.posts) + ' items in the file. Only published posts are in the plan.';
    $('sCount').textContent = fmt(p.count);
    $('sWords').textContent = fmt(p.words);
    $('sRange').textContent = p.first ? (p.first === p.last ? p.first : p.first.slice(0, 4) + ' to ' + p.last.slice(0, 4)) : '-';
    $('sCost').textContent = price(p.sats);
    var l = p.left, bits = [];
    if (l.draft) bits.push(fmt(l.draft) + ' draft' + (l.draft === 1 ? '' : 's'));
    if (l.private) bits.push(fmt(l.private) + ' private');
    if (l.paid) bits.push(fmt(l.paid) + ' paid-only');
    $('sLeft').textContent = bits.length ? 'Left out: ' + bits.join(', ') + '. These are not minted.' : '';
    var ul = $('plist');
    ul.textContent = '';
    p.list.slice(0, 25).forEach(function (x) {
      var li = document.createElement('li');
      var t = document.createElement('span'); t.className = 't'; t.textContent = x.title;
      var d = document.createElement('span'); d.className = 'd'; d.textContent = x.date || 'no date';
      var c = document.createElement('span'); c.className = 'c'; c.textContent = fmt(x.words) + ' words, ' + price(W().cost(x.bytes));
      li.appendChild(t); li.appendChild(d); li.appendChild(c); ul.appendChild(li);
    });
    if (p.list.length > 25) {
      var more = document.createElement('li');
      more.textContent = 'and ' + fmt(p.list.length - 25) + ' more';
      ul.appendChild(more);
    }
  }
  var W = function () { return window.FlickWriter; };

  async function fromZip(file) {
    if (file.size > 500e6) throw new Error('That zip is over 500 MB. Choose a smaller export.');
    var zip = await JSZip.loadAsync(file);
    return Object.values(zip.files).filter(function (f) { return !f.dir; }).map(function (f) {
      return { path: f.name, size: (f._data && f._data.uncompressedSize) || 0, text: function () { return f.async('string'); } };
    });
  }

  async function load(file) {
    msg('Reading ' + file.name + '...');
    $('res').className = 'res';
    try {
      var files = /\.zip$/i.test(file.name) ? await fromZip(file) : [{ path: file.name, size: file.size, text: function () { return file.text(); } }];
      var out = await W().parse(files);
      if (!out.kind || !out.posts.length) { msg('That does not look like a Medium, Substack or WordPress export. Check you chose the file you downloaded.', true); return; }
      msg('');
      show({ kind: out.kind, posts: out.posts.length, plan: W().plan(out.posts) });
    } catch (e) {
      msg(e && e.message ? e.message : 'Could not read that file.', true);
    }
  }

  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
  $('fin').addEventListener('change', function (e) { if (e.target.files[0]) load(e.target.files[0]); });
})();
