// Settings page: plan and license key, look, analysis defaults. Opened from the panel's gear, the ★ button, the
// extension's "Options" menu, and once after install (#welcome).
import { PREMIUM_CONFIG } from './premium-config.js';
import { PROVIDER_ORIGINS, activateKey, deactivateKey, isPremium, isUnpacked, loadLicense, saveLicense } from './license.js';
import { FREE_LIMITS, PREMIUM_LIMITS, THEMES, themeAllowed } from './plan.js';
import {
  loadCompact, loadDepth, loadGlassMode, loadLines, loadTheme, onSettingsChange,
  saveCompact, saveDepth, saveGlassMode, saveLines, saveTheme,
} from './settings.js';

const $ = (id) => document.getElementById(id);
const unpacked = isUnpacked();
let license = null;
let premium = false;

function msg(text, kind = '') {
  $('keyMsg').textContent = text;
  $('keyMsg').className = 'msg' + (kind ? ' ' + kind : '');
}

function renderPlan() {
  premium = isPremium(license, { unpacked });
  $('planBadge').textContent = premium ? '★ Premium' : 'Free';
  $('planBadge').className = 'badge' + (premium ? ' premium' : '');
  const selling = PREMIUM_CONFIG.provider !== 'none';
  const active = premium && license && license.status === 'active';
  $('buyBox').hidden = active;
  $('activeBox').hidden = !active;
  if (active) $('activeText').textContent = `Premium is on${license.email ? ' for ' + license.email : ''}. Thank you for supporting Pawnshot.`;
  $('saleNote').textContent = selling
    ? `Premium is ${PREMIUM_CONFIG.priceLabel || 'available'}. After paying you get a license key by email: paste it below.`
    : 'Premium is coming soon. Every free feature works now.';
  $('buyBtn').hidden = !selling || !PREMIUM_CONFIG.checkoutUrl;
  if (PREMIUM_CONFIG.checkoutUrl) $('buyBtn').href = PREMIUM_CONFIG.checkoutUrl;
  if (PREMIUM_CONFIG.priceLabel) $('buyBtn').textContent = `Get Premium · ${PREMIUM_CONFIG.priceLabel}`;
  $('keyForm').hidden = !selling;
  if (license && license.status === 'invalid' && license.message) msg(`Your key stopped working: ${license.message}`, 'err');
  $('devBox').hidden = !unpacked;
  $('devPremium').checked = !!(license && license.status === 'dev');
  const lim = premium ? PREMIUM_LIMITS : FREE_LIMITS;
  $('depth').max = String(lim.maxDepth);
  $('depthHint').textContent = premium ? 'up to 30' : `up to ${FREE_LIMITS.maxDepth} (30 with Premium)`;
  for (const o of $('lines').options) o.disabled = +o.value > lim.maxLines;
  renderThemes();
}

let theme = 'classic';
function renderThemes() {
  const box = $('themes');
  box.textContent = '';
  for (const [name, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme' + (themeAllowed(name, premium) ? '' : ' locked');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(name === theme));
    b.title = themeAllowed(name, premium) ? t.label : `${t.label} (Premium)`;
    const sw = document.createElement('span');
    sw.className = 'sw';
    for (const c of [t.light, t.dark, t.dark, t.light]) { const i = document.createElement('i'); i.style.background = c; sw.appendChild(i); }
    b.append(sw, document.createTextNode(t.label));
    b.onclick = () => {
      if (!themeAllowed(name, premium)) { $('premium').scrollIntoView({ behavior: 'smooth' }); return; }
      theme = name;
      saveTheme(name);
      renderThemes();
    };
    box.appendChild(b);
  }
}

$('keyForm').onsubmit = async (e) => {
  e.preventDefault();
  const key = $('keyInput').value.trim();
  if (!key) { msg('Paste the license key from your receipt email.', 'err'); return; }
  const origin = PROVIDER_ORIGINS[PREMIUM_CONFIG.provider];
  // Chrome asks once to let Pawnshot talk to the shop that sold the key; nothing else is ever sent there.
  try {
    if (origin && !(await chrome.permissions.request({ origins: [origin] }))) {
      msg('Pawnshot needs permission to check the key with the shop. Nothing else is sent.', 'err');
      return;
    }
  } catch (err) { /* older Chrome: try anyway */ }
  $('activateBtn').disabled = true;
  msg('Checking the key…');
  const r = await activateKey(key);
  $('activateBtn').disabled = false;
  if (!r.ok) { msg(r.message, 'err'); return; }
  license = r.record;
  await saveLicense(license);
  $('keyInput').value = '';
  msg('Premium is on. Enjoy!', 'ok');
  renderPlan();
};

$('deactivateBtn').onclick = async () => {
  if (!license) return;
  $('deactivateBtn').disabled = true;
  await deactivateKey(license);
  $('deactivateBtn').disabled = false;
  license = null;
  await saveLicense(null);
  msg('The key was removed from this browser. You can use it on another one.', 'ok');
  renderPlan();
};

$('devPremium').onchange = async () => {
  license = $('devPremium').checked ? { status: 'dev', provider: 'dev', key: 'dev', checkedAt: Date.now(), okAt: Date.now() } : null;
  await saveLicense(license);
  renderPlan();
};

$('glass').onchange = () => saveGlassMode($('glass').value);
$('compact').onchange = () => saveCompact($('compact').checked);
$('depth').onchange = () => {
  const lim = premium ? PREMIUM_LIMITS : FREE_LIMITS;
  const d = Math.max(8, Math.min(lim.maxDepth, Math.round(+$('depth').value || 20)));
  $('depth').value = String(d);
  saveDepth(d);
};
$('lines').onchange = () => saveLines(+$('lines').value);
$('shortcutBtn').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

onSettingsChange((ch) => {
  if ('license' in ch) { license = ch.license || null; renderPlan(); }
});

(async () => {
  try { $('version').textContent = 'version ' + chrome.runtime.getManifest().version; } catch (e) { /* not in the extension */ }
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === '_execute_action');
    if (c && c.shortcut) $('shortcut').textContent = c.shortcut;
  } catch (e) { /* default shown */ }
  $('welcome').hidden = location.hash !== '#welcome';
  license = await loadLicense();
  const [g, c, t, d, l] = await Promise.all([loadGlassMode(), loadCompact(), loadTheme(), loadDepth(), loadLines()]);
  $('glass').value = g;
  $('compact').checked = c;
  theme = t;
  $('depth').value = String(d);
  $('lines').value = String(l);
  renderPlan();
  if (location.hash === '#premium') $('premium').scrollIntoView();
})();
