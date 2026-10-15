# SPDX-License-Identifier: MIT
#
# Dawnline — AmneziaWG access server for OpenWrt with a LuCI admin UI and a
# personal self-service portal.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-dawnline
PKG_VERSION:=0.3.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

LUCI_TITLE:=Dawnline - AmneziaWG access server
# AmneziaWG itself (kmod-amneziawg, amneziawg-tools, luci-proto-amneziawg) is not
# in the OpenWrt feeds: install.sh and the Updates page install a build made for
# the router's firmware. The portal's HTTPS needs any libustream TLS module and
# openssl-util; Settings offers to install them when the portal is turned on.
# Runtime dependencies only (control file Depends): the package ships scripts
# and web files, so the SDK has nothing to build for them, and as build
# dependencies ip-full (iproute2) and kmod-veth would pull in the whole kernel.
# OpenWrt 25.12's luci.mk wants a version on each; (>=0) means any.
LUCI_EXTRA_DEPENDS:=luci-base (>=0), rpcd-mod-ucode (>=0), ucode (>=0), ucode-mod-fs (>=0), ucode-mod-uci (>=0), \
	ucode-mod-ubus (>=0), ucode-mod-uloop (>=0), ip-full (>=0), kmod-veth (>=0), uhttpd (>=0)
LUCI_PKGARCH:=all
# The web bundles are already minified by esbuild (LuCI's jsmin cannot parse modern JS).
LUCI_MINIFY_JS:=0
LUCI_MINIFY_CSS:=0

PKG_MAINTAINER:=tickcount
LUCI_MAINTAINER:=tickcount
LUCI_URL:=https://github.com/tickcount/luci-app-dawnline

define Package/luci-app-dawnline/conffiles
/etc/config/dawnline
endef

define Package/luci-app-dawnline/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
# An upgrade keeps everything running; only a removal tears down.
[ "$$1" = "upgrade" ] && exit 0
/etc/init.d/dawnline stop 2>/dev/null
/usr/bin/dawnline teardown 2>/dev/null
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
