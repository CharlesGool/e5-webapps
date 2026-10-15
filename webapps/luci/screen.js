'use strict';
'require view';

// 信息屏应用 · 信息屏 (the webapps app): the screen's own interface (概览,
// 信号, 流量 ...) in the browser, through /cgi-bin/e5-apps like the apps.  A
// second copy of it, not the device's screen: the CGI keeps it from the
// backlight, keys, motor and volume, and turns its lock screen and idle
// timeout off (e5-apps.cgi, VIEWER).  The screen is 320 x 480, shown larger.

const BASE = '/cgi-bin/e5-apps';
const W = 320, H = 480;
const SCALES = [ 1, 1.25, 1.5, 2 ];
const KEY = 'e5-webapps-screen-scale';

function sid() { return encodeURIComponent(L.env.sessionid || ''); }

return view.extend({
	render: function() {
		let scale = 1.5;
		try { const s = +localStorage.getItem(KEY); if (SCALES.indexOf(s) >= 0) scale = s; } catch (e) {}

		const frame = E('iframe', {
			'title': '信息屏',
			'style': 'width:' + W + 'px;height:' + H + 'px;border:0;transform-origin:0 0;background:#0b0e13;display:block'
		});
		const box = E('div', { 'style': 'overflow:hidden;border:1px solid #444;border-radius:14px;background:#0b0e13' }, frame);

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

		apply();
		load();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, '信息屏'),
			E('div', { 'class': 'cbi-map-descr' },
				'在浏览器里显示信息屏的界面（概览、信号、流量……），数据和屏幕上的一样，每 2 秒刷新。可以用鼠标点、拖动翻页，' +
				'点一下画面后也能用键盘方向键和回车。这是界面的另一份，不是实体屏幕的画面：不会点亮或熄灭设备屏幕、不会震动、' +
				'也不会把按键传给设备；锁屏和自动熄屏只在这里关掉。界面里的开关（热点、数据、短信等）会真实执行，和在屏幕上操作一样。'),
			E('div', { 'style': 'display:flex;gap:6px;align-items:center;margin:.5em 0 1em;flex-wrap:wrap' },
				[ E('span', {}, '大小：') ].concat(buttons, [
					E('button', { 'class': 'btn cbi-button', 'style': 'margin-left:1em', 'click': load }, '重新加载')
				])),
			box
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
