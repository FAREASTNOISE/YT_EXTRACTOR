/* --- YT_EXTRACTOR CORE ENGINE v6.9.0 --- */

let player;
let currentVideoId = "";
let assetList = [];
let currentImgUrl = "";

// ページ読み込み時の初期化
window.onload = () => {
    loadHistory();
    const lastTab = localStorage.getItem('yt_last_tab') || 'thumb';
    switchTab(lastTab);

    // スライダーのスクロールとインジケーターの連動
    const mainSlider = document.getElementById('mainSlider');
    if (mainSlider) {
        mainSlider.addEventListener('scroll', () => updateDots('mainSlider', 'mainIndicator', 1));
    }

    // クリップボードからの貼り付け機能
    const pasteBtn = document.getElementById('pasteBtn');
    if (pasteBtn) {
        pasteBtn.onclick = async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    document.getElementById('videoUrl').value = text;
                    processInput();
                }
            } catch (err) {
                console.error("Clipboard access denied or failed.", err);
            }
        };
    }
};

// URL入力の解析
function processInput() {
    const urlInput = document.getElementById('videoUrl');
    const url = urlInput.value.trim();

    // 正規表現によるID抽出
    const playlistId = url.match(/[?&]list=([^#& ]+)/);
    const videoIdMatch = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]{11}).*/);

    if (playlistId) {
        fetchPlaylist(playlistId[1]);
        // プレイリストURLに動画IDも含まれている場合はその動画をロード
        if (videoIdMatch) {
            loadVideo(videoIdMatch[2], true);
        }
    } else if (videoIdMatch) {
        loadVideo(videoIdMatch[2], true);
        document.getElementById('playlistSection').classList.add('hidden');
    } else {
        alert("有効なYouTube URLを入力してください。");
    }
}

// 動画データのロードとアセット生成
async function loadVideo(id, shouldScroll) {
    if (!id || id === currentVideoId) return;
    currentVideoId = id;
    saveHistory(id);

    // 結果エリアの表示とプレイヤーのリセット
    document.getElementById('resultArea').classList.remove('hidden');
    resetPlayer();

    // YouTube IFrame Playerの初期化
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: id,
        events: {
            'onReady': () => updateEmbedOutputs()
        }
    });

    // 抽出アセットの候補（サムネイル、ストーリーボード）
    const candidates = [
        { label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
        { label: 'Standard', res: '640x480', url: `https://img.youtube.com/vi/${id}/sddefault.jpg`, isScene: false },
        { label: 'HQ Default', res: '480x360', url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, isScene: false },
        { label: 'Scene 1', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
        { label: 'Scene 2', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
        { label: 'Scene 3', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true }
    ];

    // 有効な画像のみをフィルタリング
    assetList = [];
    for (const c of candidates) {
        const isValid = await new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.width > 120); // 404のダミー画像（120px以下）を排除
            img.onerror = () => resolve(false);
            img.src = c.url;
        });
        if (isValid) assetList.push(c);
    }

    // スライダーの構築
    const slider = document.getElementById('mainSlider');
    slider.innerHTML = assetList.map(a => `
        <div class="slide-item-container">
            <img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}">
        </div>
    `).join('');

    slider.scrollTo(0, 0);
    updateDots('mainSlider', 'mainIndicator', 1);

    if (shouldScroll) {
        window.scrollTo({ top: document.getElementById('resultArea').offsetTop - 20, behavior: 'smooth' });
    }
}

// プレイリストメタデータの取得
async function fetchPlaylist(listId) {
    try {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/playlist?list=${listId}&format=json`);
        if (!response.ok) throw new Error();
        const data = await response.json();

        const section = document.getElementById('playlistSection');
        section.classList.remove('hidden');
        document.getElementById('playlistList').innerHTML = `
            <div class="p-8 bg-white/60 backdrop-blur-md rounded-[32px] w-full border border-black/5">
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Playlist Meta</p>
                <p class="text-lg font-bold uppercase leading-tight">${data.title}</p>
                <div class="mt-4 flex items-center gap-2">
                    <span class="px-2 py-1 bg-black text-white text-[8px] font-bold rounded">CHANNEL</span>
                    <p class="text-[10px] font-bold text-black uppercase">${data.author_name}</p>
                </div>
            </div>`;
    } catch (e) {
        console.error("Playlist fetching failed.");
    }
}

// ドット・インジケーターとメタ情報の更新
function updateDots(sId, iId, ratio) {
    const container = document.getElementById(sId);
    if (!container) return;

    const idx = Math.round(container.scrollLeft / (container.clientWidth / ratio));

    if (sId === 'mainSlider') {
        const indicator = document.getElementById(iId);
        indicator.innerHTML = assetList.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');

        if (assetList[idx]) {
            currentImgUrl = assetList[idx].url;
            document.getElementById('assetMeta').innerText = `${assetList[idx].label} // ${assetList[idx].res}`;
            updateThumbOutputs();
        }
    } else {
        // 履歴などのインジケーター
        const dotsCount = container.children.length;
        document.getElementById(iId).innerHTML = Array.from({ length: dotsCount }).map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
    }
}

// 画像系出力タグの生成
function updateThumbOutputs() {
    const container = document.getElementById('thumbOutputs');
    container.innerHTML = `
        <div class="nothing-card p-5 space-y-5">
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Markdown Link</label>
                <div class="flex gap-2">
                    <input type="text" value='[![](${currentImgUrl})](https://www.youtube.com/watch?v=${currentVideoId})' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copyRaw(this)" class="btn-gray-copy">Copy</button>
                </div>
            </div>
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Direct Image URL</label>
                <div class="flex gap-2">
                    <input type="text" value='${currentImgUrl}' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copyRaw(this)" class="btn-gray-copy">Copy</button>
                </div>
            </div>
        </div>`;
}

// 埋め込み系コードの生成
function updateEmbedOutputs() {
    const w = document.getElementById('eWidth').value;
    const h = document.getElementById('eHeight').value;
    const s = document.getElementById('eStart').value;

    const embedCode = `<iframe width="${w}" height="${h}" src="https://www.youtube.com/embed/${currentVideoId}?start=${s}" frameborder="0" allowfullscreen></iframe>`;
    const timeUrl = `https://youtu.be/${currentVideoId}?t=${s}`;

    document.getElementById('embedOutputAreas').innerHTML = `
        <div class="nothing-card p-5 space-y-5 border-dashed border-black/10">
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">IFrame Embed Code</label>
                <textarea id="outIframe" readonly class="nothing-input w-full p-3 text-[10px] font-mono h-20 focus:outline-none">${embedCode}</textarea>
                <button onclick="copy('outIframe')" class="btn-black-rect mt-3">Copy Embed Tag</button>
            </div>
            <div>
                <label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Time-stamped URL</label>
                <div class="flex gap-2">
                    <input type="text" id="outTimeUrl" value="${timeUrl}" readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                    <button onclick="copy('outTimeUrl')" class="btn-gray-copy">Copy</button>
                </div>
            </div>
        </div>`;
}

// 各種ユーティリティ
function syncTime() {
    if (player && typeof player.getCurrentTime === 'function') {
        document.getElementById('eStart').value = Math.floor(player.getCurrentTime());
        updateEmbedOutputs();
    }
}

function resizeEmbed(type) {
    const wInput = document.getElementById('eWidth');
    const hInput = document.getElementById('eHeight');
    if (document.getElementById('keepAspect').checked) {
        if (type === 'w') hInput.value = Math.round(wInput.value * (9 / 16));
        else wInput.value = Math.round(hInput.value * (16 / 9));
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

function resetPlayer() {
    document.getElementById('player-wrapper').innerHTML = '<div id="player"></div>';
}

function clearInput() {
    document.getElementById('videoUrl').value = "";
    document.getElementById('resultArea').classList.add('hidden');
    currentVideoId = "";
}

async function copyRaw(btn) {
    await navigator.clipboard.writeText(btn.previousElementSibling.value);
    const originalText = btn.innerText;
    btn.innerText = "DONE";
    setTimeout(() => btn.innerText = originalText, 1200);
}

async function copy(id) {
    const el = document.getElementById(id);
    await navigator.clipboard.writeText(el.value);
    alert("Copied to clipboard!");
}

// 履歴管理（LocalStorage）
function saveHistory(id) {
    let history = JSON.parse(localStorage.getItem('yt_history') || '[]');
    history = [id, ...history.filter(x => x !== id)].slice(0, 15);
    localStorage.setItem('yt_history', JSON.stringify(history));
    loadHistory();
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem('yt_history') || '[]');
    const list = document.getElementById('historyList');
    if (history.length === 0) return;

    document.getElementById('historySection').classList.remove('hidden');
    list.innerHTML = history.map(id => `
        <div class="item-card" onclick="loadVideo('${id}', true)">
            <img src="https://img.youtube.com/vi/${id}/mqdefault.jpg" class="w-full aspect-video object-cover rounded-xl shadow-sm">
        </div>
    `).join('');

    list.addEventListener('scroll', () => updateDots('historyList', 'historyIndicator', 2.6));
    updateDots('historyList', 'historyIndicator', 2.6);
}

function copyAllHistory() {
    const history = JSON.parse(localStorage.getItem('yt_history') || '[]');
    const urls = history.map(id => `https://youtu.be/${id}`).join('\n');
    navigator.clipboard.writeText(urls);
    alert("All history URLs copied!");
}

function moveSlide(id, direction) {
    const slider = document.getElementById(id);
    slider.scrollBy({ left: direction * slider.clientWidth, behavior: 'smooth' });
}

function share(platform) {
    const url = encodeURIComponent(`https://youtu.be/${currentVideoId}`);
    if (platform === 'x') window.open(`https://twitter.com/intent/tweet?url=${url}`, '_blank');
    if (platform === 'line') window.open(`https://line.me/R/msg/text/?${url}`, '_blank');
}