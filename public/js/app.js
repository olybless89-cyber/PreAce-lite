/* Small, dependency-free. HTMX does the fetching; this handles polish. */

/* ── Wallet dashboard: balance visibility toggle ──
   Local per-device preference, never sent to the server. Server-side the
   authoritative balance is untouched — this only masks what is rendered. */
(function () {
  const view = document.querySelector('[data-balance-view]');
  if (!view) return;
  const amountEl = view.querySelector('[data-balance-amount]');
  const equivEl = view.querySelector('[data-balance-equiv]');
  const btn = view.querySelector('[data-balance-toggle]');
  if (!amountEl || !btn) return;

  const KEY = 'w_hide_balance';
  let hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch {}

  const mask = () => '••••••••';
  const apply = () => {
    const hide = hidden;
    amountEl.textContent = hide ? mask() : amountEl.dataset.full;
    if (equivEl) equivEl.textContent = hide ? '' : equivEl.dataset.full;
    btn.setAttribute('aria-pressed', String(!hide));
    btn.setAttribute('aria-label', hide ? 'Show balance' : 'Hide balance');
    view.classList.toggle('is-hidden', hide);
  };

  // Store the real rendered values once, then toggle between them.
  if (!amountEl.dataset.full) {
    amountEl.dataset.full = amountEl.textContent.trim();
    if (equivEl) equivEl.dataset.full = equivEl.textContent.trim();
  }
  apply();

  btn.addEventListener('click', () => {
    hidden = !hidden;
    try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch {}
    apply();
  });
})();

/* ── User menu dropdown (circular profile button in the topbar) ── */
(function () {
  const btn = document.querySelector('[data-user-menu]');
  if (!btn) return;
  const panel = btn.parentElement?.querySelector('.w-usermenu__panel');
  const root = btn.closest('.w-usermenu');
  if (!panel) return;

  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
  };
  const open = () => {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();

/* ── Referral card dismiss ── */
(function () {
  const card = document.querySelector('[data-referral]');
  const btn = card?.querySelector('[data-referral-close]');
  if (!card || !btn) return;
  btn.addEventListener('click', () => {
    card.style.transition = 'opacity .25s ease, transform .25s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-6px)';
    setTimeout(() => { card.hidden = true; }, 240);
  });
})();

// Live clock in the hero chart bar
const clock = document.getElementById('clock');
if (clock) {
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); };
  tick(); setInterval(tick, 1000);
}

// Flash a cell green/red when its value changes after an HTMX swap.
document.body.addEventListener('htmx:beforeSwap', (e) => {
  const t = e.detail.target;
  t.querySelectorAll?.('[data-watch]').forEach((el) => {
    el.dataset.prev = el.textContent.trim();
  });
});
document.body.addEventListener('htmx:afterSwap', (e) => {
  e.detail.target.querySelectorAll?.('[data-watch]').forEach((el) => {
    const prev = parseFloat((el.dataset.prev || '').replace(/[^0-9.-]/g, ''));
    const now = parseFloat(el.textContent.replace(/[^0-9.-]/g, ''));
    if (!isNaN(prev) && !isNaN(now) && prev !== now) {
      el.classList.add(now > prev ? 'flash-up' : 'flash-down');
      setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 700);
    }
  });
});

// Sidebar on mobile — proper side drawer with scrim, ESC, link & close-button
// dismissal, and body-scroll lock while open.
const side = document.querySelector('.side');
const toggleBtn = document.querySelector('[data-side-toggle]');

function closeSide() {
  if (!side) return;
  side.classList.remove('open');
  document.body.classList.remove('side-open');
  const s = document.querySelector('.scrim');
  if (s) s.remove();
}
function openSide() {
  if (!side) return;
  side.classList.add('open');
  document.body.classList.add('side-open');
  if (!document.querySelector('.scrim')) {
    const s = document.createElement('div');
    s.className = 'scrim';
    s.onclick = closeSide;
    document.body.appendChild(s);
  }
  side.focus?.();
}

toggleBtn?.addEventListener('click', openSide);

// Inject a header with a close affordance into the drawer (mobile only).
if (side && !side.querySelector('.side-close')) {
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'side-close';
  header.setAttribute('aria-label', 'Close menu');
  header.innerHTML =
    '<span>Menu</span>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  header.addEventListener('click', closeSide);
  side.insertBefore(header, side.firstChild);
}

// Navigation links — allow the browser to follow href naturally.
// We simply close the overlay visually (it will be destroyed on page load anyway).
// NEVER call preventDefault() on anchor clicks — doing so blocks navigation.
side?.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a && side.classList.contains('open')) {
    // Let the browser navigate; just clean up the overlay so the outgoing
    // page doesn't briefly show a stuck scrim.
    closeSide();
  }
});

// ESC closes the drawer.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && side?.classList.contains('open')) closeSide();
});

// Close the drawer if the viewport grows back past the mobile breakpoint.
window.matchMedia('(min-width: 901px)').addEventListener('change', (m) => {
  if (m.matches) closeSide();
});

/* ── Public site mobile navigation ── */
(function () {
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('navlinks');
  const backdrop = document.querySelector('[data-nav-backdrop]');
  if (!toggle || !nav) return;

  function closeNav() {
    nav.classList.remove('open');
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openNav() {
    nav.classList.add('open');
    document.body.classList.add('nav-open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => {
    if (nav.classList.contains('open')) closeNav();
    else openNav();
  });

  backdrop?.addEventListener('click', closeNav);

  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) closeNav();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) closeNav();
  });
})();

// Confirm destructive actions without a library
document.body.addEventListener('click', (e) => {
  const el = e.target.closest('[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Deposit page: reveal the instructions/address + method-specific fields for
// the chosen method. Hidden panels get disabled inputs so HTML required
// checks never block a submit.
const methodSel = document.getElementById('m');
if (methodSel && methodSel.dataset.methods) {
  const methods = JSON.parse(methodSel.dataset.methods);
  const box = document.getElementById('wallet-box');
  const addr = document.getElementById('wallet-addr');
  const panels = document.querySelectorAll('.method-fields[data-for]');
  const update = () => {
    const m = (methods || []).find((x) => x.slug === methodSel.value);
    const text = m ? (m.instructions || '') : '';
    if (text) { addr.textContent = text; box.style.display = ''; }
    else { box.style.display = 'none'; }
    panels.forEach((p) => {
      const on = p.dataset.for === methodSel.value;
      p.style.display = on ? '' : 'none';
      p.querySelectorAll('input').forEach((i) => { i.disabled = !on; });
    });
  };
  methodSel.addEventListener('change', update);
  update();
}

// Copy-to-clipboard helper
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const target = document.querySelector(btn.dataset.copy);
  if (!target) return;
  navigator.clipboard?.writeText(target.textContent.trim());
  const t = btn.textContent; btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = t; }, 1200);
});

// Amount preset chips (deposit / withdraw): fill the linked amount input.
document.querySelectorAll('.amount-presets').forEach((group) => {
  const target = group.dataset.target ? document.querySelector(group.dataset.target) : null;
  if (!target) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-amt]');
    if (!btn) return;
    const val = btn.dataset.amt === 'max' ? group.dataset.max : btn.dataset.amt;
    target.value = val || '';
    target.dispatchEvent(new Event('input'));
    group.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

// Trade page: live order estimate + chart symbol sync
(function () {
  const sel = document.getElementById('sym');
  const amt = document.getElementById('amt');
  const est = document.getElementById('est');
  const chartSym = document.getElementById('chart-sym');
  if (!sel || !amt) return;
  let prices = [];
  try { prices = JSON.parse(sel.dataset.prices || '[]'); } catch {}
  const fmt = (n, dp = 6) => Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
  const refresh = () => {
    const p = prices.find(x => x.s === sel.value) || prices[0];
    if (!p) return;
    const usd = Number(amt.value || 0);
    if (chartSym) chartSym.textContent = (p.k || sel.value).replace(/USDT$/, 'USD');
    if (usd > 0 && p.px > 0) {
      est.textContent = `≈ ${fmt(usd / p.px)} ${p.k} at ${Number(p.px).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
    } else {
      est.textContent = '';
    }
  };
  sel.addEventListener('change', refresh);
  amt.addEventListener('input', refresh);
  refresh();
})();
