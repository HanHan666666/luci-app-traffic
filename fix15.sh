#!/bin/sh
mv /tmp/overview.js /www/luci-static/resources/view/traffic/overview.js
md5sum /www/luci-static/resources/view/traffic/overview.js
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*
curl -s -o /dev/null -w "overview.js: %{http_code}\n" "http://127.0.0.1/luci-static/resources/view/traffic/overview.js"
