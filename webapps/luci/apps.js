'use strict';
'require view';
'require rpc';
'require ui';

// The info screen's apps (plugins): the list, installing a package uploaded
// from this browser, uninstalling.  rpcd object e5-infoscreen
// (/usr/share/rpcd/ucode/e5-infoscreen.uc).
//
// The webapps app's copy of the screen's view/e5-infoscreen/apps.js (its tab
// 应用管理), with the list and the version read right: rpc.declare's expect
// already hands back the apps array and the version string, so the screen's
// load(), which looks for .apps and .version in them again, always showed no
// apps and version "-".
//
// Each app with settings (its manifest's, the screen's 高级 -> <app>) has a
// 设置 button here too: read and saved through /cgi-bin/e5-apps, as the 网页版
// tab does.
var UPLOAD = '/tmp/e5-plugin.upload';
var UPDATE_UPLOAD = '/tmp/e5-infoscreen.update.upload';

var callList = rpc.declare({ object: 'e5-infoscreen', method: 'list', expect: { apps: [] } });
var callVersion = rpc.declare({ object: 'e5-infoscreen', method: 'version', expect: { version: '' } });
var callInstall = rpc.declare({ object: 'e5-infoscreen', method: 'install' });
var callRemove = rpc.declare({ object: 'e5-infoscreen', method: 'remove', params: [ 'id' ] });
var callUpdateInstall = rpc.declare({ object: 'e5-infoscreen', method: 'update_install' });

// the screen's API through this app's CGI (checks this LuCI session)
var BASE = '/cgi-bin/e5-apps';

function api(path, body) {
	var url = BASE + path + (path.indexOf('?') < 0 ? '?' : '&') + 'sid=' + encodeURIComponent(L.env.sessionid || '');
	var init = body === undefined ? { cache: 'no-store', credentials: 'same-origin' }
		: { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
	return fetch(url, init).then(function(r) {
		return r.text().then(function(t) {
			var data = null;
			try { data = JSON.parse(t); } catch (e) {}
			if (!r.ok) throw new Error((data && data.error) || t.trim() || ('HTTP ' + r.status));
			return data;
		});
	});
}

function text(v) {
	if (v == null) return '';
	if (typeof v == 'object') return v.zh || v.en || '';
	return String(v);
}

function result(r, done) {
	if (r && r.ok) {
		ui.addNotification(null, E('p', done + (r.message ? '：' + r.message : '')), 'info');
		window.setTimeout(function() { location.reload(); }, 800);
	} else {
		ui.addNotification(null, E('p', '失败：' + ((r && r.message) || '?')), 'danger');
	}
}

return view.extend({
	handleUpload: function() {
		return ui.uploadFile(UPLOAD).then(function() {
			return callInstall();
		}).then(function(r) {
			result(r, '已安装');
		}).catch(function(e) {
			if (e && e.message) ui.addNotification(null, E('p', e.message), 'danger');
		});
	},

	handleRemove: function(app) {
		if (!confirm('卸载“' + (app.name || app.id) + '”？' + (app.builtin ? '（内置应用会在下次更新系统镜像时回来）' : '')))
			return;
		return callRemove(app.id).then(function(r) {
			// (this page and its menu belong to webapps: its CGI, asked once
			// more, takes them out with it)
			if (app.id == 'webapps' && r && r.ok)
				fetch('/cgi-bin/e5-apps/?sid=' + encodeURIComponent(L.env.sessionid || ''), { cache: 'no-store' }).catch(function() {});
			result(r, '已卸载');
		});
	},

	// the app's settings in a dialog, each saved as it changes
	handleSettings: function(a) {
		var box = E('div', {}, E('p', { 'class': 'spinning' }, '读取设置…'));
		var status = E('span', { 'class': 'cbi-value-description', 'style': 'margin-right:1em' }, '');
		ui.showModal('设置：' + (a.name || a.id), [
			box,
			E('div', { 'class': 'right' }, [
				status,
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, '关闭')
			])
		]);

		var row = function(it) {
			var input;
			var save = function(value) {
				input.disabled = true;
				status.textContent = '保存中…';
				api('/api/settings/plugin:' + a.id, { id: it.id, value: value }).then(function(r) {
					if (!r || !r.ok) throw new Error((r && r.error) || '保存失败');
					status.textContent = '已保存：' + text(it.label);
				}).catch(function(e) {
					status.textContent = '';
					ui.addNotification(null, E('p', '保存失败：' + e.message), 'danger');
				}).then(function() { input.disabled = false; });
			};
			if (it.type == 'toggle') {
				input = E('input', { 'type': 'checkbox', 'change': function(ev) { save(ev.target.checked); } });
				input.checked = !!it.value;
			}
			else if (it.type == 'choice') {
				input = E('select', { 'class': 'cbi-input-select', 'change': function(ev) { save(ev.target.value); } },
					(it.options || []).map(function(o) { return E('option', { 'value': String(o.value) }, text(o.label)); }));
				input.value = String(it.value);
			}
			else if (it.type == 'number') {
				input = E('input', { 'type': 'number', 'class': 'cbi-input-text', 'style': 'width:8em',
					'min': it.min, 'max': it.max, 'step': it.step || 1, 'change': function(ev) { save(+ev.target.value); } });
				input.value = it.value;
			}
			else {
				input = E('span', {}, text(it.value));
			}
			var label = text(it.label);
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, label + (it.unit && label.indexOf('（') < 0 ? '（' + it.unit + '）' : '')),
				E('div', { 'class': 'cbi-value-field' }, [ input,
					it.note ? E('div', { 'class': 'cbi-value-description' }, text(it.note)) : '' ])
			]);
		};

		return api('/api/settings/plugin:' + a.id).then(function(r) {
			var items = (r && r.items) || [];
			box.replaceChildren.apply(box, items.length ? items.map(row) : [ E('p', '这个应用没有设置项。') ]);
		}).catch(function(e) {
			box.replaceChildren(E('p', {}, '读不到设置（' + e.message + '）。刚装的应用要等信息屏重启一次才有设置页；也可以在屏幕上的 高级 里改。'));
		});
	},

	handleUpdateUpload: function() {
		return ui.uploadFile(UPDATE_UPLOAD).then(function() {
			return callUpdateInstall();
		}).then(function(r) {
			result(r, '信息屏已更新，正在重启');
		}).catch(function(e) {
			if (e && e.message) ui.addNotification(null, E('p', e.message), 'danger');
		});
	},

	render: function(data) {
		var apps = data.apps || [], version = data.version || '-', settings = data.settings || {};
		var rows = (apps || []).map(L.bind(function(a) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, a.name || a.id),
				E('td', { 'class': 'td' }, E('code', a.id)),
				E('td', { 'class': 'td' }, a.version || '-'),
				E('td', { 'class': 'td' }, a.builtin ? '内置' : '已安装'),
				E('td', { 'class': 'td cbi-section-actions' }, [
					(settings[a.id] || []).length ? E('button', {
						'class': 'btn cbi-button cbi-button-edit',
						'click': ui.createHandlerFn(this, 'handleSettings', a)
					}, '设置') : '',
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'click': ui.createHandlerFn(this, 'handleRemove', a)
					}, '卸载')
				])
			]);
		}, this));

		return E([], [
			E('h2', '信息屏应用'),
			E('div', { 'class': 'cbi-map-descr' },
				'设备屏幕上“应用”页里的应用（插件）。应用包是一个 .tar.gz 或 .zip 压缩包，根目录（或唯一的顶层目录）里有 manifest.json；' +
				'格式见 e5-infoscreen 的 docs/API.md。应用可以带后端代码并以 root 身份运行，只安装你信任、看过代码的应用。'),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, '名称'), E('th', { 'class': 'th' }, 'ID'),
						E('th', { 'class': 'th' }, '版本'), E('th', { 'class': 'th' }, '来源'),
						E('th', { 'class': 'th cbi-section-actions' }, '')
					])
				].concat(rows.length ? rows : [ E('tr', { 'class': 'tr placeholder' }, E('td', { 'class': 'td' }, '没有应用')) ]))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', '安装应用'),
				E('p', '选择应用包上传并安装；同一 ID 的应用会被替换（即升级）。安装的应用保存在 /etc/e5-infoscreen/plugins，更新系统镜像后仍在。'),
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleUpload') }, '上传并安装…')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', '更新信息屏'),
				E('p', '当前版本：' + version + '。上传由本项目 CI 生成的 e5-infoscreen-*.tar.gz；安装前会检查归档路径、版本和大小，设置与已安装应用会保留。'),
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleUpdateUpload') }, '上传并更新…')
			])
		]);
	},

	load: function() {
		// which apps have settings: the screen's app list (without it, no 设置 buttons)
		var plugins = api('/api/plugins').then(function(r) { return (r && r.plugins) || []; }, function() { return []; });
		return Promise.all([ callList(), callVersion(), plugins ]).then(function(r) {
			var settings = {};
			r[2].forEach(function(p) { if (p && p.id) settings[p.id] = p.settings || []; });
			var apps = Array.isArray(r[0]) ? r[0] : ((r[0] && r[0].apps) || []);
			var version = (typeof r[1] == 'string') ? r[1] : ((r[1] && r[1].version) || '');
			return { apps: apps, version: version || '-', settings: settings };
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
