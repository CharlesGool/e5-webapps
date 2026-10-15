'use strict';
'require view';
'require ui';

// 信息屏应用 · 网页版 (the webapps app): the info screen's apps in the browser.
// Their pages and backends come through /cgi-bin/e5-apps (the screen's
// server stays on the device; that CGI checks this LuCI session), each app in
// a phone-sized frame, with its settings (the screen's 高级 -> <app>) below.

const BASE = '/cgi-bin/e5-apps';

function sid() { return encodeURIComponent(L.env.sessionid || ''); }

function api(path, body) {
	const url = BASE + path + (path.indexOf('?') < 0 ? '?' : '&') + 'sid=' + sid();
	const init = body === undefined ? { cache: 'no-store', credentials: 'same-origin' }
		: { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
	return fetch(url, init).then((r) => r.text().then((t) => {
		let data = null;
		try { data = JSON.parse(t); } catch (e) {}
		if (!r.ok) throw new Error((data && data.error) || t.trim() || ('HTTP ' + r.status));
		return data;
	}));
}

function text(v) {
	if (v == null) return '';
	if (typeof v == 'object') return v.zh || v.en || '';
	return String(v);
}

return view.extend({
	current: null,

	load: function() {
		return api('/api/plugins').then((r) => r.plugins || [], (e) => ({ error: e.message }));
	},

	toast: function(msg) {
		this.toastEl.textContent = msg;
		this.toastEl.style.display = 'block';
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => { this.toastEl.style.display = 'none'; }, 2500);
	},

	open: function(app) {
		this.current = app;
		this.list.querySelectorAll('button').forEach((b) => b.classList.toggle('cbi-button-action', b.dataset.id == app.id));
		this.title.textContent = text(app.name);
		this.frame.src = BASE + '/plugins/' + app.id + '/' + (app.entry || 'index.html') + '?lang=zh&sid=' + sid();
		this.frame.style.display = 'block';
		this.empty.style.display = 'none';
		this.renderSettings(app);
	},

	// the app's settings, as the screen's 高级 -> <app> has them
	renderSettings: function(app) {
		const box = this.settings;
		box.replaceChildren();
		if (!(app.settings || []).length) {
			box.appendChild(E('p', { 'class': 'cbi-value-description' }, '这个应用没有设置项。'));
			return;
		}
		box.appendChild(E('p', { 'class': 'cbi-value-description' }, '读取设置…'));
		api('/api/settings/plugin:' + app.id).then((r) => {
			if (this.current !== app) return;
			box.replaceChildren();
			(r.items || []).forEach((it) => box.appendChild(this.settingRow(app, it)));
		}).catch((e) => {
			box.replaceChildren(E('p', { 'class': 'cbi-value-description' },
				'读不到设置（' + e.message + '）。刚装的应用要等信息屏重启一次才有设置页；也可以在屏幕上的 高级 里改。'));
		});
	},

	settingRow: function(app, it) {
		let input;
		const save = (value) => {
			input.disabled = true;
			api('/api/settings/plugin:' + app.id, { id: it.id, value }).then((r) => {
				if (!r.ok) throw new Error(r.error || '保存失败');
				this.toast('已保存：' + text(it.label));
				if (this.frame.contentWindow) this.frame.contentWindow.location.reload();
			}).catch((e) => ui.addNotification(null, E('p', e.message), 'error'))
				.finally(() => { input.disabled = false; });
		};
		if (it.type == 'toggle') {
			input = E('input', { type: 'checkbox', change: (ev) => save(ev.target.checked) });
			input.checked = !!it.value;
		}
		else if (it.type == 'choice') {
			input = E('select', { 'class': 'cbi-input-select', change: (ev) => save(ev.target.value) },
				(it.options || []).map((o) => E('option', { value: String(o.value) }, text(o.label))));
			input.value = String(it.value);
		}
		else if (it.type == 'number') {
			input = E('input', { type: 'number', 'class': 'cbi-input-text', style: 'width:8em',
				min: it.min, max: it.max, step: it.step || 1, change: (ev) => save(+ev.target.value) });
			input.value = it.value;
		}
		else {
			input = E('span', {}, text(it.value));
		}
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, text(it.label) + (it.unit && text(it.label).indexOf('（') < 0 ? '（' + it.unit + '）' : '')),
			E('div', { 'class': 'cbi-value-field' }, [input,
				it.note ? E('div', { 'class': 'cbi-value-description' }, text(it.note)) : ''])
		]);
	},

	render: function(apps) {
		this.list = E('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:13em' });
		this.title = E('h3', { style: 'margin:0 0 .5em' }, '');
		this.frame = E('iframe', { style: 'display:none;width:420px;max-width:100%;height:760px;border:1px solid #444;border-radius:18px;background:#0b0e13' });
		this.empty = E('p', { 'class': 'cbi-value-description' }, '在左边选择一个应用。');
		this.settings = E('div');
		this.toastEl = E('div', { style: 'display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:8px 16px;border-radius:8px;z-index:1000' });

		// what an app's page tells the screen: a toast, closing itself
		window.addEventListener('message', (ev) => {
			if (ev.source !== this.frame.contentWindow || !ev.data || typeof ev.data != 'object') return;
			if (ev.data.e5 == 'toast') this.toast(String(ev.data.text || ''));
			if (ev.data.e5 == 'exit') { this.frame.style.display = 'none'; this.empty.style.display = ''; this.frame.src = 'about:blank'; }
		});

		if (apps && apps.error) {
			this.list.appendChild(E('p', { 'class': 'alert-message warning' }, '读不到应用列表：' + apps.error));
		}
		else if (!apps || !apps.length) {
			this.list.appendChild(E('p', {}, '还没有安装信息屏应用。'));
		}
		else {
			apps.forEach((app) => this.list.appendChild(E('button', {
				'class': 'cbi-button', 'data-id': app.id, style: 'text-align:left;padding:6px 10px',
				title: text(app.description), click: () => this.open(app)
			}, [E('strong', {}, text(app.name)), E('br'), E('small', {}, text(app.description) || app.id)])));
		}

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, '信息屏应用 · 网页版'),
			E('div', { 'class': 'cbi-map-descr' },
				'在浏览器里使用信息屏上的应用：和在屏幕上打开的是同一个应用、同一份数据，可以用鼠标点、键盘的方向键和回车。' +
				'只有登录了 LuCI 才能访问；信息屏服务本身仍然只在设备内部。'),
			E('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' }, [
				this.list,
				E('div', { style: 'flex:1;min-width:300px' }, [
					this.title, this.empty, this.frame,
					E('h4', { style: 'margin-top:1em' }, '设置'), this.settings
				])
			]),
			this.toastEl
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
