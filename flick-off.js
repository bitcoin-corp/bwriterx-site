// FLICK OFF for writers: reads a Medium, Substack or WordPress export in the browser and works out what is in
// it and what minting it would cost. Nothing is uploaded. Pure parsing (no wallet, no network except the price).
(function () {
  'use strict';
  var SAT_PER_KB = 100; // bMintX house rate
  var OVERHEAD = 1024; // ~1 kB per post for title, date and signature
  var W = (window.FlickWriter = {});

  var enc = new TextEncoder();
  var bytes = function (s) { return enc.encode(s || '').length; };
  var words = function (t) { t = (t || '').replace(/\s+/g, ' ').trim(); return t ? t.split(' ').length : 0; };
  var htmlDoc = function (html) { return new DOMParser().parseFromString(html, 'text/html'); };
  var plain = function (node) {
    if (!node) return '';
    var c = node.cloneNode(true);
    c.querySelectorAll('script,style').forEach(function (n) { n.remove(); });
    return c.textContent || '';
  };
  var isoDate = function (s) {
    if (!s) return '';
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };
  var base = function (p) { return p.split('/').pop(); };

  // ---- CSV (Substack posts.csv): quoted fields, doubled quotes, newlines inside quotes
  function csv(text) {
    var rows = [], row = [], f = '', q = false, i = 0;
    for (; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).filter(function (r) { return r.length > 1; }).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h.trim()] = r[k] || ''; });
      return o;
    });
  }

  // ---- Medium: posts/<date>_<title>-<id>.html, drafts as draft_<title>-<id>.html
  W.parseMedium = async function (files) {
    var out = [];
    var posts = files.filter(function (f) { return /(^|\/)posts\/[^/]+\.html?$/i.test(f.path); });
    for (var i = 0; i < posts.length; i++) {
      var f = posts[i], name = base(f.path), doc = htmlDoc(await f.text());
      var title = (doc.querySelector('h1.p-name') || doc.querySelector('title') || {}).textContent || name;
      var t = doc.querySelector('time.dt-published');
      var m = /^(\d{4}-\d{2}-\d{2})_/.exec(name);
      var date = isoDate(t && t.getAttribute('datetime')) || (m ? m[1] : '');
      var body = doc.querySelector('section[data-field="body"]') || doc.body;
      out.push({
        source: 'Medium',
        title: title.trim(),
        date: date,
        words: words(plain(body)),
        bytes: bytes(body ? body.innerHTML : ''),
        status: /^draft_/i.test(name) ? 'draft' : 'published',
      });
    }
    return out;
  };

  // ---- Substack: posts.csv (post_id, post_date, is_published, audience, title...) + posts/<post_id>.<slug>.html
  W.parseSubstack = async function (files) {
    var out = [];
    var csvFile = files.filter(function (f) { return /(^|\/)posts\.csv$/i.test(f.path); })[0];
    var htmls = files.filter(function (f) { return /(^|\/)posts\/[^/]+\.html?$/i.test(f.path); });
    var byId = {};
    htmls.forEach(function (f) { byId[base(f.path).split('.')[0]] = f; });
    var rows = csvFile ? csv(await csvFile.text()) : [];
    var used = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], f = byId[r.post_id];
      if (!f) continue;
      used[r.post_id] = true;
      var doc = htmlDoc(await f.text());
      var status = /^true$/i.test(r.is_published) ? (/paid/i.test(r.audience) ? 'paid' : 'published') : 'draft';
      out.push({
        source: 'Substack',
        title: (r.title || (doc.querySelector('h1') || {}).textContent || base(f.path)).trim(),
        date: isoDate(r.post_date),
        words: words(plain(doc.body)),
        bytes: bytes(doc.body ? doc.body.innerHTML : ''),
        status: status,
      });
    }
    // html files with no row in the csv: keep them, but treat as drafts so nothing private is published
    for (var id in byId) {
      if (used[id]) continue;
      var d2 = htmlDoc(await byId[id].text());
      out.push({
        source: 'Substack',
        title: ((d2.querySelector('h1') || {}).textContent || base(byId[id].path)).trim(),
        date: '',
        words: words(plain(d2.body)),
        bytes: bytes(d2.body ? d2.body.innerHTML : ''),
        status: 'draft',
      });
    }
    return out;
  };

  // ---- WordPress: one WXR .xml file, <item> with wp:post_type, wp:status, content:encoded
  var tag = function (el, name) {
    var n = el.getElementsByTagName(name)[0];
    return n ? n.textContent || '' : '';
  };
  W.parseWordPress = async function (files) {
    var out = [];
    var xmls = files.filter(function (f) { return /\.xml$/i.test(f.path); });
    for (var x = 0; x < xmls.length; x++) {
      var text = await xmls[x].text();
      if (text.indexOf('wp:post_type') < 0) continue;
      var xml = new DOMParser().parseFromString(text, 'text/xml');
      var items = xml.getElementsByTagName('item');
      for (var i = 0; i < items.length; i++) {
        var it = items[i], type = tag(it, 'wp:post_type');
        if (type !== 'post' && type !== 'page') continue;
        var st = tag(it, 'wp:status'), content = tag(it, 'content:encoded');
        out.push({
          source: 'WordPress',
          title: (tag(it, 'title') || '(untitled)').trim(),
          date: isoDate(tag(it, 'wp:post_date_gmt') && tag(it, 'wp:post_date_gmt') + 'Z') || isoDate(tag(it, 'pubDate')),
          words: words(plain(htmlDoc(content).body)),
          bytes: bytes(content),
          status: st === 'publish' ? 'published' : st === 'private' ? 'private' : 'draft',
          kind: type,
        });
      }
    }
    return out;
  };

  // ---- which export is this?
  W.detect = async function (files) {
    var xml = files.filter(function (f) { return /\.xml$/i.test(f.path); });
    for (var i = 0; i < xml.length; i++) {
      var head = (await xml[i].text()).slice(0, 200000);
      if (head.indexOf('wp:post_type') >= 0 || head.indexOf('wp:wxr_version') >= 0) return 'WordPress';
    }
    if (files.some(function (f) { return /(^|\/)posts\.csv$/i.test(f.path); })) return 'Substack';
    if (files.some(function (f) { return /(^|\/)posts\/[^/]+\.html?$/i.test(f.path); })) return 'Medium';
    return '';
  };
  W.parse = async function (files) {
    var kind = await W.detect(files);
    if (!kind) return { kind: '', posts: [] };
    var posts = kind === 'WordPress' ? await W.parseWordPress(files) : kind === 'Substack' ? await W.parseSubstack(files) : await W.parseMedium(files);
    return { kind: kind, posts: posts };
  };

  // ---- the plan: only the writer's published words go in. Drafts, private posts and paid-only posts are left out.
  W.cost = function (b) { return Math.ceil(((b + OVERHEAD) / 1024) * SAT_PER_KB); };
  W.plan = function (posts) {
    var inc = posts.filter(function (p) { return p.status === 'published'; });
    var left = { draft: 0, private: 0, paid: 0 };
    posts.forEach(function (p) { if (p.status !== 'published') left[p.status] = (left[p.status] || 0) + 1; });
    var dates = inc.map(function (p) { return p.date; }).filter(Boolean).sort();
    return {
      count: inc.length,
      words: inc.reduce(function (a, p) { return a + p.words; }, 0),
      bytes: inc.reduce(function (a, p) { return a + p.bytes; }, 0),
      sats: inc.reduce(function (a, p) { return a + W.cost(p.bytes); }, 0),
      first: dates[0] || '',
      last: dates[dates.length - 1] || '',
      left: left,
      list: inc.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }),
    };
  };
})();
