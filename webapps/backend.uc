// 网页版应用 (Apps on the Web, id webapps): the info screen's apps in a
// browser, through LuCI.  This installs, and keeps installed (an image update
// brings neither; the notification poll puts them back):
//
//   /www/cgi-bin/e5-apps   (e5-apps.cgi) passes requests on to the screen's
//                          server for a logged-in LuCI session only
//   LuCI 服务 -> 信息屏应用 -> 网页版   (luci/index.js, luci/menu.json)
//
// The menu file also puts the app list (the page 服务 -> 信息屏应用 opens) in
// a tab of its own, 应用管理, so that it is one of the tabs beside 底部导航,
// 屏幕壁纸, 信息屏设置; the list there is luci/apps.js, the screen's own
// view/e5-infoscreen/apps.js with its list read right (that one always shows
// no apps).  LuCI reads menu.d in name order: luci-app-e5-webapps.json comes
// after the screen's luci-app-e5-infoscreen.json and its entries win; the
// screen's files stay as they are, and without this file the menu is the
// screen's again.
//
// The CGI removes itself and the page once the app is gone.
//
//   GET  /status          what is installed
//   GET  /notifications   (none: only the install check, once a minute)

'use strict';

import { readfile, writefile } from 'fs';

const DIR = '/etc/e5-infoscreen/plugins/webapps';
// the app's file -> where it goes, its mode
const FILES = [
	[ 'e5-apps.cgi', '/www/cgi-bin/e5-apps', '755' ],
	[ 'luci/index.js', '/www/luci-static/resources/view/e5-webapps/index.js', '644' ],
	[ 'luci/apps.js', '/www/luci-static/resources/view/e5-webapps/apps.js', '644' ],
	[ 'luci/menu.json', '/usr/share/luci/menu.d/luci-app-e5-webapps.json', '644' ]
];

return function(ctx) {
	function ensure_installed() {
		let changed = false, missing = [];
		for (let f in FILES) {
			let want = readfile(`${DIR}/${f[0]}`);
			if (want == null) { push(missing, f[0]); continue; }
			if (readfile(f[1]) == want) continue;
			ctx.run(`mkdir -p "$(dirname '${f[1]}')"`);
			writefile(f[1] + '.new', want);
			ctx.run(`chmod ${f[2]} '${f[1]}.new' && mv -f '${f[1]}.new' '${f[1]}'`);
			changed = true;
		}
		if (changed) {
			// (LuCI caches its menu)
			ctx.run('rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache');
			ctx.log('installed: LuCI 服务 -> 信息屏应用 -> 网页版');
		}
		let ok = true;
		for (let f in FILES)
			if (readfile(f[1]) == null) ok = false;
		return { installed: ok, error: length(missing) ? 'missing ' + join(', ', missing) : null };
	}

	return {
		'GET /status': function(req) {
			let s = ctx.state_get('installed', 60);
			if (s == null) {
				s = ensure_installed();
				ctx.state_put('installed', s);
			}
			return s;
		},
		'GET /notifications': function(req) {
			if (!ctx.state_get('checked', 60)) {
				ctx.state_put('checked', { at: time() });
				ctx.state_put('installed', ensure_installed());
			}
			return { notifications: [] };
		}
	};
};
