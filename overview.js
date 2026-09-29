'use strict';
'require view';
'require rpc';

var callGetTraffic = rpc.declare({
	object: 'luci.traffic',
	method: 'getTraffic',
	expect: {}
});

var callGetCounters = rpc.declare({
	object: 'luci.traffic',
	method: 'getCounters',
	expect: {}
});

/* ---------- 样式 (跟随 LuCI 主题变量, 深浅色自适应) ---------- */
/* 面板配色优先级: 本插件深色变量 (--traffic-*) → 主题变量 (--panel-bg-color 等) → 浅色兜底。
   部分第三方深色主题未定义 LuCI 面板变量, 会导致白色兜底与深色页面冲突;
   因此由 isDarkTheme() 检测深色主题并挂 traffic-dark 类, 提供一套深色面板配色。 */

var cssText = [
	'.traffic-page{padding:4px 0}',
	'.traffic-page.traffic-dark{--traffic-panel-bg:#1c1e24;--traffic-panel-border:#3a3f47;--traffic-bar-color:#3da8f5}',
	'.traffic-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px}',
	'.traffic-header h2{margin:0;font-size:20px}',
	'.traffic-iface-pick{display:flex;align-items:center;gap:8px;font-size:13px}',
	'.traffic-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}',
	'.traffic-card{background:var(--traffic-panel-bg,var(--panel-bg-color,#fff));border:1px solid var(--traffic-panel-border,var(--main-border-color,#d8d8d8));border-radius:10px;padding:14px 16px}',
	'.traffic-card .traffic-label{font-size:12px;opacity:.65}',
	'.traffic-card .traffic-value{font-size:26px;font-weight:700;margin-top:6px;line-height:1.2}',
	'.traffic-card .traffic-sub{font-size:12px;margin-top:6px;opacity:.75}',
	'.traffic-sep{margin:0 6px;opacity:.5}',
	'.traffic-panel{background:var(--traffic-panel-bg,var(--panel-bg-color,#fff));border:1px solid var(--traffic-panel-border,var(--main-border-color,#d8d8d8));border-radius:10px;padding:16px;margin-bottom:16px}',
	'.traffic-panel-title{font-size:14px;font-weight:600;margin-bottom:12px}',
	'.traffic-bar{fill:var(--traffic-bar-color,var(--accent-color,#0099ff));opacity:.45}',
	'.traffic-bar:hover{opacity:1}',
	'.traffic-bar-today{opacity:1}',
	'.traffic-live{font-size:18px;font-weight:700}',
	'.traffic-empty{opacity:.6;padding:12px 0}',
	'.traffic-note{font-size:12px;opacity:.55;margin-top:10px;text-align:center}',
	'.traffic-month-row{display:flex;justify-content:space-between;align-items:center;padding:9px 2px;border-bottom:1px solid var(--traffic-panel-border,var(--main-border-color,#e5e5e5))}',
	'.traffic-month-row:last-child{border-bottom:none}',
	'.traffic-month-name{font-size:13px;opacity:.8}',
	'.traffic-month-rxtx{display:flex;gap:14px;font-size:14px;font-weight:600}'
].join('\n');

/* ---------- 工具函数 ---------- */

function fmtBytes(n) {
	if (n == null || isNaN(n))
		return '-';

	if (n < 1024)
		return n + ' B';
	if (n < 1048576)
		return (n / 1024).toFixed(1) + ' KiB';
	if (n < 1073741824)
		return (n / 1048576).toFixed(2) + ' MiB';
	if (n < 1099511627776)
		return (n / 1073741824).toFixed(2) + ' GiB';
	return (n / 1099511627776).toFixed(2) + ' TiB';
}

function findIface(data, name) {
	if (!data || !data.interfaces)
		return null;

	for (var i = 0; i < data.interfaces.length; i++) {
		if (data.interfaces[i].id === name || data.interfaces[i].nick === name)
			return data.interfaces[i];
	}

	return null;
}

function dateKey(y, m, d) {
	return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/* 检测当前 LuCI 主题是否为深色: 读取 body 背景的感知亮度,
   背景为透明时退而求其次看文字颜色 (深色主题通常配浅色文字)。 */
function isDarkTheme() {
	function lum(color) {
		var m = String(color || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
		if (!m)
			return null;
		if (m[4] !== undefined && parseFloat(m[4]) === 0)
			return null; /* 透明色不算 */
		return 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
	}

	var s = getComputedStyle(document.body);
	var bg = lum(s.backgroundColor);
	if (bg !== null)
		return bg < 96;
	var fg = lum(s.color);
	if (fg !== null)
		return fg > 159;
	return false;
}

/* ---------- 卡片 ---------- */

function makeCard(label, rx, tx) {
	var card = E('div', { 'class': 'traffic-card' }, [
		E('div', { 'class': 'traffic-label' }, label),
		E('div', { 'class': 'traffic-value' }, fmtBytes(rx + tx)),
		E('div', { 'class': 'traffic-sub' }, [
			E('span', {}, '收 ' + fmtBytes(rx)),
			E('span', { 'class': 'traffic-sep' }, '·'),
			E('span', {}, '发 ' + fmtBytes(tx))
		])
	]);

	return card;
}

/* ---------- 30 天柱状图 (SVG) ---------- */

function renderBars(days) {
	var wrap = E('div', { 'class': 'traffic-chart' });
	if (!days || !days.length) {
		wrap.appendChild(E('div', { 'class': 'traffic-empty' }, '暂无数据'));
		return wrap;
	}

	var items = days.slice(-30);
	var max = 0;
	items.forEach(function(d) {
		var t = (d.rx || 0) + (d.tx || 0);
		if (t > max)
			max = t;
	});

	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 600 180');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.style.width = '100%';
	svg.style.height = '180px';

	var barW = 600 / items.length;
	var pad = 2;

	items.forEach(function(d, idx) {
		var t = (d.rx || 0) + (d.tx || 0);
		var h = max > 0 ? Math.max(2, (t / max) * 150) : 2;
		var x = idx * barW + pad;
		var w = barW - pad * 2;

		var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', x);
		rect.setAttribute('y', 170 - h);
		rect.setAttribute('width', w);
		rect.setAttribute('height', h);
		rect.setAttribute('class', 'traffic-bar');
		rect.setAttribute('rx', '1');

		var dk = dateKey(d.date.year, d.date.month, d.date.day);
		var today = new Date();
		var tk = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
		if (dk === tk)
			rect.setAttribute('class', 'traffic-bar traffic-bar-today');

		/* SVG title 子节点 (悬停提示) */
		var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
		title.textContent = dk + '  总 ' + fmtBytes(t) + '  (收 ' + fmtBytes(d.rx || 0) + ' / 发 ' + fmtBytes(d.tx || 0) + ')';
		rect.appendChild(title);

		svg.appendChild(rect);
	});

	wrap.appendChild(svg);

	/* 数据不足提示 */
	if (days.length < 30) {
		wrap.appendChild(E('div', { 'class': 'traffic-note' },
			'已有 ' + days.length + ' 天数据，随时间积累自动补全为 30 天'));
	}

	return wrap;
}

/* ---------- 今日 24 小时柱状图 ---------- */

function renderHours(hours) {
	var wrap = E('div', { 'class': 'traffic-chart' });
	if (!hours || !hours.length) {
		wrap.appendChild(E('div', { 'class': 'traffic-empty' }, '暂无小时数据'));
		return wrap;
	}

	/* 只保留今天的记录 */
	var now = new Date();
	var tk = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

	var items = hours.filter(function(h) {
		return h.date && dateKey(h.date.year, h.date.month, h.date.day) === tk;
	});

	if (!items.length) {
		wrap.appendChild(E('div', { 'class': 'traffic-empty' }, '今天暂无小时数据'));
		return wrap;
	}

	items.sort(function(a, b) { return a.id - b.id; });

	var max = 0;
	items.forEach(function(h) {
		var t = (h.rx || 0) + (h.tx || 0);
		if (t > max)
			max = t;
	});

	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 720 150');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.style.width = '100%';
	svg.style.height = '150px';

	var slotW = 720 / 24;

	items.forEach(function(h) {
		var t = (h.rx || 0) + (h.tx || 0);
		var hgt = max > 0 ? Math.max(2, (t / max) * 120) : 2;
		var x = h.id * slotW + 1;
		var w = slotW - 2;

		var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', x);
		rect.setAttribute('y', 140 - hgt);
		rect.setAttribute('width', w);
		rect.setAttribute('height', hgt);
		rect.setAttribute('class', 'traffic-bar');

		var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
		title.textContent = h.id + ':00  总 ' + fmtBytes(t) +
			'  (收 ' + fmtBytes(h.rx || 0) + ' / 发 ' + fmtBytes(h.tx || 0) + ')';
		rect.appendChild(title);

		svg.appendChild(rect);
	});

	wrap.appendChild(svg);
	return wrap;
}

/* ---------- 历史月份用量列表 ---------- */

function renderMonths(months) {
	var wrap = E('div', { 'class': 'traffic-months' });
	if (!months || !months.length) {
		wrap.appendChild(E('div', { 'class': 'traffic-empty' }, '暂无月份数据'));
		return wrap;
	}

	/* 倒序: 最新月份在前 */
	var items = months.slice().reverse();

	items.forEach(function(m) {
		var row = E('div', { 'class': 'traffic-month-row' }, [
			E('span', { 'class': 'traffic-month-name' },
				m.date.year + ' 年 ' + m.date.month + ' 月'),
			E('span', { 'class': 'traffic-month-rxtx' }, [
				E('span', { 'class': 'traffic-month-rx' }, '收 ' + fmtBytes(m.rx || 0)),
				E('span', { 'class': 'traffic-month-tx' }, '发 ' + fmtBytes(m.tx || 0))
			])
		]);
		wrap.appendChild(row);
	});

	return wrap;
}

/* ---------- 主视图 ---------- */

return L.view.extend({
	render: function() {
		var self = this;

		return Promise.all([
			callGetTraffic(),
			callGetCounters()
		]).then(function(res) {
			var data = res[0] || {};
			var counters = res[1] || {};

			if (data.error) {
				return E('div', { 'class': 'alert-message warning' },
					'vnstat 数据不可用: ' + data.error);
			}

			var ifaces = (data.interfaces || []).map(function(i) { return i.id; });
			if (!ifaces.length)
				ifaces = Object.keys(counters);

			/* 默认选中 WAN 口 (eth0/pppoe/wan), 否则第一个 */
			var wanNames = ['eth0', 'pppoe-wan', 'wan'];
			var sel = wanNames.filter(function(n) { return ifaces.indexOf(n) >= 0; })[0] || ifaces[0] || 'eth0';

			/* 头部 + 接口选择 */
			var selOpts = ifaces.map(function(n) {
				var tag = (n === 'eth0') ? ' (WAN)' : '';
				return E('option', { value: n }, n + tag);
			});

			var ifaceSel = E('select', { 'class': 'cbi-input-select', 'id': 'traffic-iface' }, selOpts);
			ifaceSel.value = sel;

			var header = E('div', { 'class': 'traffic-header' }, [
				E('h2', {}, '流量统计'),
				E('div', { 'class': 'traffic-iface-pick' }, [
					E('span', { 'class': 'traffic-label' }, '接口'),
					ifaceSel
				])
			]);

			/* 卡片容器 */
			var cards = E('div', { 'class': 'traffic-cards' });

			/* 图表容器 */
			var chartWrap = E('div', { 'class': 'traffic-panel' }, [
				E('div', { 'class': 'traffic-panel-title' }, '近 30 天用量'),
				E('div', { 'class': 'traffic-chart-wrap', 'id': 'traffic-chart' })
			]);

			/* 今日小时图容器 */
			var hourWrap = E('div', { 'class': 'traffic-panel' }, [
				E('div', { 'class': 'traffic-panel-title' }, '今日 24 小时分布'),
				E('div', { 'class': 'traffic-chart-wrap', 'id': 'traffic-hours' })
			]);

			/* 历史月份用量容器 */
			var monthsWrap = E('div', { 'class': 'traffic-panel' }, [
				E('div', { 'class': 'traffic-panel-title' }, '历史月份用量'),
				E('div', { 'class': 'traffic-chart-wrap', 'id': 'traffic-months' })
			]);

			/* 实时速率 */
			var live = E('div', { 'class': 'traffic-panel' }, [
				E('div', { 'class': 'traffic-panel-title' }, '实时速率'),
				E('div', { 'class': 'traffic-live', 'id': 'traffic-live' }, '计算中…')
			]);

			var view = E('div', { 'class': 'traffic-page' }, [ header, cards, chartWrap, hourWrap, monthsWrap, live ]);
			if (isDarkTheme())
				view.classList.add('traffic-dark');

			/* 注入样式 */
			var style = document.createElement('style');
			style.textContent = cssText;
			view.appendChild(style);

			/* ---------- 渲染逻辑 ---------- */

			function renderIface(name) {
				var ifd = findIface(data, name);
				cards.innerHTML = '';

				if (!ifd || !ifd.traffic) {
					cards.appendChild(E('div', { 'class': 'traffic-empty' },
						'接口 ' + name + ' 暂无数据（vnstat 尚未记账）'));
					chartWrap.querySelector('#traffic-chart').innerHTML = '';
					return;
				}

				var t = ifd.traffic;
				var days = t.days || [];
				var months = t.months || [];

				/* vnstat 1.x --json 的 days/months 是"新数据在前"的降序 (2.x 为升序),
				   统一按日期升序排序, 保证数组末尾恒为最新周期。
				   卡片取值、30 天柱状图、历史月列表共用这两个数组, 在此一并归一。 */
				days.sort(function(a, b) {
					return dateKey(a.date.year, a.date.month, a.date.day) <
						dateKey(b.date.year, b.date.month, b.date.day) ? -1 : 1;
				});
				months.sort(function(a, b) {
					return dateKey(a.date.year, a.date.month, 1) <
						dateKey(b.date.year, b.date.month, 1) ? -1 : 1;
				});

				var today = days.length ? days[days.length - 1] : null;
				var yesterday = days.length > 1 ? days[days.length - 2] : null;
				var month = months.length ? months[months.length - 1] : null;
				var lastMonth = months.length > 1 ? months[months.length - 2] : null;

				cards.appendChild(makeCard('今日', today ? today.rx : 0, today ? today.tx : 0));
				cards.appendChild(makeCard('本月', month ? month.rx : 0, month ? month.tx : 0));
				cards.appendChild(makeCard('昨日', yesterday ? yesterday.rx : 0, yesterday ? yesterday.tx : 0));
				cards.appendChild(makeCard('上月', lastMonth ? lastMonth.rx : 0, lastMonth ? lastMonth.tx : 0));

				var chartBox = chartWrap.querySelector('#traffic-chart');
				chartBox.innerHTML = '';
				chartBox.appendChild(renderBars(days));

				var hourBox = hourWrap.querySelector('#traffic-hours');
				hourBox.innerHTML = '';
				hourBox.appendChild(renderHours(t.hours || []));

				var monthsBox = monthsWrap.querySelector('#traffic-months');
				monthsBox.innerHTML = '';
				monthsBox.appendChild(renderMonths(t.months || []));
			}

			ifaceSel.addEventListener('change', function() {
				renderIface(ifaceSel.value);
			});

			renderIface(sel);

			/* ---------- 实时速率定时器 ---------- */

			var ifaceSel2 = ifaceSel;
			var liveBox = live.querySelector('#traffic-live');
			var liveTimer = null;

			function sampleLive2() {
				callGetCounters().then(function(c1) {
					setTimeout(function() {
						callGetCounters().then(function(c2) {
							var iface = ifaceSel2.value;
							if (c1[iface] && c2[iface]) {
								var rx = Math.max(0, c2[iface].rx - c1[iface].rx);
								var tx = Math.max(0, c2[iface].tx - c1[iface].tx);
								liveBox.textContent =
									'收 ' + fmtBytes(rx) + '/s   ·   发 ' + fmtBytes(tx) + '/s';
							} else {
								liveBox.textContent = '接口 ' + iface + ' 无计数器';
							}
						}).catch(function() {
							liveBox.textContent = '读取失败';
						});
					}, 1000);
				}).catch(function() {
					liveBox.textContent = '读取失败';
				});
			}

			sampleLive2();
			liveTimer = setInterval(sampleLive2, 3000);

			/* 页面卸载时清理定时器 */
			self.cleanup = function() {
				if (liveTimer)
					clearInterval(liveTimer);
			};

			return view;
		});
	},

	cleanup: function() {}
});
