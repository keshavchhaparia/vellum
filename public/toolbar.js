/* Vellum review toolbar — injected client-side, no external requests. */
(function () {
  'use strict';

  var SESSION_ID = window.__VELLUM_SESSION_ID__;
  var BASE = '/session/' + SESSION_ID;
  var queued = []; // { selector, label, note }
  var lastAgentReplySeq = 0;
  var annotateMode = false;
  var picked = null; // currently highlighted element awaiting a note

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'style') Object.assign(node.style, attrs[k]);
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(c);
    });
    return node;
  }

  function cssSelectorFor(node) {
    if (!(node instanceof Element)) return '';
    var parts = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += '#' + cur.id;
        parts.unshift(part);
        break;
      }
      var parent = cur.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === cur.tagName;
        });
        if (sameTag.length > 1) {
          part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function shortLabel(node) {
    var text = (node.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length > 60) text = text.slice(0, 57) + '...';
    return text || ('<' + node.tagName.toLowerCase() + '>');
  }

  // ---- styles -------------------------------------------------------
  var style = el('style', {}, []);
  style.textContent =
    '#vellum-bar,#vellum-bar *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
    '#vellum-bar{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:320px;' +
    'background:#1c1c1f;color:#f2f2f5;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);' +
    'font-size:13px;overflow:hidden;border:1px solid rgba(255,255,255,.08);}' +
    '#vellum-bar .vh{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,255,255,.04);cursor:pointer;}' +
    '#vellum-bar .vdot{width:8px;height:8px;border-radius:50%;background:#5ee38c;flex:0 0 auto;}' +
    '#vellum-bar .vtitle{font-weight:600;flex:1;}' +
    '#vellum-bar .vbody{padding:10px 12px;max-height:50vh;overflow:auto;display:none;}' +
    '#vellum-bar.open .vbody{display:block;}' +
    '#vellum-bar button{border:none;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;}' +
    '#vellum-bar .vbtn-primary{background:#5b8dff;color:#fff;}' +
    '#vellum-bar .vbtn-ghost{background:rgba(255,255,255,.08);color:#f2f2f5;}' +
    '#vellum-bar .vrow{display:flex;gap:6px;margin-bottom:8px;}' +
    '#vellum-bar textarea{width:100%;min-height:52px;border-radius:7px;border:1px solid rgba(255,255,255,.15);' +
    'background:rgba(255,255,255,.05);color:#f2f2f5;padding:6px;font-size:12px;resize:vertical;}' +
    '#vellum-bar .vqueue{list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:6px;}' +
    '#vellum-bar .vqueue li{background:rgba(255,255,255,.06);border-radius:7px;padding:6px 8px;font-size:11.5px;}' +
    '#vellum-bar .vqueue .vlabel{opacity:.7;display:block;margin-bottom:2px;}' +
    '#vellum-bar .vlog{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);' +
    'max-height:120px;overflow:auto;font-size:11.5px;color:#c9c9d2;}' +
    '#vellum-bar .vended{background:#3a1f1f;color:#ffb4b4;padding:8px;border-radius:7px;margin-bottom:8px;}' +
    '.vellum-hover-outline{outline:2px solid #5b8dff !important;outline-offset:1px;cursor:crosshair !important;}' +
    '#vellum-note-popover{position:fixed;z-index:2147483001;background:#1c1c1f;color:#f2f2f5;' +
    'border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);width:260px;' +
    'border:1px solid rgba(255,255,255,.1);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}';
  document.head.appendChild(style);

  // ---- bar ------------------------------------------------------------
  var header = el('div', { class: 'vh' }, [
    el('span', { class: 'vdot' }, []),
    el('span', { class: 'vtitle', text: 'Vellum review' }, []),
  ]);
  var annotateBtn = el('button', { class: 'vbtn-ghost', text: 'Annotate: off' }, []);
  var msgBox = el('textarea', { placeholder: 'Type feedback, or click "Annotate" then click something on the page...' }, []);
  var queueList = el('ul', { class: 'vqueue' }, []);
  var sendBtn = el('button', { class: 'vbtn-primary', text: 'Send feedback' }, []);
  var log = el('div', { class: 'vlog' }, []);
  var body = el('div', { class: 'vbody' }, [
    el('div', { class: 'vrow' }, [annotateBtn]),
    msgBox,
    queueList,
    el('div', { class: 'vrow' }, [sendBtn]),
    log,
  ]);
  var bar = el('div', { id: 'vellum-bar', class: 'open' }, [header, body]);
  document.documentElement.appendChild(bar);

  header.addEventListener('click', function () {
    bar.classList.toggle('open');
  });

  function renderQueue() {
    queueList.innerHTML = '';
    queued.forEach(function (item, i) {
      var li = el('li', {}, [
        el('span', { class: 'vlabel', text: item.selector ? item.label : 'General note' }, []),
        el('span', { text: item.note }, []),
      ]);
      var rm = el('button', { class: 'vbtn-ghost', text: 'x', style: { marginLeft: '6px', padding: '2px 6px' } }, []);
      rm.addEventListener('click', function () {
        queued.splice(i, 1);
        renderQueue();
      });
      li.appendChild(rm);
      queueList.appendChild(li);
    });
  }

  function closeNotePopover() {
    var existing = document.getElementById('vellum-note-popover');
    if (existing) existing.remove();
    if (picked) {
      picked.classList.remove('vellum-hover-outline');
      picked = null;
    }
  }

  function openNotePopover(node, rect) {
    closeNotePopover();
    picked = node;
    node.classList.add('vellum-hover-outline');
    var pop = el('div', { id: 'vellum-note-popover' }, []);
    var ta = el('textarea', {
      placeholder: 'What should change here?',
      style: { width: '100%', minHeight: '48px', marginBottom: '6px' },
    }, []);
    var row = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } }, []);
    var cancel = el('button', { class: 'vbtn-ghost', text: 'Cancel' }, []);
    var add = el('button', { class: 'vbtn-primary', text: 'Queue' }, []);
    row.appendChild(cancel);
    row.appendChild(add);
    pop.appendChild(ta);
    pop.appendChild(row);
    document.documentElement.appendChild(pop);

    var top = Math.min(rect.bottom + 8, window.innerHeight - 160);
    var left = Math.min(rect.left, window.innerWidth - 280);
    pop.style.top = Math.max(8, top) + 'px';
    pop.style.left = Math.max(8, left) + 'px';
    ta.focus();

    cancel.addEventListener('click', closeNotePopover);
    add.addEventListener('click', function () {
      var note = ta.value.trim();
      if (note) {
        queued.push({ selector: cssSelectorFor(node), label: shortLabel(node), note: note });
        renderQueue();
        bar.classList.add('open');
      }
      closeNotePopover();
    });
  }

  function setAnnotateMode(on) {
    annotateMode = on;
    annotateBtn.textContent = 'Annotate: ' + (on ? 'on (click an element)' : 'off');
    annotateBtn.classList.toggle('vbtn-primary', on);
    annotateBtn.classList.toggle('vbtn-ghost', !on);
    document.body.style.cursor = on ? 'crosshair' : '';
  }

  annotateBtn.addEventListener('click', function () {
    setAnnotateMode(!annotateMode);
  });

  var hovered = null;
  document.addEventListener(
    'mouseover',
    function (e) {
      if (!annotateMode) return;
      if (bar.contains(e.target)) return;
      if (hovered && hovered !== e.target) hovered.classList.remove('vellum-hover-outline');
      hovered = e.target;
      hovered.classList.add('vellum-hover-outline');
    },
    true
  );

  document.addEventListener(
    'click',
    function (e) {
      if (!annotateMode) return;
      if (bar.contains(e.target)) return;
      if (document.getElementById('vellum-note-popover') && document.getElementById('vellum-note-popover').contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      var target = e.target;
      if (hovered) hovered.classList.remove('vellum-hover-outline');
      openNotePopover(target, target.getBoundingClientRect());
    },
    true
  );

  sendBtn.addEventListener('click', function () {
    var message = msgBox.value.trim();
    if (!message && queued.length === 0) return;
    fetch(BASE + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'review',
        message: message,
        annotations: queued.map(function (q) {
          return { selector: q.selector, label: q.label, note: q.note };
        }),
      }),
    })
      .then(function () {
        appendLog('You: ' + (message || '(' + queued.length + ' annotation(s))'));
        msgBox.value = '';
        queued = [];
        renderQueue();
      })
      .catch(function (err) {
        appendLog('Failed to send: ' + err.message);
      });
  });

  function appendLog(text) {
    var line = el('div', { text: text }, []);
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function showEndedBanner() {
    if (document.getElementById('vellum-ended-banner')) return;
    var banner = el('div', { id: 'vellum-ended-banner', class: 'vended', text: 'Session ended by the agent.' }, []);
    body.insertBefore(banner, body.firstChild);
    setAnnotateMode(false);
  }

  function pollAgentReply() {
    fetch(BASE + '/agent-reply')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.ended) showEndedBanner();
        if (data.message && data.seq !== lastAgentReplySeq) {
          lastAgentReplySeq = data.seq;
          appendLog('Agent: ' + data.message);
          bar.classList.add('open');
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(pollAgentReply, 2500);
      });
  }

  renderQueue();
  pollAgentReply();
})();
