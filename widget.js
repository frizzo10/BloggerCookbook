(function () {
  'use strict';

  // Finds this exact <script> tag so we can read its data-* attributes,
  // even if a page has multiple scripts loaded. document.currentScript is
  // only reliable during synchronous initial execution, so grab it
  // immediately before doing anything async.
  var scriptTag = document.currentScript;
  if (!scriptTag) return;

  var cfg = {
    blog: scriptTag.getAttribute('data-blog') || (window.location.hostname || ''),
    color: scriptTag.getAttribute('data-color') || '#1C3A1A',
    bg: scriptTag.getAttribute('data-bg') || '#ffffff',
    text: scriptTag.getAttribute('data-text') || '#1a1a1a',
    border: scriptTag.getAttribute('data-border') || '#e5e5e5',
    shape: scriptTag.getAttribute('data-shape') || 'rounded',
    size: scriptTag.getAttribute('data-size') || 'medium',
    style: scriptTag.getAttribute('data-style') || 'default',
  };

  var API_BASE = 'https://bloggercookbook.netlify.app/.netlify/functions/widget-data';
  var APP_URL = 'https://app.clickpickandcook.com';

  var WIDTHS = { small: '220px', medium: '300px', large: '380px', full: '100%' };
  var PADS = { small: '.7rem', medium: '1rem', large: '1.2rem', full: '1rem' };
  var RADII = { rounded: '12px', sharp: '3px', pill: '100px' };
  var BTN_RADII = { rounded: '8px', sharp: '2px', pill: '100px' };

  function renderWidget(container, recipe) {
    var wBg = cfg.bg, wText = cfg.text, wMeta = cfg.border, wBtnBg = cfg.color, wBtnText = '#fff';
    var extraStyle = '';
    if (cfg.style === 'minimal') extraStyle += 'border:1px solid ' + cfg.border + ';';
    else if (cfg.style === 'card') extraStyle += 'box-shadow:0 4px 14px rgba(0,0,0,.09);';
    else if (cfg.style === 'bold') { wBg = cfg.color; wText = '#fff'; wMeta = 'rgba(255,255,255,.65)'; wBtnBg = cfg.bg; wBtnText = cfg.color; }
    else if (cfg.style === 'dark') { wBg = '#111'; wText = '#fff'; wMeta = 'rgba(255,255,255,.5)'; wBtnBg = cfg.color; }

    var metaParts = [];
    if (recipe.cuisine) metaParts.push(recipe.cuisine);
    if (recipe.time) metaParts.push(recipe.time);
    var attrColor = (cfg.style === 'bold' || cfg.style === 'dark') ? 'rgba(255,255,255,.3)' : cfg.border;

    var box = document.createElement('div');
    box.style.cssText = 'width:' + (WIDTHS[cfg.size] || WIDTHS.medium) + ';background:' + wBg
      + ';border-radius:' + (RADII[cfg.shape] || RADII.rounded) + ';padding:' + (PADS[cfg.size] || PADS.medium)
      + ';' + extraStyle + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box;';

    var titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:' + (cfg.size === 'small' ? '.88rem' : '.95rem') + ';font-weight:600;color:' + wText + ';margin-bottom:.2rem;';
    titleEl.textContent = (recipe.emoji ? recipe.emoji + ' ' : '') + recipe.title;
    box.appendChild(titleEl);

    if (metaParts.length) {
      var metaEl = document.createElement('div');
      metaEl.style.cssText = 'font-size:.68rem;color:' + wMeta + ';margin-bottom:.55rem;';
      metaEl.textContent = metaParts.join(' \u00b7 ');
      box.appendChild(metaEl);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'width:100%;background:' + wBtnBg + ';color:' + wBtnText + ';border:none;border-radius:'
      + (BTN_RADII[cfg.shape] || BTN_RADII.rounded) + ';padding:.5rem;font-family:inherit;font-size:.78rem;font-weight:700;cursor:pointer;';
    btn.textContent = 'Save to my week';
    btn.addEventListener('click', function () {
      // Recipe-specific pre-fill on the app side isn't built yet -- this
      // opens sign-up/sign-in with the recipe context in the URL so that
      // piece can be wired up later without changing the widget itself.
      var params = new URLSearchParams({
        widget_save: '1',
        title: recipe.title || '',
        cuisine: recipe.cuisine || '',
        time: recipe.time || '',
        ref_blog: cfg.blog,
      });
      window.open(APP_URL + '/?' + params.toString(), '_blank', 'noopener');
    });
    box.appendChild(btn);

    var attribution = document.createElement('a');
    attribution.href = 'https://myaifern.com';
    attribution.target = '_blank';
    attribution.rel = 'noopener';
    attribution.textContent = 'Powered by Fern';
    attribution.style.cssText = 'display:block;font-size:.52rem;color:' + attrColor + ';text-align:center;margin-top:.35rem;text-decoration:none;';
    box.appendChild(attribution);

    container.innerHTML = '';
    container.appendChild(box);
  }

  function init() {
    // The widget renders in place of its own <script> tag -- create a
    // container immediately after it so the layout has somewhere to land
    // without the page author needing a separate placeholder element.
    var container = document.createElement('div');
    container.setAttribute('data-fern-widget', '1');
    scriptTag.parentNode.insertBefore(container, scriptTag.nextSibling);

    var params = new URLSearchParams({
      blog: cfg.blog,
      pageUrl: window.location.href,
    });

    fetch(API_BASE + '?' + params.toString())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        // No matching recipe for this exact page -- fail silently rather
        // than show a broken/empty widget. A blogger who hasn't added this
        // specific post's recipe yet shouldn't see an error box.
        if (!data || !data.recipe) { container.remove(); return; }
        renderWidget(container, data.recipe);
      })
      .catch(function () {
        // Network/API failure -- same principle, disappear rather than
        // show something broken on someone else's site.
        container.remove();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
