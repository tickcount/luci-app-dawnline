# Builds luci-app-dawnline with the OpenWrt SDK.
#   docker build -f build/Dockerfile --build-arg SDK_IMAGE=itdoginfo/openwrt-sdk-ipk:24.10.6 .
# The web bundles (htdocs/.../app.js, portal assets) are built by npm first and
# committed; the SDK only packs files, so the package is the same on every arch.
ARG SDK_IMAGE=itdoginfo/openwrt-sdk-ipk:24.10.6
FROM ${SDK_IMAGE}

COPY package/luci-app-dawnline /builder/package/feeds/luci/luci-app-dawnline

# The SDK's default config builds every kernel module and every package in the
# feeds; turn that off and select only this package (it ships scripts and web
# files, so nothing else needs building) and its translations: luci.mk makes
# luci-i18n-dawnline-<lang> from po/<lang> when LuCI's language <lang> is selected.
RUN make defconfig && \
    sed -i -e 's/^CONFIG_ALL_KMODS=y/# CONFIG_ALL_KMODS is not set/' \
           -e 's/^CONFIG_ALL_NONSHARED=y/# CONFIG_ALL_NONSHARED is not set/' \
           -e 's/^CONFIG_ALL=y/# CONFIG_ALL is not set/' .config && \
    echo 'CONFIG_PACKAGE_luci-app-dawnline=m' >> .config && \
    for l in $(ls /builder/package/feeds/luci/luci-app-dawnline/po | grep -v '^templates$'); do \
        sed -i "/CONFIG_LUCI_LANG_$l[= ]/d" .config && echo "CONFIG_LUCI_LANG_$l=y" >> .config; done && \
    make defconfig && \
    make package/luci-app-dawnline/compile V=s -j4 && \
    mkdir -p /builder/out && \
    find /builder/bin/packages \( -name 'luci-app-dawnline*' -o -name 'luci-i18n-dawnline-*' \) \
        \( -name '*.ipk' -o -name '*.apk' \) -exec cp {} /builder/out/ \;
