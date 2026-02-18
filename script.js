/* --- YT_EXTRACTOR CORE ENGINE v6.9.1 --- */

let player;
let currentVideoId = "";
let assetList = [];
let currentImgUrl = "";

window.onload = () => {
    loadHistory();
    const lastTab = localStorage.getItem('yt_last_tab') || 'thumb';
    switchTab(lastTab);

    const mainSlider = document.getElementById('mainSlider');
    if (mainSlider) {
        mainSlider.addEventListener('scroll', () => updateDots('mainSlider', 'mainIndicator', 1));
    }

    const pasteBtn = document.getElementById('pasteBtn');
    if (pasteBtn) {
        pasteBtn.onclick = async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    document.getElementById('videoUrl').value = text;
                    processInput();
                }
            } catch (err) { console.error("Clipboard error"); }
        };
    }
};

function processInput() {
    const url = document.getElementById('videoUrl').value.trim();
    const playlistId = url.match(/[?&]list=([^#& ]+)/);
    const videoIdMatch = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]{11}).*/);

    if (playlistId) {
        fetchPlaylist(playlistId[1]);
        if (videoIdMatch) loadVideo(videoIdMatch[2], true);
    } else if (videoIdMatch) {
        loadVideo(videoIdMatch[2], true);
        document.getElementById('playlistSection').classList.add('hidden');
    }
}

async function loadVideo(id, shouldScroll) {
    if (!id || id === currentVideoId) return;
    currentVideoId = id;
    saveHistory(id);

    document.getElementById('resultArea').classList.remove('hidden');
    resetPlayer();

    player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: id,
        events: { 'onReady': () => updateEmbedOutputs() }
    });

    const candidates = [
        { label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
        { label: 'Standard', res: '640x480', url: `https://img.youtube.com/vi/${id}/sddefault.jpg`, isScene: false },
        { label: 'HQ Default', res: '480x360', url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, isScene: false },
        { label: 'Scene 1', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
        { label: 'Scene 2', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
        { label: 'Scene 3', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true }
    ];

    assetList = [];
    for (const c of candidates) {
        const isValid = await new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.width > 120);
            img.onerror = () => resolve(false);
            img.src = c.url;
        });
        if (isValid) assetList.push(c);
    }

    const slider = document.getElementById('mainSlider');
    slider.innerHTML = assetList.map(a => `
        <div class="slide-item-container">
            <img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}">
        </div>
    `).join('');

    slider.scrollTo(0, 0);
    updateDots('mainSlider', 'mainIndicator', 1);
    if (shouldScroll) window.scrollTo({ top: document.getElementById('resultArea').offsetTop - 20, behavior: 'smooth' });
}
// プレイリストメタデータの取得
async function fetchPlaylist(listId) {
    try {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/playlist?list=${listId}&format=json`);
        const data = await response.json();
        const section = document.getElementById('playlistSection');
        section.classList.remove('hidden');
        document.getElementById('playlistList').innerHTML = `
            <div class="p-8 bg-white/60 backdrop-blur-md rounded-[32px] w-full border border-black/5">
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Playlist Meta</p>
                <p class="text-lg font-bold uppercase leading-tight">${data.title}</p>
                <p class="text-[10px] mt-4 font-bold text-black uppercase">Author: ${data.author_name}</p>
            </div>`;
    } catch (e) { console.error("Playlist error"); }
}

// ドット・インジケーターとメタ情報の更新
function updateDots(sId, iId, ratio) {
    const container = document.getElementById(sId);
    if (!container) return;
    const idx = Math.round(container.scrollLeft / (container.clientWidth / ratio));

    if (sId === 'mainSlider') {
        document.getElementById(iId).innerHTML = assetList.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
        if (assetList[idx]) {
            currentImgUrl = assetList[idx].url;
            document.getElementById('assetMeta').innerText = `${assetList[idx].label} // ${assetList[idx].res}`;
            updateThumbOutputs();
        }
    } else {
        const dotsCount = container.children.length;
        document.getElementById(iId).innerHTML = Array.from({ length: dotsCount }).map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
    }
}

// 画像系出力タグの生成（ボタン統一版）
function updateThumbOutputs() {
    const container = document.getElementById('thumbOutputs');
    container.innerHTML = `
        <div class="nothing-card p-5 space-y-5">
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">HTML Image Tag (IMG)</label>
                <div class="flex gap-2">
                    <input type="text" value='<a href="https://www.youtube.com/watch?v=${currentVideoId}" target="_blank"><img src="${currentImgUrl}" alt="Thumbnail"></a>' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copyRaw(this)" class="btn-gray-copy">Copy</button>
                </div>
            </div>
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Markdown Link</label>
                <div class="flex gap-2">
                    <input type="text" value='[![](${currentImgUrl})](https://www.youtube.com/watch?v=${currentVideoId})' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copyRaw(this)" class="btn-gray-copy">Copy</button>
                </div>
            </div>
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Direct Asset URL</label>
                <div class="flex gap-2">
                    <input type="text" value='${currentImgUrl}' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copyRaw(this)" class="btn-gray-copy">Copy</button>
                </div>
            </div>
        </div>`;
}

// 埋め込み系出力の生成
function updateEmbedOutputs() {
    const w = document.getElementById('eWidth').value;
    const h = document.getElementById('eHeight').value;
    const s = document.getElementById('eStart').value;
    const embedCode = `<iframe width="${w}" height="${h}" src="https://www.youtube.com/embed/${currentVideoId}?start=${s}" frameborder="0" allowfullscreen></iframe>`;
    const timeUrl = `https://youtu.be/${currentVideoId}?t=${s}`;

    document.getElementById('embedOutputAreas').innerHTML = `
        <div class="nothing-card p-5 space-y-4">
            <label class="text-[9px] text-gray-400 block uppercase font-bold tracking-wider">IFrame Embed Code</label>
            <div class="flex flex-col gap-2">
                <textarea id="outIframe" readonly class="nothing-input w-full p-3 text-[10px] font-mono h-20 focus:outline-none">${embedCode}</textarea>
                <div class="flex justify-end"><button onclick="copy('outIframe')" class="btn-gray-copy">Copy Tag</button></div>
            </div>
        </div>
        <div class="nothing-card p-5 space-y-4">
            <label class="text-[9px] text-gray-400 block uppercase font-bold tracking-wider">Time-stamped Short URL (YOUTU.BE)</label>
            <div class="flex gap-2">
                <input type="text" id="outTimeUrl" value="${timeUrl}" readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                <button onclick="copy('outTimeUrl')" class="btn-gray-copy">Copy</button>
            </div>
        </div>`;
}

function syncTime() {
    if (player && player.getCurrentTime) {
        document.getElementById('eStart').value = Math.floor(player.getCurrentTime());
        updateEmbedOutputs();
    }
}

function resizeEmbed(type) {
    const w = document.getElementById('eWidth'), h = document.getElementById('eHeight');
    if (document.getElementById('keepAspect').checked) {
        if (type === 'w') h.value = Math.round(w.value * (9 / 16));
        else w.value = Math.round(h.value * (16 / 9));
    }
    updateEmbedOutputs();
}

function switchTab(t) {
    document.getElementById('tabThumb').classList.toggle('tab-active', t === 'thumb');
    document.getElementById('tabEmbed').classList.toggle('tab-active', t === 'embed');
    document.getElementById('contentThumb').classList.toggle('hidden', t !== 'thumb');
    document.getElementById('contentEmbed').classList.toggle('hidden', t !== 'embed');
    localStorage.setItem('yt_last_tab', t);
}

function resetPlayer() { document.getElementById('player-wrapper').innerHTML = '<div id="player"></div>'; }
function clearInput() { document.getElementById('videoUrl').value = ""; document.getElementById('resultArea').classList.add('hidden'); currentVideoId = ""; }

async function copyRaw(btn) {
    await navigator.clipboard.writeText(btn.previousElementSibling.value || btn.parentElement.previousElementSibling.value);
    const original = btn.innerText; btn.innerText = "DONE";
    setTimeout(() => btn.innerText = original, 1200);
}

async function copy(id) {
    await navigator.clipboard.writeText(document.getElementById(id).value);
    const btn = event.currentTarget; const original = btn.innerText; btn.innerText = "COPIED";
    setTimeout(() => btn.innerText = original, 1200);
}

function saveHistory(id) {
    let h = JSON.parse(localStorage.getItem('yt_history') || '[]');
    h = [id, ...h.filter(x => x !== id)].slice(0, 15);
    localStorage.setItem('yt_history', JSON.stringify(h));
    loadHistory();
}

// 履歴の読み込みとドットの初期化
function loadHistory() {
    const h = JSON.parse(localStorage.getItem('yt_history') || '[]');
    const list = document.getElementById('historyList');
    if (h.length === 0) return;

    document.getElementById('historySection').classList.remove('hidden');
    list.innerHTML = h.map(id => `
        <div class="item-card" onclick="loadVideo('${id}', true)">
            <img src="https://img.youtube.com/vi/${id}/mqdefault.jpg" class="w-full aspect-video object-cover rounded-xl shadow-sm">
        </div>`).join('');

    // 履歴スライダーのスクロールを監視してドットを更新
    list.removeEventListener('scroll', historyScrollHandler); // 重複防止
    list.addEventListener('scroll', historyScrollHandler);

    // 初回実行
    updateDots('historyList', 'historyIndicator', 2.6);
}

// 履歴用スクロールイベントのハンドラ
function historyScrollHandler() {
    updateDots('historyList', 'historyIndicator', 2.6);
}

// ドット・インジケーター更新（計算ロジック修正）
function updateDots(sId, iId, ratio) {
    const container = document.getElementById(sId);
    const indicator = document.getElementById(iId);
    if (!container || !indicator) return;

    // 現在のインデックスを計算
    const itemWidth = container.clientWidth / ratio;
    const idx = Math.round(container.scrollLeft / itemWidth);

    if (sId === 'mainSlider') {
        indicator.innerHTML = assetList.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
        if (assetList[idx]) {
            currentImgUrl = assetList[idx].url;
            document.getElementById('assetMeta').innerText = `${assetList[idx].label} // ${assetList[idx].res}`;
            updateThumbOutputs();
        }
    } else {
        // 履歴など
        const count = container.children.length;
        indicator.innerHTML = Array.from({ length: count }).map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
    }
}

function copyAllHistory() {
    const h = JSON.parse(localStorage.getItem('yt_history') || '[]');
    navigator.clipboard.writeText(h.map(id => `https://youtu.be/${id}`).join('\n'));
}

function moveSlide(id, d) { const s = document.getElementById(id); s.scrollBy({ left: d * s.clientWidth, behavior: 'smooth' }); }

function share(platform) {
    const url = encodeURIComponent(`https://youtu.be/${currentVideoId}`);
    if (platform === 'x') window.open(`https://twitter.com/intent/tweet?url=${url}`, '_blank');
    else if (platform === 'threads') window.open(`https://www.threads.net/intent/post?text=${url}`, '_blank');
    else if (platform === 'facebook') window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
    else if (platform === 'line') window.open(`https://line.me/R/msg/text/?${url}`, '_blank');
}