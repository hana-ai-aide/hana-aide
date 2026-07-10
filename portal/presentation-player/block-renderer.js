/* block-renderer.js — Block deck JSON → DOM .slide sections
 * Phase 3: PRES-BLOCK-03
 * 由 block-deck-player.html 載入；渲染完成後 presentation-core.js 自動接管
 * 規格：specs/SPEC-block-deck.md
 */
(function () {
  'use strict';

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var elem = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class') elem.className = v;
        else if (k === 'style') elem.style.cssText = v;
        else elem.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') elem.appendChild(document.createTextNode(c));
      else elem.appendChild(c);
    });
    return elem;
  }

  function makeSlide(extraClass, transcript) {
    var cls = ['slide', extraClass].filter(Boolean).join(' ');
    var section = document.createElement('section');
    section.className = cls;
    if (transcript) section.dataset.transcript = transcript;
    return section;
  }

  function kicker(text) {
    return el('div', { 'class': 'kicker' }, [text]);
  }

  function actionTitle(text) {
    return el('h2', { 'class': 'block-action-title' }, [text]);
  }

  // ── Layout renderers ──────────────────────────────────────────────────────

  function rTitle(block) {
    var section = makeSlide('title-slide', block.transcript);
    if (block.kicker) section.appendChild(kicker(block.kicker));
    section.appendChild(el('h1', null, [block.title || '']));
    if (block.subtitle) section.appendChild(el('p', null, [block.subtitle]));
    return section;
  }

  function rBullets(block) {
    var section = makeSlide(null, block.transcript);
    if (block.kicker) section.appendChild(kicker(block.kicker));
    if (block.title) section.appendChild(actionTitle(block.title));
    var ul = el('ul', { 'class': 'block-bullets' });
    (block.bullets || []).forEach(function (b) {
      ul.appendChild(el('li', { 'class': 'block-bullet level-' + (b.level || 1) }, [b.text || '']));
    });
    section.appendChild(ul);
    return section;
  }

  function rTable(block) {
    var section = makeSlide(null, block.transcript);
    if (block.kicker) section.appendChild(kicker(block.kicker));
    if (block.title) section.appendChild(actionTitle(block.title));

    var td = block.table || {};
    var headers = td.headers || [];
    var rows = td.rows || [];
    var table = document.createElement('table');

    if (headers.length) {
      var thead = document.createElement('thead');
      var tr = document.createElement('tr');
      headers.forEach(function (h) { tr.appendChild(el('th', null, [h])); });
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell) { tr.appendChild(el('td', null, [String(cell)])); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  function rImage(block) {
    var section = makeSlide(null, block.transcript);
    if (block.kicker) section.appendChild(kicker(block.kicker));
    if (block.title) section.appendChild(actionTitle(block.title));
    var wrap = el('div', { 'class': 'block-image-wrap' });
    if (block.imagePath) {
      var img = document.createElement('img');
      img.src = '/raw?path=' + encodeURIComponent(block.imagePath);
      img.alt = block.imageAlt || '';
      img.className = 'block-image';
      wrap.appendChild(img);
    }
    if (block.caption) {
      wrap.appendChild(el('p', { 'class': 'block-caption' }, [block.caption]));
    }
    section.appendChild(wrap);
    return section;
  }

  function rSplit(block) {
    var section = makeSlide(null, block.transcript);
    if (block.kicker) section.appendChild(kicker(block.kicker));
    if (block.title) section.appendChild(actionTitle(block.title));

    var grid = el('div', { 'class': 'split' });

    function makeCol(col) {
      if (!col) return null;
      var div = document.createElement('div');
      if (col.heading) {
        div.appendChild(el('span', {
          'style': 'font-size:36px;color:#fff;font-weight:900;display:block;margin-bottom:18px'
        }, [col.heading]));
      }
      (col.items || []).forEach(function (item) {
        div.appendChild(el('span', null, [String(item)]));
      });
      return div;
    }

    var left = makeCol(block.left);
    var right = makeCol(block.right);
    if (left) grid.appendChild(left);
    if (right) grid.appendChild(right);
    section.appendChild(grid);
    return section;
  }

  function rQuote(block) {
    var section = makeSlide(null, block.transcript);
    section.style.cssText = 'text-align:center;align-items:center;justify-content:center;';
    if (block.kicker) section.appendChild(kicker(block.kicker));
    var wrap = el('div', { 'class': 'block-quote-wrap' });
    wrap.appendChild(el('blockquote', { 'class': 'block-quote-text' },
      ['“' + (block.quote || '') + '”']));
    if (block.attribution) {
      wrap.appendChild(el('p', { 'class': 'block-quote-attr' },
        ['— ' + block.attribution]));
    }
    section.appendChild(wrap);
    return section;
  }

  function rCustom(block) {
    var section = makeSlide(null, block.transcript);
    if (block.html) {
      var wrap = el('div', { 'class': 'block-custom-wrap' });
      wrap.innerHTML = block.html;
      section.appendChild(wrap);
    }
    return section;
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  var RENDERERS = {
    title:   rTitle,
    bullets: rBullets,
    table:   rTable,
    image:   rImage,
    split:   rSplit,
    quote:   rQuote,
    custom:  rCustom,
  };

  function renderBlockDeck(deckData, container) {
    (deckData.slides || []).forEach(function (block) {
      var fn = RENDERERS[block.layout];
      if (!fn) {
        console.warn('[block-renderer] 未知版型:', block.layout);
        return;
      }
      container.appendChild(fn(block));
    });
  }

  window.BlockRenderer = { renderBlockDeck: renderBlockDeck };
})();
