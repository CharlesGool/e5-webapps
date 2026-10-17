'use strict';
'require view';

// 信息屏应用 · 信息屏 (the webapps app): the screen's own interface (概览,
// 信号, 流量 ...) in the browser, through /cgi-bin/e5-apps like the apps.  A
// second copy of it, not the device's screen: the CGI keeps it from the
// backlight, keys, motor and volume, and turns its lock screen and idle
// timeout off (e5-apps.cgi, VIEWER).  The screen is 320 x 480, shown larger.
//
// Beside it, the device's keys (v1.5).  They go to the copy here -- the key
// events the device's browser would give its page, to the frame that has the
// focus (an open app's, else the screen's), held down as long as the button
// is, repeating like a held key -- or to the device itself: the webapps
// backend's POST /key writes them to the keypad's input device, as if pressed
// there (the screen lights, the volume changes ...; this copy does not show
// the device's screen).

const BASE = '/cgi-bin/e5-apps';
const W = 320, H = 480;
const SCALES = [ 1, 1.25, 1.5, 2 ];
const KEY = 'e5-webapps-screen-scale';
const TARGET_KEY = 'e5-webapps-keys-target';
const REPEAT_DELAY = 600, REPEAT_RATE = 40;    // cage's (wlroots') defaults

// key -> [ label, KeyboardEvent key, code, keyCode ] as the device's browser
// reports it (the screen's README: menu, call, confirm and # through its XKB map)
const KEYS = {
	volup: [ '音量 +', 'AudioVolumeUp', 'AudioVolumeUp', 175 ],
	voldown: [ '音量 −', 'AudioVolumeDown', 'AudioVolumeDown', 174 ],
	side: [ '侧键', 'F1', 'F1', 112 ],
	menu: [ '菜单', 'ContextMenu', 'ContextMenu', 93 ],
	up: [ '▲', 'ArrowUp', 'ArrowUp', 38 ],
	back: [ '返回', 'Backspace', 'Backspace', 8 ],
	left: [ '◀', 'ArrowLeft', 'ArrowLeft', 37 ],
	ok: [ 'OK', 'Enter', 'Enter', 13 ],
	right: [ '▶', 'ArrowRight', 'ArrowRight', 39 ],
	call: [ '拨号', 'F13', 'F13', 124 ],
	down: [ '▼', 'ArrowDown', 'ArrowDown', 40 ],
	power: [ '电源', 'PowerOff', 'Power', 0 ],
	'*': [ '*', '*', 'NumpadMultiply', 106 ],
	'#': [ '#', '#', 'Digit3', 0 ]
};
for (let d = 0; d <= 9; d++)
	KEYS[String(d)] = [ String(d), String(d), 'Digit' + d, 48 + d ];

const LAYOUT = [
	[ 'side', [ 'volup', 'voldown', 'side' ] ],
	[ 'nav', [ 'menu', 'up', 'back', 'left', 'ok', 'right', 'call', 'down', 'power' ] ],
	[ 'digits', [ '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#' ] ]
];
const TITLES = {
	volup: '音量加', voldown: '音量减', side: '侧键（F1）：热点页', menu: '菜单：应用列表 / 退出应用',
	back: '返回', ok: '确认', call: '拨号 / 接听', power: '电源 / 挂断：熄屏；电源后 2 秒内按 * 锁键'
};

function sid() { return encodeURIComponent(L.env.sessionid || ''); }

return view.extend({
	render: function() {
		let scale = 1.5, target = 'page';
		try { const s = +localStorage.getItem(KEY); if (SCALES.indexOf(s) >= 0) scale = s; } catch (e) {}
		try { if (localStorage.getItem(TARGET_KEY) == 'device') target = 'device'; } catch (e) {}

		const frame = E('iframe', {
			'title': '信息屏',
			'style': 'width:' + W + 'px;height:' + H + 'px;border:0;transform-origin:0 0;background:#0b0e13;display:block'
		});
		const box = E('div', { 'style': 'overflow:hidden;border:1px solid #444;border-radius:14px;background:#0b0e13;flex:none' }, frame);

		const apply = () => {
			frame.style.transform = 'scale(' + scale + ')';
			box.style.width = Math.round(W * scale) + 'px';
			box.style.height = Math.round(H * scale) + 'px';
			buttons.forEach((b) => b.classList.toggle('cbi-button-action', +b.dataset.scale == scale));
		};
		const load = () => { frame.src = BASE + '/?sid=' + sid(); };

		const buttons = SCALES.map((s) => E('button', {
			'class': 'btn cbi-button', 'data-scale': s,
			'click': () => { scale = s; try { localStorage.setItem(KEY, String(s)); } catch (e) {} apply(); }
		}, Math.round(s * 100) + '%'));

		/* ---------- the keys ---------- */

		const note = E('div', { 'style': 'font-size:12px;line-height:1.5;opacity:.8;margin-top:.8em;max-width:15.5em' });
		const status = E('div', { 'style': 'font-size:12px;min-height:1.5em;margin-top:.4em;color:#d9534f' });
		const keyButtons = {};
		const held = {};          // key -> its repeat timer (page) or true (device)
		let deviceKeys = null;    // GET /keys: which keys the device has
		let queue = Promise.resolve();

		// the document a key goes to: the focused frame's, the way the device's
		// browser sends it (the screen keeps an open app's frame focused)
		const keyTarget = () => {
			let doc = null;
			try { doc = frame.contentDocument; } catch (e) {}
			for (let i = 0; doc && i < 4; i++) {
				const a = doc.activeElement;
				if (!a || a.tagName != 'IFRAME') break;
				let inner = null;
				try { inner = a.contentDocument; } catch (e) {}
				if (!inner || !inner.documentElement) break;
				doc = inner;
			}
			if (!doc || !doc.defaultView) return null;
			const a = doc.activeElement;
			return (a && a != doc.body) ? a : (doc.body || doc);
		};

		const pageEvent = (k, type, repeat) => {
			const el = keyTarget();
			if (!el) { status.textContent = '画面还没有加载'; return; }
			const win = (el.ownerDocument || el).defaultView, d = KEYS[k];
			const ev = new win.KeyboardEvent(type, { key: d[1], code: d[2], repeat: !!repeat, bubbles: true, cancelable: true, composed: true });
			// (keyCode cannot be given to the constructor)
			Object.defineProperty(ev, 'keyCode', { get: () => d[3] });
			Object.defineProperty(ev, 'which', { get: () => d[3] });
			el.dispatchEvent(ev);
		};

		const devicePost = (k, action) => {
			queue = queue.then(() => fetch(BASE + '/api/plugins/webapps/key?sid=' + sid(), {
				method: 'POST', credentials: 'same-origin', keepalive: action == 'up',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key: k, action: action })
			}).then((r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t.trim() || ('HTTP ' + r.status)); }))
				.then((r) => { status.textContent = (r && r.ok) ? '' : ((r && r.error) || '没有执行'); })
				.catch((e) => { status.textContent = '发送失败：' + (e.message || e); }));
		};

		const press = (k) => {
			if (held[k]) return;
			status.textContent = '';
			keyButtons[k].classList.add('cbi-button-action');
			if (target == 'device') {
				held[k] = true;
				devicePost(k, 'down');
				return;
			}
			pageEvent(k, 'keydown', false);
			held[k] = setTimeout(function rep() {
				pageEvent(k, 'keydown', true);
				held[k] = setTimeout(rep, REPEAT_RATE);
			}, REPEAT_DELAY);
		};

		const release = (k) => {
			if (!held[k]) return;
			const h = held[k];
			delete held[k];
			keyButtons[k].classList.remove('cbi-button-action');
			if (h === true)
				devicePost(k, 'up');
			else {
				clearTimeout(h);
				pageEvent(k, 'keyup', false);
			}
		};
		const releaseAll = () => Object.keys(held).forEach(release);

		const keyButton = (k) => {
			const b = E('button', {
				'class': 'btn cbi-button', 'type': 'button', 'title': TITLES[k] || '',
				'style': 'min-width:0;width:100%;height:2.6em;margin:0;padding:0 .2em;touch-action:none;user-select:none;' +
					'font-size:' + (k.length == 1 ? '1.15em' : '0.95em') + (k == 'power' ? ';color:#d9534f' : (k == 'call' ? ';color:#2e9a52' : ''))
			}, k == '*'
				// (an asterisk is small and high in most fonts: larger, lowered, the line kept)
				? E('span', { 'style': 'font-size:1.6em;line-height:0;position:relative;top:.22em' }, '*')
				: KEYS[k][0]);
			b.addEventListener('pointerdown', (e) => {
				if (e.button != 0) return;
				e.preventDefault();
				try { b.setPointerCapture(e.pointerId); } catch (x) {}
				press(k);
			});
			for (const ev of [ 'pointerup', 'pointercancel', 'lostpointercapture' ])
				b.addEventListener(ev, () => release(k));
			// from the keyboard (Enter / space on the button): a press
			b.addEventListener('click', (e) => {
				if (e.detail != 0 || held[k]) return;
				press(k);
				setTimeout(() => release(k), 80);
			});
			b.addEventListener('contextmenu', (e) => e.preventDefault());
			keyButtons[k] = b;
			return b;
		};

		const groups = LAYOUT.map((g) => E('div', {
			'style': 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px'
		}, g[1].map(keyButton)));

		const targetButtons = [ [ 'page', '这里的画面' ], [ 'device', '设备' ] ].map((t) => E('button', {
			'class': 'btn cbi-button', 'type': 'button', 'data-target': t[0],
			'style': 'min-width:0;width:100%;height:2.4em;margin:0;padding:0 .2em',
			'click': () => {
				releaseAll();
				target = t[0];
				try { localStorage.setItem(TARGET_KEY, target); } catch (e) {}
				applyTarget();
			}
		}, t[1]));

		const applyTarget = () => {
			status.textContent = '';
			targetButtons.forEach((b) => b.classList.toggle('cbi-button-action', b.dataset.target == target));
			const dev = target == 'device';
			for (const k in keyButtons)
				keyButtons[k].disabled = dev && deviceKeys != null && deviceKeys.keys && deviceKeys.keys[k] === false;
			note.textContent = dev
				? '按键直接送到设备，和在设备上按一样：会点亮、熄灭设备屏幕，改音量，侧键、锁键等都生效。这里的画面是另一份，不跟着设备屏幕变。' +
				  (deviceKeys && deviceKeys.devices ? ' 输入设备：' + deviceKeys.devices.join('，') : '')
				: '按键送到左边的画面（打开的应用里也一样），按住会连发。电源键只熄灭这里的画面，音量键在这里不起作用。';
			if (dev && deviceKeys == null) {
				deviceKeys = {};
				fetch(BASE + '/api/plugins/webapps/keys?sid=' + sid(), { credentials: 'same-origin' })
					.then((r) => r.ok ? r.json() : null)
					.then((r) => { deviceKeys = r || null; if (target == 'device') applyTarget(); })
					.catch(() => { deviceKeys = null; });
			}
		};

		window.addEventListener('blur', releaseAll);
		window.addEventListener('pagehide', releaseAll);

		const keypad = E('div', { 'style': 'width:15.5em;flex:none' }, [
			// (the label on a line of its own: beside it, the buttons wrap in some themes)
			E('div', { 'style': 'margin-bottom:6px' }, '按键发送到：'),
			E('div', { 'style': 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px' }, targetButtons),
			groups[0],
			groups[1],
			groups[2],
			status,
			note
		]);

		apply();
		applyTarget();
		load();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, '信息屏'),
			E('div', { 'class': 'cbi-map-descr' },
				'在浏览器里显示信息屏的界面（概览、信号、流量……），数据和屏幕上的一样，每 2 秒刷新。可以用鼠标点、拖动翻页，' +
				'点一下画面后也能用键盘方向键和回车；右边是设备上的全部按键。这是界面的另一份，不是实体屏幕的画面：' +
				'不会点亮或熄灭设备屏幕、不会震动；锁屏和自动熄屏只在这里关掉。按键选「设备」时才会送到设备上。' +
				'界面里的开关（热点、数据、短信等）会真实执行，和在屏幕上操作一样。'),
			E('div', { 'style': 'display:flex;gap:6px;align-items:center;margin:.5em 0 1em;flex-wrap:wrap' },
				[ E('span', {}, '大小：') ].concat(buttons, [
					E('button', { 'class': 'btn cbi-button', 'style': 'margin-left:1em', 'click': load }, '重新加载')
				])),
			E('div', { 'style': 'display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap' }, [ box, keypad ])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
