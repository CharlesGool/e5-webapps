#!/usr/bin/env ucode
'use strict';

// e5-apps: the info screen's apps on the web (the webapps app).  The screen's
// server (127.0.0.1:8088: its pages, the apps and their backends, /api) stays
// on the device; this CGI, in LuCI's own web server, passes requests to it for
// whoever is logged in to LuCI with the info screen apps' access group
// (luci-app-e5-infoscreen, write) -- no one else:
//
//   /cgi-bin/e5-apps/<path>?<query>  ->  http://127.0.0.1:8088/<path>?<query>
//
// The LuCI session id comes once as ?sid=, which sets a cookie for this path
// (the app's page in a frame then asks with it); every request is checked
// with rpcd (session access).  The apps' pages name the screen's paths from
// its root (/sdk/e5.js, /api/plugins/<id>/...): their HTML gets those under
// this path and a small script that does the same for fetch, XMLHttpRequest
// and EventSource; the SDK finds its app's id under this path too.
//
// With the webapps app removed, this removes itself and its LuCI page.

import { stdin, stdout, readfile, writefile, unlink, stat } from 'fs';
import { connect } from 'ubus';

const BASE = '/cgi-bin/e5-apps';
const SELF = '/www/cgi-bin/e5-apps';
const UPSTREAM = 'http://127.0.0.1:8088';
const APP = '/etc/e5-infoscreen/plugins/webapps/manifest.json';
const MAX_BODY = 1048576;
const SHIM = '<script>(function(){var B="' + BASE + '";' +
	'function f(u){return (typeof u=="string"&&u.charAt(0)=="/"&&u.charAt(1)!="/"&&u.indexOf(B+"/")!=0)?B+u:u;}' +
	'var F=window.fetch;window.fetch=function(i,o){return F.call(this,f(i),o);};' +
	'var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=f(u);return X.apply(this,arguments);};' +
	'if(window.EventSource){var E=window.EventSource,N=function(u,c){return new E(f(u),c);};N.prototype=E.prototype;window.EventSource=N;}' +
	// what a script sets: a frame's, picture's, script's, style sheet's,
	// sound's address (the screen opens its apps in a frame so), an attribute
	// of that kind, and url("/...") in a style (the wallpapers)
	'function P(c,a){try{var d=Object.getOwnPropertyDescriptor(c.prototype,a);if(d&&d.set)Object.defineProperty(c.prototype,a,' +
	'{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,f(v));}});}catch(e){}}' +
	'P(HTMLIFrameElement,"src");P(HTMLImageElement,"src");P(HTMLScriptElement,"src");P(HTMLLinkElement,"href");P(HTMLMediaElement,"src");' +
	'var A=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){' +
	'if(n=="src"||n=="href"||n=="action")v=f(v);return A.call(this,n,v);};' +
	'var Q=[\'url("/\',\'url(/\'];function U(v){if(typeof v!="string"||v.indexOf("url(")<0)return v;' +
	'for(var k=0;k<Q.length;k++){var s=v.split(Q[k]);if(s.length<2)continue;v=s[0];' +
	'for(var i=1;i<s.length;i++)v+=(s[i].charAt(0)=="/"||s[i].indexOf(B.slice(1)+"/")==0)?Q[k]+s[i]:Q[k].slice(0,-1)+B+"/"+s[i];}return v;}' +
	'var S=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(n,v,p){return S.call(this,n,U(v),p);};' +
	'})();</script><style>html,body,*{cursor:auto!important}</style>';
// The screen's own page (/, the 信息屏 tab) in a browser is a second copy of
// the screen's interface, not the screen: what it would do to the device's
// screen, motor and keys (the backlight with its idle timer and lock, a key
// passed on, a vibration, the volume) is answered here and not sent; and for
// this copy only the lock screen and the idle timeout are off, touch is on,
// and the screen counts as lit (its /api/status, changed on the way in: the
// page follows screen.awake, the device's backlight, so it went dark with
// the device and, polled slowly while dark, stayed dark long after the
// device woke).  A click wakes it, should it be dark anyway.  Everything else -- reading,
// and what the page's own buttons do (the hotspot, SMS, ...) -- goes through
// as from the screen.
const VIEWER = '<script>(function(){var F=window.fetch;' +
	'var MUTE=["/api/backlight","/api/key","/api/vibrate","/api/volume"];' +
	'function j(o,s){return new Response(JSON.stringify(o),{status:s||200,headers:{"Content-Type":"application/json"}});}' +
	'window.fetch=function(i,o){var u=typeof i=="string"?i:((i&&i.url)||""),p=u.split("?")[0],' +
	'm=((o&&o.method)||"GET").toUpperCase();' +
	'if(m=="POST"&&MUTE.indexOf(p)>=0)return Promise.resolve(j(p=="/api/volume"?{available:false}:{ok:true}));' +
	'var r=F.apply(this,arguments);' +
	'if(m=="GET"&&p=="/api/status")r=r.then(function(res){if(!res.ok)return res;' +
	'return res.clone().json().then(function(d){if(d&&d.screen){d.screen.lock_enabled=false;d.screen.idle=0;d.screen.touch=true;d.screen.awake=true;}' +
	'return j(d,res.status);},function(){return res;});});' +
	'return r;};' +
	// (on the window, capturing, and before app.js: its own listener there
	// stops a click on a dark screen)
	'window.addEventListener("mousedown",function(){try{if(typeof blank!="undefined"&&blank&&typeof setBlank=="function")setBlank(false);}catch(e){}},true);' +
	'})();</script>';

function send(code, type, body, extra) {
	stdout.write(`Status: ${code}\r\nContent-Type: ${type}\r\nCache-Control: no-store\r\n` +
		`X-Content-Type-Options: nosniff\r\n${extra ?? ''}\r\n`);
	if (body != null)
		stdout.write(body);
}

// (returned from main(): no exit() inside the try below)
function fail(code, msg) {
	send(code, 'text/plain; charset=utf-8', msg + '\n');
	return null;
}

function main() {
	// the app removed: this and its LuCI page go too
	if (!stat(APP)) {
		system('rm -f /www/luci-static/resources/view/e5-webapps/index.js /www/luci-static/resources/view/e5-webapps/apps.js /www/luci-static/resources/view/e5-webapps/screen.js /usr/share/luci/menu.d/luci-app-e5-webapps.json; ' +
			'rmdir /www/luci-static/resources/view/e5-webapps 2>/dev/null; rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache; ' +
			`rm -f '${SELF}'`);
		return fail(404, '网页版应用已卸载 / the webapps app is not installed');
	}

	// the LuCI session: ?sid= once (a cookie for this path from then on), else the cookie
	let query = getenv('QUERY_STRING') ?? '', sid = null, cookie = '';
	let qs = match(query, /(^|&)sid=([0-9a-f]{32})(&|$)/);
	if (qs) {
		sid = qs[2];
		query = replace(query, /(^|&)sid=[0-9a-f]{32}/, '');
		query = replace(replace(query, /^&+/, ''), /&+$/, '');
		cookie = `Set-Cookie: e5apps=${sid}; Path=${BASE}; HttpOnly; SameSite=Strict\r\n`;
	}
	else {
		let c = match(getenv('HTTP_COOKIE') ?? '', /(^|;[ ]*)e5apps=([0-9a-f]{32})/);
		if (c) sid = c[2];
	}
	let allowed = false;
	if (sid) {
		let bus = connect();
		let r = bus ? bus.call('session', 'access', { ubus_rpc_session: sid, scope: 'access-group',
			object: 'luci-app-e5-infoscreen', function: 'write' }) : null;
		allowed = r?.access === true;
	}
	if (!allowed)
		return fail(403, '请先登录 LuCI（会话过期时刷新 LuCI 页面）/ log in to LuCI first');

	// what is passed on: GET and POST, a plain path and query (no quotes for the shell)
	let method = getenv('REQUEST_METHOD') ?? 'GET';
	if (method != 'GET' && method != 'POST')
		return fail(405, 'GET or POST only');
	let path = getenv('PATH_INFO') ?? '/';
	if (path == '') path = '/';
	if (!match(path, /^\/[A-Za-z0-9._~:@,+=\/-]*$/) || index(path, '..') >= 0)
		return fail(400, 'bad path');
	if (!match(query, /^[A-Za-z0-9._~:@,+=%&\/-]*$/))
		return fail(400, 'bad query');

	let tmp = '/tmp/e5-apps.' + trim(readfile('/proc/sys/kernel/random/uuid') ?? `${time()}`);
	let cmd = `curl -s -S --max-time 40 -H 'Expect:' -o '${tmp}.body' -D '${tmp}.head'`;
	if (method == 'POST') {
		let len = +(getenv('CONTENT_LENGTH') ?? '0');
		if (len > MAX_BODY) return fail(413, 'request too large');
		let body = '';
		while (length(body) < len) {
			let chunk = stdin.read(min(65536, len - length(body)));
			if (chunk == null || chunk == '') break;
			body += chunk;
		}
		writefile(`${tmp}.in`, body);
		let ctype = getenv('CONTENT_TYPE') ?? 'application/json';
		if (!match(ctype, /^[A-Za-z0-9\/+.;= _-]+$/)) ctype = 'application/octet-stream';
		cmd += ` -X POST -H 'Content-Type: ${ctype}' --data-binary @'${tmp}.in'`;
	}
	cmd += ` '${UPSTREAM}${path}${query != '' ? '?' + query : ''}' 2>/dev/null`;
	let rc = system(cmd);
	let head = readfile(`${tmp}.head`) ?? '', body = readfile(`${tmp}.body`) ?? '';
	unlink(`${tmp}.head`); unlink(`${tmp}.body`); unlink(`${tmp}.in`);
	if (rc != 0 || head == '')
		return fail(502, '信息屏服务没有响应 / the screen server did not answer');

	// the last response's status and type (curl -D keeps any interim one first)
	let code = 200, type = 'application/octet-stream';
	for (let line in split(head, /\r?\n/)) {
		let s = match(line, /^HTTP\/[0-9.]+ ([0-9]{3})/);
		if (s) { code = +s[1]; type = 'application/octet-stream'; }
		let t = match(line, /^[Cc]ontent-[Tt]ype:[ ]*(.+)$/);
		if (t) type = trim(t[1]);
	}

	// the screen's root paths under this one
	if (index(type, 'text/html') == 0) {
		body = replace(body, /(src|href|action)="\//g, (m, attr) => `${attr}="${BASE}/`);
		body = replace(body, `="${BASE}//`, '="//');
		let h = match(body, /<head[^>]*>/i);
		let shim = SHIM + ((path == '/' || path == '/index.html') ? VIEWER : '');
		body = h ? replace(body, h[0], h[0] + shim) : shim + body;
	}
	if (path == '/sdk/e5.js')
		body = replace(body, '/^\\/plugins\\/(', '/\\/plugins\\/(');

	send(code, type, body, cookie);
}

try {
	main();
}
catch (e) {
	send(500, 'text/plain; charset=utf-8', `e5-apps: ${e}\n`);
}
