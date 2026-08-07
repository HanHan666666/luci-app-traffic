# luci-app-traffic

**LuCI Traffic Dashboard for OpenWrt — WAN traffic statistics powered by vnstat**

A modern, dependency-light LuCI plugin that shows daily / monthly bandwidth usage of your WAN interface(s), a 30-day bar chart, today's hourly distribution, and live bandwidth rate. Data is sourced from `vnstat` (read-only), so it adds no extra storage writes and survives reboots.

![UI](https://img.shields.io/badge/UI-Chinese-blue) ![LuCI](https://img.shields.io/badge/LuCI-JS%20view-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- Usage cards: **Today / This month / Yesterday / Last month** (RX / TX / total)
- **30-day** daily usage bar chart (pure SVG, hover tooltips, no external JS/CDN)
- **Today's 24-hour** distribution chart
- **All-month history** usage list — every recorded month, one number each (RX+TX total)
- **Live bandwidth rate** (1-second sampling via `/proc/net/dev`)
- Interface selector (defaults to WAN `eth0`, switchable to any interface)
- Follows the active LuCI theme (light/dark via CSS variables)
- Chinese UI

## Architecture

Only **4 files**, all additive — nothing existing is overwritten:

| File | Install to | Purpose |
|---|---|---|
| `luci.traffic.ucode` | `/usr/share/rpcd/ucode/luci.traffic` | rpcd ucode backend: runs `vnstat --json`, converts KiB→bytes, reads `/proc/net/dev` counters |
| `overview.js` | `/www/luci-static/resources/view/traffic/overview.js` | LuCI JS view (the dashboard) |
| `luci-app-traffic.menu.json` | `/usr/share/luci/menu.d/luci-app-traffic.json` | Menu entry: *Status → Traffic Statistics* |
| `luci-app-traffic.acl.json` | `/usr/share/rpcd/acl.d/luci-app-traffic.json` | ACL: read-only access to the two ubus methods |

## Dependencies

- OpenWrt with a recent LuCI (JS views + `rpcd-mod-ucode`, e.g. 23.05 / 24.10 / QWRT)
- `vnstat` (1.x, e.g. 1.18) — the data source
- `vnstati` — **optional**, only needed by the legacy `luci-app-vnstat` UI, not by this plugin

## Installation (manual — no build system, no SDK)

### 1. Prepare vnstat (data layer)

```sh
opkg update
opkg install vnstat
```

Make sure the vnstat database lives on **persistent flash**, not the tmpfs `/var`:

```sh
# /var is a symlink to tmpfs on OpenWrt — data would be lost on reboot
sed -i 's|^DatabaseDir ".*"|DatabaseDir "/etc/vnstat"|' /etc/vnstat.conf
mkdir -p /etc/vnstat

/etc/init.d/vnstat enable
/etc/init.d/vnstat start
vnstat -u          # initial sample
vnstat -d          # sanity check — should show today's row
```

Ensure the WAN interface is monitored (usually `eth0` or `pppoe-wan`):

```sh
uci show vnstat
```

### 2. Install the plugin files

Copy the 4 files to the paths in the table above (e.g. `scp` or any method you prefer), then:

```sh
/etc/init.d/rpcd restart
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*
```

Refresh the LuCI web UI — you'll find **Status → Traffic Statistics**.

### 3. Verify

```sh
ubus call luci.traffic getTraffic    # JSON: interfaces → traffic → total/days/months/hours (bytes)
ubus call luci.traffic getCounters   # current RX/TX byte counters per interface
```

## Notes for AI maintainers / contributors

This section is written for AI agents who are asked to install, debug, or extend this plugin. Read it before touching anything.

### ucode backend gotchas

1. **File name has no `.ucode` extension.** rpcd-mod-ucode loads scripts from `/usr/share/rpcd/ucode/`; the ubus object name comes from the **top-level key of the returned table**, not from the file name:

   ```ucode
   const methods = { getTraffic: { call: function(request) { ... } } };
   return { "luci.traffic": methods };   // ← ubus object name
   ```

   Existing OpenWrt plugins (e.g. `luci.wol`, `luci.wireguard`) follow the same pattern. A file named `luci.traffic.ucode` (with extension) was observed **not** being loaded on a QWRT/21.02-based system.

2. **`var` is invalid** in ucode — use `let` / `const`.

3. **String methods are global functions**: `str.match(re)` does not exist; use `match(str, re)`. Likewise `indexOf` / `substring` are not string methods — avoid them (this backend simply hands the raw JSON to `json()`).

4. **vnstat 1.x `--json` units are KiB**, not bytes. The backend multiplies every `rx`/`tx` by 1024 so the frontend can treat everything as bytes. Do not "fix" this by removing the conversion — you'll make the numbers 1024× too small.

### Frontend notes

- Pure JS view (`'require view'`, `'require rpc'`), no external chart library — SVG is built with `document.createElementNS`.
- Styling is injected via a `<style>` element using LuCI theme CSS variables (`--panel-bg-color`, `--main-border-color`, `--accent-color`, …) with fallbacks, so it adapts to light/dark themes.
- `wanNames` array in `overview.js` controls the default selected interface — adjust if your WAN is not `eth0`.

### Known limitations

- **vnstat 1.x resets the day counter when the interface goes down/up** (e.g. WAN redial). For strict accounting, consider vnstat 2.x or a custom collector reading `/proc/net/dev` deltas.
- Data only goes back as far as vnstat has been recording; charts fill up as days accumulate.
- Older LuCI versions without JS view support are not compatible.

## Uninstall

```sh
rm -f /usr/share/rpcd/ucode/luci.traffic \
      /www/luci-static/resources/view/traffic/overview.js \
      /usr/share/luci/menu.d/luci-app-traffic.json \
      /usr/share/rpcd/acl.d/luci-app-traffic.json
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*
/etc/init.d/rpcd restart
```

## License

[MIT](LICENSE) © 2026 HanHan666666
