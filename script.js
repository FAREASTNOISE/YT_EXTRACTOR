/**
 * @fileoverview YouTube Asset Extractor
 * YouTubeのURLから情報を抽出するツール。
 *
 * @author FEN
 * @version 1.1.0
 */


/* ───────────────────────────────────────────
	 CORE ENGINE v6.9.1
─────────────────────────────────────────── */

/** @type {any} YouTube Playerのインスタンス（YouTube IFrame API用） */
let player;

/** @type {string} 現在表示・処理している動画のID */
let currentVideoId = "";

/** @type {Object[]} 抽出されたアセット（画像URLやサイズ等）を格納する配列 */
let assetList = [];

/** @type {string} 現在プレビュー表示している画像のURL */
// let currentImgUrl = "";
let currentImgUrl = "";

/** @type {string} 画像ラベル（例: "Max Res", "Standard", "Scene" 等） */
let currentImgLabel = "Thumbnail"; // 値は空か "Thumbnail"

/** @type {string} 現在表示している動画のタイトル */
let currentVideoTitle = "";

/**
 * ページ読み込み完了時の初期化処理
 * 履歴の読み込み、最終タブの復元、イベントリスナーの設定を行う
 */
window.onload = () => {
	// 1. データの復元
	loadHistory();

	/** @type {string} 前回使用していたタブの名前（デフォルトは 'thumb'） */
	const lastTab = localStorage.getItem('yt_last_tab') || 'thumb';

	// 「次の描画タイミング」まで一瞬待ってから実行
	requestAnimationFrame(() => {
		switchTab(lastTab);
	});


	// 2. スクロール監視（Nothing OS風のドットインジケーター連動）
	const mainSlider = document.getElementById('mainSlider');
	if (mainSlider) {
		mainSlider.addEventListener('scroll', () => updateDots('mainSlider', 'mainIndicator', 1));
	}

	// 3. 貼り付けボタンの非同期処理設定
	const pasteBtn = document.getElementById('pasteBtn');
	if (pasteBtn) {
		/**
         * クリップボードからテキストを読み取り、入力を処理する
         */
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





/**
 * YouTubeのURLを解析し、動画IDとShorts判定を抽出する。
 * * @param {string} url - 解析対象のYouTube URL（shorts, v=形式, youtu.be形式に対応）
 * @returns {{videoId: string, isShorts: boolean}} 解析結果オブジェクト
 * @returns {string} .videoId - 抽出された11桁の動画ID（見つからない場合は空文字）
 * @returns {boolean} .isShorts - 動画がShorts形式（/shorts/）であるかどうかのフラグ
 */
function analyzeYouTubeUrl(url) {
    let videoId = '';
    let isShorts = false;

    // URLが空、または文字列でない場合は早期リターン
    if (!url || typeof url !== 'string') return { videoId, isShorts };

    if (url.includes('/shorts/')) {
        // Shorts形式: https://www.youtube.com/shorts/VIDEO_ID
        videoId = url.split('/shorts/')[1].split(/[?&]/)[0];
        isShorts = true;
    } else if (url.includes('v=')) {
        // 標準形式: https://www.youtube.com/watch?v=VIDEO_ID
        videoId = url.split('v=')[1].split(/[?&]/)[0];
    } else if (url.includes('youtu.be/')) {
        // 短縮形式: https://youtu.be/VIDEO_ID
        videoId = url.split('youtu.be/')[1].split(/[?&]/)[0];
    }

    return { videoId, isShorts };
}

/**
 * ユーザー入力されたURLから動画IDを解析し、UIの更新処理を実行する。
 * * 対応形式: 標準URL, Shorts, 埋め込み, プレイリスト。
 * 解析後のIDをグローバル変数 currentVideoId に格納し、表示を同期させます。
 * * @returns {void}
 */
function processInput() {
	// const inputEl = document.getElementById('videoUrl');
	// /** @type {string} */
	// const url = inputEl.value.trim();

    const url = document.getElementById('videoUrl').value;
    const { videoId, isShorts } = analyzeYouTubeUrl(url);

	if (!url) return;

	// 正規表現の実行結果を明示的に定義
	/** @type {RegExpMatchArray|null} */
	const playlistMatch = url.match(/[?&]list=([^#& ]+)/);
	/** @type {RegExpMatchArray|null} */
	const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|u\/\w\/|shorts\/))([^#\&\?]{11})/);

	const playlistId = playlistMatch ? playlistMatch[1] : null;
	const videoId = videoMatch ? videoMatch[1] : null;

	if (playlistId && playlistId.length > 5) {
		fetchPlaylist(playlistId);
		if (videoId) loadVideo(videoId, true);
	} else if (videoId) {
		loadVideo(videoId, true);
		const plSection = document.getElementById('playlistSection');
		if (plSection) plSection.classList.add('hidden');
	}
}


/**
 * 指定された動画IDのデータを取得し、UI（スライダーやメタ情報）を更新する
 * @param {string} id - YouTubeの11桁の動画ID
 * @param {boolean} [shouldScroll=false] - 更新後にスライダーを左端へスクロールさせるか
 * @returns {Promise<void>} 非同期処理の完了を待機
 */
async function loadVideo(id, shouldScroll = false) {
	if (!id || id === currentVideoId) return;
	currentVideoId = id;
	saveHistory(id);

	document.getElementById('resultArea').classList.remove('hidden');
	resetPlayer();



	// --- 動画タイトル取得 (APIキー不要のoEmbedを使用) ---
	try {
		const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
		if (!response.ok) throw new Error("メタデータの取得に失敗");

		const data = await response.json();
		currentVideoTitle = data.title; // シェア用に変数へ保存

		// 画面上にタイトル表示要素があれば更新
		const titleEl = document.getElementById('vTitle');
		if (titleEl) titleEl.innerText = currentVideoTitle;

	} catch (error) {
		console.warn("タイトルの取得に失敗:", error);
		currentVideoTitle = "YouTube Video"; // 失敗時の予備
	}


	// --- プレイヤーの初期化 ---
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: id,
        playerVars: {
            'rel': 0,          // 関連動画を自分のチャンネルのみに
            'playsinline': 1   // モバイルで全画面表示にさせない
        },
        events: {
            'onReady': () => updateEmbedOutputs()
        }
    });

	const candidates = [

		// メイン画像（高画質狙い）
		{ label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
		{ label: 'Ultra HQ', res: '720p', url: `https://img.youtube.com/vi/${id}/hq720.jpg`, isScene: false },
		{ label: 'Standard', res: '640x480', url: `https://img.youtube.com/vi/${id}/sddefault.jpg`, isScene: false },

		{ label: 'Animated 1', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/1.webp`, isScene: true },
		{ label: 'Animated 2', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/2.webp`, isScene: true },
		{ label: 'Animated 3', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/3.webp`, isScene: true },


		// preview.webp が一番「動く」確率が高いお宝URLだよ
		{ label: 'Motion', res: 'WebP', url: `https://www.google.com/url?sa=E&source=gmail&q=i9.ytimg.com`, isScene: true },
		{ label: 'Scene WebP', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/default.webp`, isScene: true },

		// 高画質なシーン画像（16:9 狙い）
		{ label: 'High Scene 1', res: 'HQ', url: `https://img.youtube.com/vi/${id}/hq1.jpg`, isScene: true },
		{ label: 'High Scene 2', res: 'HQ', url: `https://img.youtube.com/vi/${id}/hq2.jpg`, isScene: true },
		{ label: 'High Scene 3', res: 'HQ', url: `https://img.youtube.com/vi/${id}/hq3.jpg`, isScene: true },

		// 中画質なシーン画像
		{ label: 'Wide Scene 1', res: 'MQ', url: `https://img.youtube.com/vi/${id}/mq1.jpg`, isScene: true },
		{ label: 'Wide Scene 2', res: 'MQ', url: `https://img.youtube.com/vi/${id}/mq2.jpg`, isScene: true },
		{ label: 'Wide Scene 3', res: 'MQ', url: `https://img.youtube.com/vi/${id}/mq3.jpg`, isScene: true },

		// 予備・レア枠
		{ label: 'Alt Thumb', res: '0.jpg', url: `https://img.youtube.com/vi/${id}/0.jpg`, isScene: true },
		{ label: 'Legacy 1', res: '1.jpg', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },

		// { label: 'Scene 1', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
		// { label: 'Scene 2', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
		// { label: 'Scene 3', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true },

		// { label: 'Start', res: 'Small', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
		// { label: 'Middle', res: 'Small', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
		// { label: 'End', res: 'Small', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true },
	];


	// --- 画像の存在チェック ---
    assetList = [];
    for (const c of candidates) {
        try {
            const isValid = await new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(img.width > 120); // YouTubeの404画像は幅が狭いため除外
                img.onerror = () => resolve(false);
                img.src = c.url;
                setTimeout(() => resolve(false), 3000); // 3秒でタイムアウト
            });
            if (isValid) assetList.push(c);
        } catch (e) {
            continue;
        }
    }

	// --- スライダーの表示更新 ---
    const slider = document.getElementById('mainSlider');
    slider.innerHTML = assetList.map(a => `
        <div class="slide-item-container ${a.isScene ? 'is-scene' : 'is-main'}">
            <img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}" loading="lazy">
        </div>
    `).join('');

    slider.scrollTo(0, 0);
    updateDots('mainSlider', 'mainIndicator', 1);

    // --- 結果エリアへスクロール ---
    if (shouldScroll) {
        window.scrollTo({
            top: document.getElementById('resultArea').offsetTop - 20,
            behavior: 'smooth'
        });
    }
}














/**
 * プレイリストの中身を履歴風のカードで表示する
 */
async function fetchPlaylist(listId) {
    const section = document.getElementById('playlistSection');
    const list = document.getElementById('playlistList');
    const indicator = document.getElementById('playlistIndicator');

    if (!section || !list) return;

    section.classList.remove('hidden');
    // 親要素に relative をつけて、ボタンを左右に固定する準備
    section.className = "mt-12 border-t border-black/10 pt-8 relative group";

    list.innerHTML = `<p class="text-[10px] animate-pulse p-4 font-bold tracking-widest">SYNCHRONIZING...</p>`;

    try {
        // const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${listId}&key=${YOUTUBE_API_KEY}`;
		const url = `api/get_playlist.php?id=${listId}`;
        const response = await fetch(url);

		// if (!response.ok) throw new Error(`HTTP_ERROR: ${response.status}`);

		if (!response.ok) {
		if (response.status === 404) {
			throw new Error("PLAYLIST_NOT_FOUND (IDを確認してください)");
		} else {
			throw new Error(`SERVER_ERROR: ${response.status}`);
		}
	}

        const data = await response.json();

        if (data.items) {
            // 1. カードの生成
			list.innerHTML = data.items.map(item => {
				const vId = item.snippet.resourceId?.videoId;
				if (!vId) return '';

				// タイトルを安全に取得（もしあれば）
				const title = item.snippet.title || 'NO_TITLE';

				return `
					<div class="item-card flex-shrink-0 w-[180px] snap-start cursor-pointer group/item active:scale-95 transition-transform"
						onclick="loadVideo('${vId}', true)">
						<div class="relative overflow-hidden rounded-2xl bg-black/[0.03] border border-black/[0.05]">
							<img src="https://img.youtube.com/vi/${vId}/mqdefault.jpg"
								class="w-full aspect-video object-cover transition-all duration-500 group-hover/item:scale-110"
								loading="lazy">
							<div class="absolute inset-0 bg-black/0 group-hover/item:bg-black/5 transition-colors"></div>
						</div>
						<p class="text-[10px] mt-3 font-medium text-black/60 line-clamp-2 uppercase tracking-[0.1em] leading-relaxed">
							${title}
						</p>
					</div>
				`;
			}).join('');

            // 2. ボタンの生成（Historyと全く同じ構造）
            // 二重に作られないように一度消してから追加
 // 2. ボタンの生成（Historyと完全に一致、矢印の色をblackへ）
            section.querySelectorAll('.nav-btn').forEach(btn => btn.remove());

            const prevBtn = `
                <div class="nav-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                     style="left:-10px; top:45%; position:absolute; z-index:50;"
                     onclick="moveSlide('playlistList', -1)">
                    <div class="arrow !w-1.5 !h-1.5"
                         style="transform:rotate(-135deg); border-top:2px solid black; border-right:2px solid black;"></div>
                </div>`;

            const nextBtn = `
                <div class="nav-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                     style="right:-10px; top:45%; position:absolute; z-index:50;"
                     onclick="moveSlide('playlistList', 1)">
                    <div class="arrow !w-1.5 !h-1.5"
                         style="transform:rotate(45deg); border-top:2px solid black; border-right:2px solid black;"></div>
                </div>`;

            section.insertAdjacentHTML('beforeend', prevBtn);
            section.insertAdjacentHTML('beforeend', nextBtn);

            // 3. ドットの連動
            list.onscroll = () => updateDots('playlistList', 'playlistIndicator', 1);
            updateDots('playlistList', 'playlistIndicator', 1);
        }
    } catch (e) {
		console.error("Playlist render error:", e);
        list.innerHTML = `<p class="text-[10px] p-4 text-red-500 font-bold">\>_ CONNECTION_FAILED: ${e.message}</p>`;
    }
}

/**
 * 実際にカードとドットを描画する共通関数
 */
function renderPlaylistCards(items) {
    const listContainer = document.getElementById('playlistList');
    const indicator = document.getElementById('playlistIndicator');

    listContainer.innerHTML = items.map(item => `
        <div class="item-card flex-shrink-0 w-[160px]" onclick="loadVideo('${item.id}', true)">
            <img src="https://img.youtube.com/vi/${item.id}/mqdefault.jpg" class="rounded-xl">
            <p class="text-[9px] mt-2 font-bold text-black/40 uppercase">${item.title}</p>
        </div>
    `).join('');

    // ドットの更新
    updateDots('playlistList', 'playlistIndicator', 1);
}








/* ───────────────────────────────────────────
      OUTPUT TAGS AND LINKS GENERATOR
─────────────────────────────────────────── */
/**
 * コピーボタン付きの入力行（HTML文字列）を生成する
 * Asset Embed 共用
 * @param {string} label - 表示するラベルテキスト（例: 'HTML Image Tag'）
 * @param {string} value - input要素にセットするコピー対象の文字列
 * @returns {string} 構築されたHTMLテンプレート
 */
function createOutputRow(label, value) {
    // valueが空やundefinedの場合に備えてデフォルト値を設定
    const displayValue = value || '';
    return `
        <div class="space-y-1.5">
            <label class="pl-[12px] text-[9px] text-gray-400 block uppercase font-bold tracking-wider">${label}</label>
            <div class="flex gap-2">
                <input type="text" value='${displayValue}'
					onclick="this.select()"
					readonly
                    class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
                <button onclick="handleCopy(this)" class="btn-gray-copy w-[70px] transition-all text-[10px] font-bold uppercase">Copy</button>
            </div>
        </div>
    `;
}


/**
 * ボタンクリック時にテキストをコピーし、フィードバックを表示する
 * @param {HTMLButtonElement} btn - クリックされたボタン要素
 */
async function handleCopy(btn) {
    const input = btn.previousElementSibling;
    if (!input || !input.value) return;

    try {
        // 最新のクリップボードAPIを使用
        await navigator.clipboard.writeText(input.value);

        const originalText = "COPY";
        btn.innerText = "COPIED";
        btn.style.width = "70px"; // 文字数変化でガタつかないよう固定

        setTimeout(() => {
            btn.innerText = originalText;
        }, 1500);
    } catch (err) {
        // フォールバック: 従来の方法
        input.select();
        document.execCommand('copy');
        btn.innerText = "COPIED";
        setTimeout(() => { btn.innerText = "COPY"; }, 1500);
    }
}


/**
 * Assetsタブ内の全出力エリアを更新する
 * @param {string} url - 画像URL
 * @param {string} label - alt属性用のラベル（Max Res, Motionなど）
 */
function updateThumbOutputs(url, label) {
    const container = document.getElementById('thumbOutputs');
    if (!container) return;

    // 最新の値を取得（引数がなければ現在の変数を参照）
    const targetUrl = url || currentImgUrl;
    const targetLabel = label || currentImgLabel || "Thumbnail";

    container.innerHTML = `
        <div class="nothing-card p-5 space-y-6">
            ${createOutputRow(
                'HTML Image Tag (img)',
                `<img src="${targetUrl}" alt="${targetLabel}">`
            )}

            ${createOutputRow(
                'HTML Image Tag (a + img)',
                `<a href="https://www.youtube.com/watch?v=${currentVideoId}" target="_blank"><img src="${targetUrl}" alt="${targetLabel}"></a>`
            )}

            ${createOutputRow(
                'Markdown Link',
                `[![](${targetUrl})](${targetLabel})`
            )}

            ${createOutputRow(
                'Direct Asset URL',
                targetUrl
            )}
        </div>
    `;
}




// EMBED ここから↓




/**
 * 埋め込み設定を反映し、出力エリアを更新する。
 * @returns {void}
 */
function updateEmbedOutputs() {
    // // デバッグログ
    // console.log("Checking currentVideoId:", typeof currentVideoId !== 'undefined' ? currentVideoId : "Undefined");

    if (typeof currentVideoId === 'undefined' || !currentVideoId) {
        return;
    }

    /** @type {string} */
    const w = document.getElementById('eWidth')?.value || "560";
    /** @type {string} */
    const h = document.getElementById('eHeight')?.value || "315";
    /** @type {string} */
    const s = document.getElementById('eStart')?.value || "0";
    const startSeconds = parseInt(s) || 0;

    // バッジ（分:秒）を更新
    updateTimeBadge(startSeconds);

    // ★追加: プレイヤーが存在し、かつシーク可能なら移動させる
    if (typeof player !== 'undefined' && player && typeof player.seekTo === 'function') {
        // 第2引数を true にすると、シーク先がまだバッファされてなくても強制的に移動する
        player.seekTo(startSeconds, true);
    }

    const embedCode = `<iframe width="${w}" height="${h}" src="https://www.youtube.com/embed/${currentVideoId}?start=${s}" frameborder="0" allowfullscreen></iframe>`;
    const timeUrl = `https://youtu.be/${currentVideoId}?t=${s}`;

    /** @type {HTMLElement|null} */
    const outDisplay = document.getElementById('embedOutputAreas');

    if (outDisplay) {
        const timeUrlRow = createOutputRow("Time URL", timeUrl);
        const embedTagRow = `
            <div class="space-y-1.5">
                <label class="pl-[12px] text-[9px] text-gray-400 block uppercase font-bold tracking-wider">Embed Code</label>
                <div class="flex gap-2 items-start">
                    <textarea readonly
                        onclick="this.select()"
                        class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none h-24 resize-none leading-relaxed"
                    >${embedCode}</textarea>
                    <button onclick="handleCopy(this)"
                        class="btn-gray-copy w-[70px] h-[40px] transition-all text-[10px] font-bold uppercase flex-shrink-0">
                        Copy
                    </button>
                </div>
            </div>`;

        outDisplay.innerHTML = `
            <div class="space-y-4 mt-4">
                ${embedTagRow}
                ${timeUrlRow}
            </div>
        `;
    }
}



/**
 * 秒数を「分:秒」または「時:分:秒」の形式に変換して表示を更新する。
 * @param {number} seconds - 変換する秒数
 * @returns {void}
 */
function updateTimeBadge(seconds) {
    const badge = document.getElementById('timeFormat');
    if (!badge) return;

    if (seconds <= 0) {
        badge.innerText = "0:00";
        return;
    }

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const displayM = m.toString();
    const displayS = s.toString().padStart(2, '0');

    if (h > 0) {
        badge.innerText = `${h}:${displayM.padStart(2, '0')}:${displayS}`;
    } else {
        badge.innerText = `${displayM}:${displayS}`;
    }
}



/**
 * 入力フィールドに対して、マウスホイールでの数値増減を有効にする。
 * @param {WheelEvent} event - マウスホイールイベント
 * @param {'w'|'h'|'s'} type - 更新する項目の種類 (w: Width, h: Height, s: Start)
 * @returns {void}
 */
function handleWheel(event, type) {
    event.preventDefault();

    /** @type {HTMLInputElement} */
    const input = event.currentTarget;
    const step = 1;
    const delta = event.deltaY < 0 ? step : -step;

    const newValue = parseInt(input.value || "0") + delta;

    if (newValue >= 0) {
        input.value = newValue.toString();

        if (type === 'w' || type === 'h') {
            resizeEmbed(type);
        } else if (type === 's') {
            updateEmbedOutputs();
        }
    }
}

/**
 * 幅・高さの入力を監視し、比率を維持して更新する。
 * 縦長（Shorts）の場合は 9:16、横長の場合は 16:9 で計算する。
 * @param {'w'|'h'} type - 変更された入力の種類
 * @returns {void}
 */
function resizeEmbed(type) {
    const elW = document.getElementById('eWidth');
    const elH = document.getElementById('eHeight');
    const elKeep = document.getElementById('keepAspect');

    if (!elW || !elH) return;

    let w = parseInt(elW.value) || 0;
    let h = parseInt(elH.value) || 0;

    // 比率維持がONの時だけ計算
    if (elKeep && elKeep.checked) {
        // 現在の状態で縦長（Shorts）か横長かを判定
        // typeが 'w' なら変更前の 'h' を見て、'h' なら変更前の 'w' を見る
        const isPortrait = (type === 'w') ? (h > w * 0.8) : (h * 0.8 > w);

        if (isPortrait) {
            // --- Shorts比率 (9:16) ---
            if (type === 'w') {
                elH.value = Math.round(w * 16 / 9).toString();
            } else {
                elW.value = Math.round(h * 9 / 16).toString();
            }
        } else {
            // --- 通常比率 (16:9) ---
            if (type === 'w') {
                elH.value = Math.round(w * 9 / 16).toString();
            } else {
                elW.value = Math.round(h * 16 / 9).toString();
            }
        }
    }

    // 表示とスタイルの更新
    updateEmbedOutputs();
    updateSizeButtonStyles();
}


/**
 * 現在の入力値とボタンの設定値を比較し、一致するものだけドット枠を適用する。
 * @returns {void}
 */
function updateSizeButtonStyles() {
    /** @type {string} */
    const currentW = document.getElementById('eWidth')?.value || "";
    /** @type {string} */
    const currentH = document.getElementById('eHeight')?.value || "";

    /** @type {NodeListOf<HTMLButtonElement>} */
    const buttons = document.querySelectorAll('.btn-gray-copy');

    buttons.forEach(btn => {
        // onclick属性から設定値 (w, h) を抽出
        const onClickAttr = btn.getAttribute('onclick') || "";
        const match = onClickAttr.match(/setEmbedSize\((\d+),\s*(\d+)\)/);

        if (match) {
            const [_, btnW, btnH] = match;
            const isMatch = (currentW === btnW && currentH === btnH);

            if (isMatch) {
                // アクティブ状態: ドット枠を強制表示
                btn.style.border = "1px dashed #000"; // 直接スタイルを叩くのが一番確実
                btn.style.opacity = "1";
                // Tailwindの干渉を防ぐためクラスも調整
                btn.classList.add('border-dashed', 'border-black');
                btn.classList.remove('border-transparent', 'opacity-50');
            } else {
                // 非アクティブ状態: 枠を消す
                btn.style.border = "1px solid transparent";
                btn.style.opacity = "0.5";
                btn.classList.remove('border-dashed', 'border-black');
                btn.classList.add('border-transparent', 'opacity-50');
            }
        }
    });
}



/**
 * YouTubeプレイヤーの現在の再生時間を取得し、
 * 開始時間（eStart）の入力欄に反映させた後、タグ一覧も更新する。
 */
function syncTime() {
    // 1. YouTubeプレイヤーのインスタンスがあるか確認
    // ※ player 変数名は環境に合わせてね（YT.Playerのインスタンス）
    if (typeof player !== 'undefined' && player.getCurrentTime) {
        /** @type {number} 現在の再生秒数（小数点以下切り捨て） */
        const currentTime = Math.floor(player.getCurrentTime());

        /** @type {HTMLInputElement|null} 開始時間の入力フィールド */
        const startInput = document.getElementById('eStart');

        if (startInput) {
            // 入力欄に値をセット
            startInput.value = currentTime;

            // 値が変わったので、下の「埋め込みタグ一覧」も再生成させる
            updateEmbedOutputs();

            // ★追加：数値が変わったのでボタンの状態も再チェック
            //（秒数を変えると、たとえサイズが一致していてもカスタム状態とみなして枠を消す、
            // もしくは現在のサイズを維持して枠を残すかの判定を走らせる）
            updateSizeButtonStyles();
        }
    } else {
        console.error("Player instance not found. Make sure YouTube IFrame API is ready.");
    }
}




/**
 * ---AssetsタブとEmbedタブの表示切り替え---
 * 表示モード（サムネイル/埋め込み）を切り替え、状態を保存する
 * @param {'thumb' | 'embed'} t - 切り替えるタブの識別子 ('thumb' または 'embed')
 */
function switchTab(t) {
	const elThumb = document.getElementById('tabThumb');
	const elEmbed = document.getElementById('tabEmbed');
	const conThumb = document.getElementById('contentThumb');
	const conEmbed = document.getElementById('contentEmbed');

	if (!elThumb || !elEmbed || !conThumb || !conEmbed) return;

	// 【改善点】見た目の変化（クラスの付け替え）を最初に行う
	// これにより、ユーザーのクリックに対して「即座に」反応が返ります
	elThumb.classList.toggle('tab-active', t === 'thumb');
	elEmbed.classList.toggle('tab-active', t === 'embed');
	conThumb.classList.toggle('hidden', t !== 'thumb');
	conEmbed.classList.toggle('hidden', t !== 'embed');

	// 【改善点】重い処理や保存は、見た目の変化が終わった「後」に回す
	setTimeout(() => {
		localStorage.setItem('yt_last_tab', t);

		// もし switchTab の中で重い計算をしているなら、ここに入れる
		// updateThumbOutputs();
	}, 0);

	// アセットやタグ表示が含まれるタブを開いた時に、中身を再生成する
    if (currentVideoId) {
        updateEmbedOutputs();
    }
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





/* ───────────────────────────────────────────
     UPDATED CORE LOGIC
─────────────────────────────────────────── */

function updateDots(sId, iId, ratio) {
    const container = document.getElementById(sId);
    const indicator = document.getElementById(iId);
    if (!container || !indicator) return;

    // 1. インデックスの計算
    const childrenCount = (sId === 'mainSlider' && typeof assetList !== 'undefined') ? assetList.length : container.children.length;
    // ratioを考慮しつつ計算
    const itemWidth = (sId === 'mainSlider') ? (container.scrollWidth / childrenCount) : (container.clientWidth / ratio);
    const idx = Math.round(container.scrollLeft / itemWidth);

    // 2. ドットの描画（共通）
    indicator.innerHTML = Array.from({ length: childrenCount }).map((_, i) => `
        <div class="dot ${i === idx ? 'active' : ''}"
             onclick="${sId === 'mainSlider' ? `handleDotClick(this, '${sId}', ${i})` : `scrollToIndex('${sId}', ${i})`}"></div>
    `).join('');

    // 3. メインスライダー(サムネイル)の場合の個別処理
    if (sId === 'mainSlider' && typeof assetList !== 'undefined' && assetList[idx]) {
        currentImgUrl = assetList[idx].url;
        currentImgLabel = assetList[idx].label || "Thumbnail";

        const metaElem = document.getElementById('assetMeta');
        if (metaElem) {
            metaElem.innerText = `${currentImgLabel} // ${assetList[idx].res}`;
        }
        updateThumbOutputs(); // タグ文字列を更新
    }
}


/**
 * ドットをクリックしたときに指定の画像までスクロールさせる
 */
function scrollToIndex(sId, index) {
    const container = document.getElementById(sId);
    if (!container) return;

    const childrenCount = (sId === 'mainSlider') ? assetList.length : container.children.length;
    const targetLeft = (container.scrollWidth / childrenCount) * index;

    container.scrollTo({
        left: targetLeft,
        behavior: 'smooth'
    });
}



/**
 * プリセットボタンからサイズをセットし、UIを更新する
 * @param {number} w - 幅 (px)
 * @param {number} h - 高さ (px)
 * @returns {void}
 */
function setEmbedSize(w, h) {
    /** @type {HTMLInputElement|null} */
    const elW = document.getElementById('eWidth');
    /** @type {HTMLInputElement|null} */
    const elH = document.getElementById('eHeight');

    if (!elW || !elH) return;

    elW.value = w.toString();
    elH.value = h.toString();

    // アスペクト比維持機能があれば実行、なければ直接タグ生成
    if (typeof resizeEmbed === 'function') {
        resizeEmbed('w');
    } else {
        updateEmbedOutputs();
    }

    // ボタンのスタイル（ドット枠）を現在の数値に同期
    updateSizeButtonStyles();
}






/**
 * 指定されたサイズでYouTube埋め込みの実寸プレビューをライトボックス表示する
 * 画面サイズを超える巨大なプレビューにも対応し、Escキーでのクローズもサポート
 * * @returns {void}
 */
function openEmbedPreview() {
    /** @type {string} 幅の入力値 */
    const w = document.getElementById('eWidth').value;
    /** @type {string} 高さの入力値 */
    const h = document.getElementById('eHeight').value;
    /** @type {string} 開始秒数の入力値 */
    const start = document.getElementById('eStart').value;

    /** @type {HTMLDivElement} オーバーレイ要素の生成 */
    const overlay = document.createElement('div');
    overlay.id = 'previewOverlay';

    // Nothing OS風の背景（白透過＋ブラー）とスクロール設定
    overlay.className = "fixed inset-0 z-[100] flex flex-col items-center justify-start overflow-y-auto bg-white/80 backdrop-blur-md p-10 animate-in fade-in duration-300";

    /**
     * オーバーレイの背景部分をクリックした際にプレビューを閉じる
     * @param {MouseEvent} e
     */
    overlay.onclick = (e) => {
        if(e.target === overlay) closeEmbedPreview();
    };

    overlay.innerHTML = `
        <button onclick="closeEmbedPreview()"
                class="fixed top-6 right-6 z-[110] bg-black text-white w-12 h-12 rounded-full flex items-center justify-center shadow-xl hover:scale-110 active:scale-90 transition-all">
            <span class="text-2xl">×</span>
        </button>

        <div class="relative my-auto animate-in zoom-in-95 duration-300 shadow-2xl"
             style="width:${w}px; height:${h}px; min-width:${w}px;">
            <iframe width="100%" height="100%"
                    src="https://www.youtube.com/embed/${currentVideoId}?start=${start}"
                    frameborder="0" allowfullscreen></iframe>

            <div class="absolute -top-8 left-0 text-[10px] font-bold uppercase tracking-widest text-black/40">
                Actual Size // ${w} x ${h} (ESC TO CLOSE)
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 背面のメイン画面スクロールをロック
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';

    /**
     * Escキー押下時のイベントハンドラ
     * @param {KeyboardEvent} e
     */
    const escListener = (e) => {
        if (e.key === 'Escape') {
            closeEmbedPreview();
            window.removeEventListener('keydown', escListener);
        }
    };
    window.addEventListener('keydown', escListener);
}

/**
 * 実寸プレビューのオーバーレイを破棄し、画面のスクロールロックを解除する
 * @returns {void}
 */
function closeEmbedPreview() {
    /** @type {HTMLElement|null} */
    const overlay = document.getElementById('previewOverlay');
    if (overlay) {
        overlay.classList.add('animate-out', 'fade-out', 'zoom-out-95');
        setTimeout(() => {
            overlay.remove();
            // スクロールロックを解除
            document.body.style.overflow = '';
            document.body.style.height = '';
        }, 200);
    }
}





/* ───────────────────────────────────────────
     OTHERS (UTILITIES)
─────────────────────────────────────────── */

function copyAllHistory() {
    const h = JSON.parse(localStorage.getItem('yt_history') || '[]');
    navigator.clipboard.writeText(h.map(id => `https://youtu.be/${id}`).join('\n'));
}

function moveSlide(id, d) {
    const s = document.getElementById(id);
    if (s) s.scrollBy({ left: d * s.clientWidth, behavior: 'smooth' });
}












// 他の関数（loadVideo, updateDotsなど）が全部終わったあとの場所に...

const mainSlider = document.getElementById('mainSlider');

if (mainSlider) {
    mainSlider.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            // scrollLeft += e.deltaY だと少し動きがカクつくので
            // scrollBy を使うと behavior: 'smooth' が効きやすくなるよ
            mainSlider.scrollBy({
                left: e.deltaY,
                behavior: 'auto' // ホイールは 'auto' の方が直感的かも
            });
        }
    }, { passive: false });
}






/**
 * ツールチップの表示設定
 * @type {{displayTime: number, fadeOutTime: number, fadeInTime: number}}
 */
const TOOLTIP_CONFIG = {
  displayTime: 2000, // 表示を維持する時間
  fadeOutTime: 1000, // ゆっくり消える時間
  fadeInTime: 300    // パッと出る時間
};

/** 現在実行中のツールチップ非表示タイマーのID
 * @type {number|null}
 */
let activeTooltipTimer = null;

/**
 * 指定されたIDを持つツールチップを表示する。
 * 他の表示中のツールチップは即座に非表示にし、排他制御を行う。
 * @param {string} id - 表示対象となるツールチップ要素のID
 * @returns {void}
 */
function showTooltip(id) {
  // 1. 実行中のタイマーがあれば即座に止める
  if (activeTooltipTimer) clearTimeout(activeTooltipTimer);

  // 2. 全てのツールチップを「一瞬で」非表示にする（排他制御）
  document.querySelectorAll('[id$="-tip"]').forEach(tip => {
    tip.style.transitionDuration = '0ms';
    tip.classList.add('opacity-0', 'pointer-events-none');
    tip.classList.remove('opacity-100', 'translate-y-0');
  });

  /** @type {HTMLElement|null} */
  const target = document.getElementById(id);
  if (!target) return;

  // 3. ターゲットをふわっと表示
  target.style.transitionDuration = `${TOOLTIP_CONFIG.fadeInTime}ms`;
  target.classList.remove('opacity-0', 'pointer-events-none');
  target.classList.add('opacity-100', 'translate-y-0');

  // 4. 指定時間後に「ゆっくり」消すタイマーをセット
  activeTooltipTimer = setTimeout(() => {
    target.style.transitionDuration = `${TOOLTIP_CONFIG.fadeOutTime}ms`;
    target.classList.add('opacity-0', 'pointer-events-none');
    target.classList.remove('opacity-100', 'translate-y-0');
    activeTooltipTimer = null;
  }, TOOLTIP_CONFIG.displayTime);
}




/* ───────────────────────────────────────────
      UI UTILITIES & FEEDBACK
─────────────────────────────────────────── */

/**
 * 配信先プラットフォームの定義
 * @type {Object.<string, string>}
 */
const SHARE_ENDPOINTS = {
    x: "https://twitter.com/intent/tweet?url=",
    threads: "https://www.threads.net/intent/post?text=",
    facebook: "https://www.facebook.com/sharer/sharer.php?u=",
    line: "https://line.me/R/msg/text/?"
};

/**
 * 現在の動画情報を外部へ配信する
 * @param {keyof typeof SHARE_ENDPOINTS} platform
 */
function share(platform) {
    if (!currentVideoId) return;

    const videoUrl = `https://youtu.be/${currentVideoId}`;
    // タイトルがあれば「タイトル | URL」、なければ「URL」のみ
    const content = currentVideoTitle ? `${currentVideoTitle} | ${videoUrl}` : videoUrl;
    const encodedContent = encodeURIComponent(content);
    const encodedUrl = encodeURIComponent(videoUrl);

    let finalUrl = "";

    if (platform === 'facebook') {
        // Facebookはテキストを直接送れない仕様なので、URLのみを渡す
        finalUrl = SHARE_ENDPOINTS.facebook + encodedUrl;
    } else {
        // X, Threads, Line はタイトルを含めたテキストとして送る
        finalUrl = SHARE_ENDPOINTS[platform] + encodedContent;
    }

    if (finalUrl) {
        window.open(finalUrl, '_blank', 'noreferrer,noopener');
    }
}

/**
 * 現在の動画URLをクリップボードにコピーする
 * @param {HTMLElement} btn - クリックされたボタン要素
 */
function copyCurrentUrl(btn) {
    if (!currentVideoId) {
        console.warn("動画IDが見つかりません");
        return;
    }

    const videoUrl = `https://youtu.be/${currentVideoId}`;

    // クリップボードへのコピー実行
    navigator.clipboard.writeText(videoUrl).then(() => {
        // --- 成功時のフィードバック処理 ---
        const span = btn.querySelector('span');
        const originalText = span.innerText;

        // 文字を「COPIED!」に変更
        span.innerText = "COPIED!";
        btn.classList.replace('text-black/40', 'text-black'); // 一時的に色を濃くする

        // 2秒後に元の状態に戻す
        setTimeout(() => {
            span.innerText = originalText;
            btn.classList.replace('text-black', 'text-black/40');
        }, 2000);

    }).catch(err => {
        console.error('コピーに失敗しました', err);
    });
}