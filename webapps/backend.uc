// 网页版应用 (Apps on the Web, id webapps): the info screen's apps in a
// browser, through LuCI.  This installs, and keeps installed (an image update
// brings neither; the notification poll puts them back):
//
//   /www/cgi-bin/e5-apps   (e5-apps.cgi) passes requests on to the screen's
//                          server for a logged-in LuCI session only
//   LuCI 服务 -> 信息屏应用 -> 信息屏   (luci/screen.js, luci/menu.json: the
//                          screen's own interface, its apps in it, a copy
//                          kept from the device's screen)
//
// (Up to v1.3 there was a tab 网页版 too, the apps one by one with their
// settings; 信息屏 opens the apps and 应用管理 has their settings, so it is
// gone: its page is taken out, OLD.)
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
// The 信息屏 tab has the device's keys beside the screen (v1.5).  They go to
// the copy in the browser (the page's own key events, screen.js), or to the
// device as if pressed there: written to the keypad's /dev/input/eventN, so
// the kernel, the screen and every app see a real key (the backlight, the
// key lock, the volume, the side key's long press ...).  Which eventN has a
// key is read from /proc/bus/input/devices: each key's evdev codes in KEYS
// tried in order, on the device with the most of these keys first (the E5:
// sprd-keypad, then gpio-keys with power, side key and volume; the touch
// panel has menu and back too, and the headset the volume).
//
//   GET  /status          what is installed
//   GET  /keys            which keys the device has: { keys: { <name>: true|false }, devices }
//   POST /key             {"key": <name>, "action": "down"|"up"}: the key on the device
//   GET  /notifications   (none: only the install check, once a minute)

'use strict';

import { readfile, writefile, open } from 'fs';

// key -> its evdev codes (linux/input-event-codes.h), the first the device
// has; [ a, b ]: both at once, as the key sends them
const KEYS = {
	up: [ 103 ], down: [ 108 ], left: [ 105 ], right: [ 106 ],
	ok: [ 353, 352, 28 ],                 // KEY_SELECT, KEY_OK, KEY_ENTER
	menu: [ 139 ], call: [ 169 ],         // KEY_MENU, KEY_PHONE
	back: [ [ 158, 14 ], 158, 14 ],       // KEY_BACK + KEY_BACKSPACE: the keypad sends both
	power: [ 116 ], side: [ 59 ],         // KEY_POWER (power / hang up), KEY_F1
	volup: [ 115 ], voldown: [ 114 ],
	'1': [ 2, 513 ], '2': [ 3, 514 ], '3': [ 4, 515 ], '4': [ 5, 516 ], '5': [ 6, 517 ],
	'6': [ 7, 518 ], '7': [ 8, 519 ], '8': [ 9, 520 ], '9': [ 10, 521 ], '0': [ 11, 512 ],
	'*': [ 522, 55 ], '#': [ 523 ]        // KEY_NUMERIC_STAR / KEY_KPASTERISK, KEY_NUMERIC_POUND
};

const DIR = '/etc/e5-infoscreen/plugins/webapps';
// the app's file -> where it goes, its mode
const FILES = [
	[ 'e5-apps.cgi', '/www/cgi-bin/e5-apps', '755' ],
	[ 'luci/apps.js', '/www/luci-static/resources/view/e5-webapps/apps.js', '644' ],
	[ 'luci/screen.js', '/www/luci-static/resources/view/e5-webapps/screen.js', '644' ],
	[ 'luci/menu.json', '/usr/share/luci/menu.d/luci-app-e5-webapps.json', '644' ]
];

// what older versions installed and this one does not
const OLD = [ '/www/luci-static/resources/view/e5-webapps/index.js' ];

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
		for (let o in OLD)
			if (readfile(o) != null) {
				ctx.run(`rm -f '${o}'`);
				changed = true;
			}
		if (changed) {
			// (LuCI caches its menu)
			ctx.run('rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache');
			ctx.log('installed: LuCI 服务 -> 信息屏应用 (应用管理, 信息屏)');
		}
		let ok = true;
		for (let f in FILES)
			if (readfile(f[1]) == null) ok = false;
		return { installed: ok, error: length(missing) ? 'missing ' + join(', ', missing) : null };
	}

	// the input devices with keys: { name, node, words: the KEY bitmap's
	// words, most significant first, as /proc prints them }
	function input_devices() {
		let out = [], dev = {};
		for (let line in split(readfile('/proc/bus/input/devices') ?? '', '\n')) {
			let m;
			if (trim(line) == '') {
				if (dev.node && dev.words) push(out, dev);
				dev = {};
			}
			else if ((m = match(line, /^N: Name="(.*)"$/)))
				dev.name = m[1];
			else if ((m = match(line, /^H: Handlers=.*(event[0-9]+)/)))
				dev.node = '/dev/input/' + m[1];
			else if ((m = match(line, /^B: KEY=([0-9a-f ]+)$/)))
				dev.words = split(trim(m[1]), ' ');
		}
		if (dev.node && dev.words) push(out, dev);
		return out;
	}

	// the kernel's long, in bits: the bitmap's word size
	function long_bits() {
		return match(ctx.sh('uname -m') ?? '', /64|armv8/) ? 64 : 32;
	}

	// bit b of the bitmap, read digit by digit (a word is wider than ucode's numbers)
	function has_bit(words, bits, b) {
		let i = length(words) - 1 - int(b / bits);
		if (i < 0) return false;
		let w = words[i], d = int((b % bits) / 4);
		if (d >= length(w)) return false;
		return ((hex(substr(w, length(w) - 1 - d, 1)) >> (b % 4)) & 1) == 1;
	}

	// key -> { node, codes }, for the keys the device has
	function key_map(devs) {
		let bits = long_bits(), found = {};
		let has_all = (d, alt) => length(filter(type(alt) == 'array' ? alt : [ alt ], (c) => !has_bit(d.words, bits, c))) == 0;
		// the device with the most of the keys first
		for (let d in devs) {
			d.rank = 0;
			for (let k, alts in KEYS)
				for (let alt in alts)
					if (has_all(d, alt)) { d.rank++; break; }
		}
		devs = sort(devs, (a, b) => b.rank - a.rank);
		for (let k, alts in KEYS)
			for (let alt in alts) {
				for (let d in devs)
					if (has_all(d, alt)) { found[k] = { node: d.node, codes: type(alt) == 'array' ? alt : [ alt ] }; break; }
				if (found[k]) break;
			}
		return found;
	}

	// struct input_event: a timeval (two longs of userspace: the kernel fills
	// in the time), type, code (16 bits), value (32 bits), little-endian
	function timeval_size() {
		let arch = readfile('/etc/apk/arch') ?? readfile('/etc/openwrt_release');
		return (arch == null || match(arch, /aarch64|x86_64|mips64|riscv64/)) ? 16 : 8;
	}
	function event(tv, t, code, value) {
		let s = '';
		for (let i = 0; i < tv; i++) s += chr(0);
		return s + chr(t & 255, (t >> 8) & 255, code & 255, (code >> 8) & 255,
			value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
	}

	return {
		'GET /keys': function(req) {
			let devs = input_devices(), found = key_map(devs), keys = {};
			for (let k in KEYS) keys[k] = found[k] != null;
			return { keys: keys, devices: map(devs, (d) => `${d.name} (${replace(d.node, '/dev/input/', '')})`) };
		},
		'POST /key': function(req) {
			let k = req.body?.key, action = req.body?.action;
			if (type(k) != 'string' || KEYS[k] == null || !(action in [ 'down', 'up' ]))
				return { status: 400, type: 'application/json', body: '{"error":"bad key"}' };
			let km = key_map(input_devices())[k];
			if (!km)
				return { ok: false, error: '设备没有这个键 / no such key on the device' };
			let f = open(km.node, 'w');
			if (!f)
				return { ok: false, error: `cannot open ${km.node}` };
			// EV_KEY, then EV_SYN: the input core drops a press of a key that is
			// down and a release of one that is up, so a lost release is mended
			// by the next press
			let tv = timeval_size();
			let data = '';
			for (let c in km.codes) data += event(tv, 1, c, action == 'down' ? 1 : 0);
			f.write(data + event(tv, 0, 0, 0));
			f.close();
			return { ok: true };
		},
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
