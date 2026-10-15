# 网页版应用 · Apps on the Web

在电脑浏览器（LuCI）里使用信息屏应用

*Use the screen's apps in a browser (LuCI)*

容悦 E5（OpenWrt）信息屏应用。当前版本 **v1.4**，应用 ID `webapps`。

## 安装

1. 下载 [`releases/webapps-v1.4.tar.gz`](releases/webapps-v1.4.tar.gz)。
2. 在信息屏的「应用管理」中安装（LuCI：服务 → 信息屏应用 → 应用管理）。
3. 安装后文件位于设备上的 `/etc/e5-infoscreen/plugins/webapps/`。

## 源码

`webapps/` 是当前版本安装包解压后的内容：

- [`backend.uc`](webapps/backend.uc)
- [`e5-apps.cgi`](webapps/e5-apps.cgi)
- [`index.html`](webapps/index.html)
- [`luci/apps.js`](webapps/luci/apps.js)
- [`luci/menu.json`](webapps/luci/menu.json)
- [`luci/screen.js`](webapps/luci/screen.js)
- [`manifest.json`](webapps/manifest.json)

## 版本

- [v1.4](releases/webapps-v1.4.tar.gz)（当前）
- [v1.3](releases/webapps-v1.3.tar.gz)
- [v1.2](releases/webapps-v1.2.tar.gz)
- [v1.1](releases/webapps-v1.1.tar.gz)
- [v1.0](releases/webapps-v1.0.tar.gz)
