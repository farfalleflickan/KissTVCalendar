let calendarYear = (new Date()).getFullYear();
let calendarMonth = (new Date()).getMonth();
let searchTimeout;
let lastSearchResults = [];
const searchElem = document.getElementById('search');
const resultsElem = document.getElementById('results');
const clearBtn = document.getElementById('clearSearchBtn');
const calendarElem = document.getElementById('calendar');
const monthLabel = document.getElementById('monthLabel');

function showToast(msg, timeout = 2500) {
    let existing = document.getElementById('toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 500);
    }, timeout);
}

function getSubscriptions() {
    return JSON.parse(localStorage.getItem('ktc_subShows') || '[]');
}

function saveSubscription(show) {
    const subs = getSubscriptions();
    if (!subs.find(f => f.id === show.id)) {
        subs.push(show);
        localStorage.setItem('ktc_subShows', JSON.stringify(subs));
        renderCalendar();
    }
}

function removeSubscription(showId) {
    let subs = getSubscriptions();
    const currShow = subs.filter(f => f.id === showId)[0];

    if (confirm(`Are you sure you want to remove ${currShow.name}?`) === true) {
        subs = subs.filter(f => f.id !== showId);
        localStorage.setItem('ktc_subShows', JSON.stringify(subs));
        renderCalendar();
    }
}

function getEpisodesCache() {
    return JSON.parse(localStorage.getItem('ktc_episodesCache') || '{}');
}

function setEpisodesCache(cache) {
    localStorage.setItem('ktc_episodesCache', JSON.stringify(cache));
}

function makeEpCacheKey(showId, year, month) {
    return `${showId}-${year}-${month}`;
}

function getWatchedEpisodes() {
    return JSON.parse(localStorage.getItem('ktc_watchedEpisodes') || '[]');
}

function setWatchedEpisodes(watchedArr) {
    localStorage.setItem('ktc_watchedEpisodes', JSON.stringify(watchedArr));
}

function toggleEpisodeWatched(epKey, checked) {
    let watched = getWatchedEpisodes();
    if (checked) {
        if (!watched.includes(epKey)) watched.push(epKey);
    } else {
        watched = watched.filter(k => k !== epKey);
    }
    setWatchedEpisodes(watched);
}

function setTheme(light, updateStorage = true) {
    document.documentElement.classList.toggle('light', light);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) themeIcon.textContent = light ? '☀️' : '🌙';
    if (updateStorage) {
        localStorage.setItem('ktc_theme', light ? 'light' : 'dark');
    }
}

function getTheme() {
    return localStorage.getItem('ktc_theme') === 'light';
}

function icalEscape(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function foldLine(line) {
    const maxBytes = 75; //RFC 5545 3.1 Content Lines BS, max 75 bytes
    const encoder = new TextEncoder();
    let folded = '';
    let pos = 0;
    let firstLine = true;

    while (pos < line.length) {
        let availableBytes = maxBytes;
        let prefix = '';
        if (!firstLine) {
            prefix = '\r\n ';
            availableBytes -= 1;
        }

        let chunk = '';
        let chunkBytes = 0;

        for (let i = pos; i < line.length; i++) {
            const nextChunk = line.slice(pos, i + 1);
            const nextBytes = encoder.encode(nextChunk).length;
            if (nextBytes > availableBytes) break;
            chunk = nextChunk;
            chunkBytes = nextBytes;
        }

        folded += prefix + chunk;
        pos += chunk.length;
        firstLine = false;
    }

    return folded;
}

function getICalDateTimeString(date = new Date()) {
  const pad = n => n.toString().padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + 'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) + 'Z'
  );
}

function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function exportIcal(exportFull = false) {
    const subs = getSubscriptions();
    if (!subs.length) {
        showToast('No subscriptions to export!');
        return;
    }

    const cache = getEpisodesCache();
    let events = [];

    for (const show of subs) {
        const cached = cache[show.id];
        if (!cached || !Array.isArray(cached.episodes)) continue;

        for (const ep of cached.episodes) {
            if (!ep.airdate) continue;
            if (exportFull === false && new Date(ep.airdate) < new Date()) continue; //skip non-upcoming

            const [y, m, d] = ep.airdate.split('-');
            if (!y || !m || !d) continue;

            let DTSTART = '';
            let DTEND = '';
            let timeKnown = false;

            if (ep.airstamp && ep.runtime && Number.isFinite(ep.runtime)) {
                const airingTime = new Date(ep.airstamp);
                DTSTART = getICalDateTimeString(airingTime)
                DTEND = getICalDateTimeString(new Date(airingTime.getTime() + (ep.runtime * 60 * 1000)));

                timeKnown = true;
            } else { // Unknown so make all day
                DTSTART = `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
                const dt = new Date(Number(y), Number(m) - 1, Number(d));
                dt.setDate(dt.getDate() + 1);
                DTEND = dt.getFullYear().toString() +
                    (dt.getMonth() + 1).toString().padStart(2, '0') +
                    dt.getDate().toString().padStart(2, '0');
            }

            const epTitle = ep.name ? ep.name : '';
            const showTitle = show.name || '';

            const summary = `${showTitle}${ep.season && ep.number ? ` S${ep.season}E${ep.number}` : ''}: ${epTitle}`;
            const url = ep.url ? ep.url : '';
            const desc = ep.summary ? stripHtml(ep.summary) + '\n\n' + url : url;
            const uid = `show${show.id}-ep${ep.id}@KissTVCalendar`;

            const eventLines = [
                'BEGIN:VEVENT',
                `UID:${icalEscape(uid)}`,
                `DTSTAMP:${getICalDateTimeString()}`,
                `SUMMARY:${icalEscape(summary)}`,
                timeKnown ? `DTSTART:${DTSTART}` : `DTSTART;VALUE=DATE:${DTSTART}`,
                timeKnown ? `DTEND:${DTEND}` : `DTEND;VALUE=DATE:${DTEND}`,
                desc ? `DESCRIPTION:${icalEscape(desc)}` : '',
                url ? `URL:${icalEscape(url)}` : '',
                'END:VEVENT'
            ].filter(Boolean); // filter empty lines

            events.push(...eventLines);
        }
    }

    if (!events.length) {
        showToast('No airing episodes to export!');
        return;
    }

    const icalLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//KissTVCalendar//EN',
        ...events,
        'END:VCALENDAR'
    ];

    const ical = icalLines.map(foldLine).join('\r\n');

    const blob = new Blob([ical], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFull ? 'ktc_full.ics' : 'ktc.ics';
    a.click();
    URL.revokeObjectURL(url);

    showToast('iCal file exported!');
}

function exportData() {
    const subs = getSubscriptions();
    if (!subs.length) {
        showToast('No shows to export!');
        return;
    }

    const data = {
        subShows: subs,
        watchedEpisodes: getWatchedEpisodes(),
        theme: localStorage.getItem('ktc_theme') || 'dark'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "calendar.json";
    a.click();
    URL.revokeObjectURL(url);

    showToast('Data exported successfully!');
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.subShows) localStorage.setItem('ktc_subShows', JSON.stringify(data.subShows));
            if (data.watchedEpisodes) localStorage.setItem('ktc_watchedEpisodes', JSON.stringify(data.watchedEpisodes));
            if (data.theme) localStorage.setItem('ktc_theme', data.theme);
            renderCalendar();
            setTheme(data.theme === 'light');
            showToast('Data imported successfully!');
        } catch (err) {
            showToast('Import failed: invalid file.');
        }
    };
    reader.readAsText(file);
}

function clearStorage() {
    if (confirm('Are you sure you want to clear all subscriptions, watched, and theme?')) {
        localStorage.removeItem('ktc_episodesCache');
        localStorage.removeItem('ktc_subShows');
        localStorage.removeItem('ktc_watchedEpisodes');
        localStorage.removeItem('ktc_theme');
        renderCalendar();
        setTheme(false);
        showToast('All data cleared!');
    }
}

function bookmarkSite() {
    const subs = getSubscriptions();
    const ids = subs.map(f => f.id.toString(36)).join(".");
    const params = new URLSearchParams();

    if (ids) params.set('subs', ids);

    if (localStorage.getItem('ktc_theme') === 'light') {
        params.set('theme', 'light');
    }

    /*
    const watchedArr = getWatchedEpisodes();
    if (watchedArr.length) {
        params.set('watched', watchedArr.join(','));
    }
    */

    const newUrl = window.location.origin + window.location.pathname + '?' + params.toString();
    prompt("Copy this URL to bookmark or share your calendar:", newUrl);
}

function closeSettingsDropdown(e) {
    const menu = document.querySelector('.settings-menu');
    if (!menu.contains(e.target)) {
        menu.classList.remove('open');
        document.removeEventListener('mousedown', closeSettingsDropdown);
    }
}

function showSearchResults(shows) {
    lastSearchResults = shows;
    resultsElem.innerHTML = shows.slice(0, 5).map(item => `
        <div>
          <a class="show-title search-result" href="${item.show.url}" target="_blank" rel="noopener noreferrer">${item.show.name}</a>
          <button class="remove-btn search-result-btn" onclick='addSubById(${item.show.id})'>Add</button>
        </div>`).join('');
}

function getMonthName(m) {
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m];
}

function setMonth(year, month) {
    calendarYear = year;
    calendarMonth = month;
    renderCalendar();
}

function getMonthDays(year, month) {
    const days = [];
    const firstDate = new Date(year, month, 1);
    let firstDay = firstDate.getDay();
    firstDay = firstDay === 0 ? 7 : firstDay;

    for (let i = 1; i < firstDay; i++) { //pad days
        days.push(null);
    }

    let date = new Date(year, month, 1);
    while (date.getMonth() === month) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return days;
}

async function clearEpisodesCache() {
    localStorage.removeItem('ktc_episodesCache');
    showToast('Episode cache cleared! Updating…');
    await forceUpdateEpisodesCache();
}

async function forceUpdateEpisodesCache() {
    const subs = getSubscriptions();
    const cache = getEpisodesCache();
    showToast('Force updating episode data...');

    await Promise.all(subs.map(async show => {
        let res = await fetch(`https://api.tvmaze.com/shows/${show.id}/episodes`);
        let episodes = await res.json();
        cache[show.id] = {
            timestamp: Date.now(),
            episodes
        };
    }));
    setEpisodesCache(cache);
    renderCalendar();
    showToast('Episodes updated!');
}

async function getAiringForShow(showId, year, month) {
    let cache = getEpisodesCache();
    let cachedData = cache[showId];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    function filterEpisodes(episodes) {
        return episodes.filter(ep => {
            if (!ep.airdate) return false;
            const [y, m, d] = ep.airdate.split('-').map(Number);
            return y === year && (m - 1) === month;
        });
    }

    if (cachedData && (now - cachedData.timestamp < oneDay)) {
        return filterEpisodes(cachedData.episodes);
    }

    const res = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`);
    const episodes = await res.json();
    cache = getEpisodesCache();
    cache[showId] = {
        timestamp: Date.now(),
        episodes
    };
    setEpisodesCache(cache);

    return filterEpisodes(episodes);
}

async function renderCalendar() {
    document.getElementById('calendarSpinner').style.display = 'flex';
    calendarElem.innerHTML = '';
    monthLabel.textContent = `${getMonthName(calendarMonth)} ${calendarYear}`;
    const now = new Date();
    const year = calendarYear;
    const month = calendarMonth;
    const days = getMonthDays(year, month);
    const subs = getSubscriptions();
    const dayShows = {};

    await Promise.all(subs.map(async show => {
        const episodes = await getAiringForShow(show.id, year, month);
        episodes.forEach(ep => {
            const d = ep.airdate;
            if (!dayShows[d]) dayShows[d] = [];
            dayShows[d].push({ show, ep });
        });
    }));

    const watchedArr = getWatchedEpisodes();
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    weekdays.forEach(d => {
        calendarElem.innerHTML += `<div class="weekday-label">${d}</div>`;
    });

    const MAX_VISIBLE = 2;
    let dayGrid = [];

    days.forEach(date => {
        if (!date) {
            dayGrid.push(`<div class="day"></div>`);
        } else {
            const dayStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
            const todayCls = (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) ? 'today' : '';
            let showsHtml = '';

            if (dayShows[dayStr]) {
                const allEpisodes = dayShows[dayStr];
                const visibleEpisodes = allEpisodes.slice(0, MAX_VISIBLE);

                showsHtml = '<div class="shows">' + visibleEpisodes.map(item => {
                    const epKey = item.show.id + '-' + item.ep.id;
                    const checked = watchedArr.includes(epKey);
                    return `<div class="show-tag ${checked ? 'watched' : ''}" data-epkey="${epKey}">
                                <input type="checkbox" class="watch-checkbox" ${checked ? 'checked' : ''} title="Mark as watched"/>
                                <span>
                                    <a href="${item.ep.url}" target="_blank" rel="noopener noreferrer" class="ep-link" title="Open episode page">
                                        <span class="show-title">${item.show.name}</span>
                                        ${item.ep.season && item.ep.number ? ` S${item.ep.season}E${item.ep.number}:` : ''} ${item.ep.name}
                                    </a>
                                </span>
                                <button class="remove-btn" title="Remove from Calendar" onclick="removeSubscription(${item.show.id})">&times;</button>
                            </div>`;
                }).join('');

                if (allEpisodes.length > MAX_VISIBLE) {
                    showsHtml += `<button class="expand-btn" data-day="${dayStr}">
                        +${allEpisodes.length - MAX_VISIBLE} more
                    </button>`;
                }

                showsHtml += '</div>';
            }

            dayGrid.push(`
                <div class="day ${todayCls}">
                  <strong>${date.getDate()}</strong>
                  ${showsHtml}
                </div>
            `);
        }
    });

    while ((dayGrid.length + 7) % 7 !== 0) dayGrid.push('<div class="day"></div>');
    calendarElem.innerHTML += dayGrid.join('');
    document.getElementById('calendarSpinner').style.display = 'none';

    // Attach expand button listeners
    document.querySelectorAll('.expand-btn').forEach(btn => {
        const day = btn.dataset.day;
        btn.addEventListener('click', () => {
            const episodesForDay = dayShows[day] || [];
            openEpisodesModal(episodesForDay);
        });
    });
}

function openEpisodesModal(episodes) {
    const modal = document.getElementById('episodesModal');
    const modalEpisodes = document.getElementById('episodesModalDiv');
    modalEpisodes.innerHTML = '';

    episodes.forEach(item => {
        const epKey = item.show.id + '-' + item.ep.id;
        const checked = getWatchedEpisodes().includes(epKey);
        modalEpisodes.innerHTML += `
            <div class="show-tag ${checked ? 'watched' : ''}" data-epkey="${epKey}">
                <input type="checkbox" class="watch-checkbox" ${checked ? 'checked' : ''} title="Mark as watched"/>
                <span>
                    <a href="${item.ep.url}" target="_blank" rel="noopener noreferrer" class="ep-link" title="Open episode page">
                        <span class="show-title">${item.show.name}</span>
                        ${item.ep.season && item.ep.number ? ` S${item.ep.season}E${item.ep.number}:` : ''} ${item.ep.name}
                    </a>
                </span>
                <button class="remove-btn" title="Remove from Calendar" onclick="removeSubscription(${item.show.id})">&times;</button>
            </div>
        `;
    });

    modal.style.display = 'block';
}

window.onclick = (event) => {
    if (event.target === document.getElementById('episodesModal')) {
        document.getElementById('episodesModal').style.display = 'none';
    }
};

searchElem.addEventListener('input', function (e) {
    const q = e.target.value;
    clearBtn.style.display = q.length ? 'block' : 'none';

    document.getElementById('searchSpinner').style.display = q ? 'block' : 'none';

    clearTimeout(searchTimeout);
    if (!q) {
        resultsElem.innerHTML = '';
        document.getElementById('searchSpinner').style.display = 'none';
        return;
    }
    searchTimeout = setTimeout(async () => {
        const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        showSearchResults(data);
        document.getElementById('searchSpinner').style.display = 'none';
    }, 600);
});

clearBtn.addEventListener('click', () => {
    searchElem.value = '';
    resultsElem.innerHTML = '';
    clearBtn.style.display = 'none';
    searchElem.focus();
});

window.addSubById = (showId) => {
    const found = lastSearchResults.find(s => s.show.id === showId);
    if (found) {
        saveSubscription({
            id: found.show.id,
            name: found.show.name,
            premiered: found.show.premiered,
        });
        resultsElem.innerHTML = '';
        searchElem.value = '';
    }
}

document.addEventListener('change', function(e) {
    if (e.target.matches('.show-tag input.watch-checkbox')) {
        const tag = e.target.closest('.show-tag');
        const epkey = tag.getAttribute('data-epkey');
        toggleEpisodeWatched(epkey, e.target.checked);
        const elements = document.querySelectorAll(`[data-epkey="${epkey}"]`);
        elements.forEach(el => {
            if (e.target.checked) { 
                el.classList.add('watched');
            } else {
                el.classList.remove('watched');
            }
        });
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);

    if (params.has('subs')) {
        const ids = params.get('subs').split('.').map(id => parseInt(id, 36));
        if (ids.length && !isNaN(ids[0])) {

            Promise.all(ids.map(id =>
                fetch(`https://api.tvmaze.com/shows/${id}`).then(res => res.json())
            )).then(shows => {
                localStorage.setItem('ktc_subShows', JSON.stringify(
                    shows.map(s => ({ id: s.id, name: s.name, premiered: s.premiered }))
                ));
                renderCalendar();
            });
        }
    }

    if (params.has('watched')) {
        const watchedArr = params.get('watched').split(',');
        localStorage.setItem('ktc_watchedEpisodes', JSON.stringify(watchedArr));
    }

    if (params.has('theme')) {
        localStorage.setItem('ktc_theme', params.get('theme'));
    }

    const menu = document.querySelector('.settings-menu');
    document.getElementById('settingsBtn').onclick = (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
        if (menu.classList.contains('open')) {
            document.addEventListener('mousedown', closeSettingsDropdown);
        }
    };

    document.getElementById('themeToggle').onclick = function (e) {
        e.preventDefault();
        setTheme(!document.documentElement.classList.contains('light'));
    };

    document.getElementById('exportCalBtn').onclick = function (e) {
        e.preventDefault();
        exportIcal(false);
        menu.classList.remove('open');
    };

    document.getElementById('exportFullCalBtn').onclick = function (e) {
        e.preventDefault();
        exportIcal(true);
        menu.classList.remove('open');
    };

    document.getElementById('exportBtn').onclick = function (e) {
        e.preventDefault();
        exportData();
        menu.classList.remove('open');
    };

    document.getElementById('importBtn').onclick = function (e) {
        e.preventDefault();
        document.getElementById('importFileInput').click();
        menu.classList.remove('open');
    };

    document.getElementById('importFileInput').onchange = function () {
        if (this.files.length) importData(this.files[0]);
        this.value = '';
    };

    document.getElementById('clearCacheBtn').onclick = function (e) {
        e.preventDefault();
        clearEpisodesCache();
        menu.classList.remove('open');
    };

    document.getElementById('clearStorageBtn').onclick = function (e) {
        e.preventDefault();
        clearStorage();
        menu.classList.remove('open');
    };

    document.getElementById('bookmarkBtn').onclick = function (e) {
        e.preventDefault();
        bookmarkSite();
        menu.classList.remove('open');
    };

    document.getElementById('prevMonth').onclick = () => {
        if (calendarMonth === 0) setMonth(calendarYear - 1, 11);
        else setMonth(calendarYear, calendarMonth - 1);
    };

    document.getElementById('nextMonth').onclick = () => {
        if (calendarMonth === 11) setMonth(calendarYear + 1, 0);
        else setMonth(calendarYear, calendarMonth + 1);
    };

    window.removeSubscription = removeSubscription;
    setTheme(getTheme(), false);
    renderCalendar();
});