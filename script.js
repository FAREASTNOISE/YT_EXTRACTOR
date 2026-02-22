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
let currentImgUrl = "";



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
 * ユーザー入力されたURLから動画IDとプレイリストIDを解析し、読み込み処理を振り分ける
 * @description 対応形式: 標準URL, Shorts, 埋め込み, プレイリスト
 * @returns {void}
 */
function processInput() {
	const inputEl = document.getElementById('videoUrl');
	/** @type {string} */
	const url = inputEl.value.trim();

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

	player = new YT.Player('player', {
		height: '100%', width: '100%', videoId: id,
		playerVars: {
			'rel': 0,          // 関連動画を自チャンネルのみに制限
			'playsinline': 1   // モバイルでのインライン再生を許可
		},
		events: { 'onReady': () => updateEmbedOutputs() }
	});

	// const candidates = [
	// 	{ label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
	// 	{ label: 'Standard', res: '640x480', url: `https://img.youtube.com/vi/${id}/sddefault.jpg`, isScene: false },
	// 	{ label: 'HQ Default', res: '480x360', url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, isScene: false },
	// 	{ label: 'Scene 1', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
	// 	{ label: 'Scene 2', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
	// 	{ label: 'Scene 3', res: 'Storyboard', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true },
	// 	// candidates の中身をこう書き換えてみて
	// 	{ label: 'Medium', res: '320x180', url: `https://img.youtube.com/vi/${id}/mqdefault.jpg`, isScene: true }, // これを追加！

	// 	// { label: 'Start', res: 'Small', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
	// 	// { label: 'Middle', res: 'Small', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true },
	// 	// { label: 'End', res: 'Small', url: `https://img.youtube.com/vi/${id}/3.jpg`, isScene: true },
	// ];

	// const candidates = [
	// 	{ label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
	// 	{ label: 'Standard', res: '640x480', url: `https://img.youtube.com/vi/${id}/sddefault.jpg`, isScene: false },
	// 	// --- ここから「違う画像」が出るかもしれないお楽しみ枠 ---
	// 	{ label: 'Wide Start', res: '16:9', url: `https://img.youtube.com/vi/${id}/mq1.jpg`, isScene: true },
	// 	{ label: 'Wide Mid', res: '16:9', url: `https://img.youtube.com/vi/${id}/mq2.jpg`, isScene: true },
	// 	{ label: 'Wide End', res: '16:9', url: `https://img.youtube.com/vi/${id}/mq3.jpg`, isScene: true },
	// 	{ label: 'Alt Thumb', res: 'Legacy', url: `https://img.youtube.com/vi/${id}/0.jpg`, isScene: true },
	// 	{ label: 'Small 1', res: '4:3', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true },
	// 	{ label: 'Small 2', res: '4:3', url: `https://img.youtube.com/vi/${id}/2.jpg`, isScene: true }
	// ];

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
		{ label: 'Legacy 1', res: '1.jpg', url: `https://img.youtube.com/vi/${id}/1.jpg`, isScene: true }

	];


	assetList = [];
	for (const c of candidates) {
		const isValid = await new Promise(resolve => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = () => resolve(img.width > 120);
			img.onerror = () => resolve(false);
			img.src = c.url;
		});
		if (isValid) assetList.push(c);
	}

	const slider = document.getElementById('mainSlider');
	slider.innerHTML = assetList.map(a => `
		<div class="slide-item-container ${a.isScene ? 'is-scene' : 'is-main'}">
			<img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}">
		</div>
	`).join('');

	slider.scrollTo(0, 0);
	updateDots('mainSlider', 'mainIndicator', 1);

	if (shouldScroll) {
		window.scrollTo({
			top: document.getElementById('resultArea').offsetTop - 20,
			behavior: 'smooth'
		});
	}
}


// /**
//  * 画像の存在チェックをスキップして、すべての候補を表示する
//  * @param {string} id - YouTube動画ID
//  * @param {boolean} [shouldScroll=false] - スクロール設定
//  */
// async function loadVideo(id, shouldScroll = false) {
// 	if (!id || id === currentVideoId) return;
// 	currentVideoId = id;
// 	saveHistory(id);

// 	document.getElementById('resultArea').classList.remove('hidden');
// 	resetPlayer();

// 	// プレイヤー生成（rel=0 設定済み）
// 	player = new YT.Player('player', {
// 		height: '100%', width: '100%', videoId: id,
// 		playerVars: { 'rel': 0, 'playsinline': 1 },
// 		events: { 'onReady': () => updateEmbedOutputs() }
// 	});

// 	// WebPを含めたフルリスト
// 	const candidates = [
// // プレビュー専用のURL（これが一番動く可能性が高い！）
// { label: 'Live Preview', res: 'WebP', url: `https://i.ytimg.com/an_webp/${id}/mqdefault_6s.webp?du=3000&sqp=CLz9_7MG&rs=AOn4CLBT`, isScene: true },

// 		{ label: 'Max Res', res: '1280x720', url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`, isScene: false },
// 		{ label: 'Motion', res: 'WebP', url: `https://img.youtube.com/vi_webp/${id}/preview.webp`, isScene: true },
// 		{ label: 'Animated 1', res: 'WebP', url: `https://img.youtube.com/vi_webp/${id}/1.webp`, isScene: true },
// 		{ label: 'High Scene 1', res: 'HQ', url: `https://img.youtube.com/vi/${id}/hq1.jpg`, isScene: true },
// 		{ label: 'Wide Scene 1', res: 'MQ', url: `https://img.youtube.com/vi/${id}/mq1.jpg`, isScene: true },

// 		// 1. preview.webp (これが本命。数秒間のループアニメーション)
// { label: 'True Motion', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/preview.webp`, isScene: true },

// // 2. tiny.webp (モバイルプレビュー用。これも動くことがある)
// { label: 'Tiny Motion', res: 'WebP', url: `https://i.ytimg.com/vi_webp/${id}/tiny.webp`, isScene: true }
// 	];

// 	// チェックをせずにそのままリスト化
// 	assetList = candidates;

// 	const slider = document.getElementById('mainSlider');
// 	slider.innerHTML = assetList.map(a => `
// 		<div class="slide-item-container ${a.isScene ? 'is-scene' : 'is-main'}">
// 			<img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}"
// 				 onerror="this.parentElement.style.display='none'">
// 		</div>
// 	`).join('');
// 	// ↑ onerror を入れておけば、読み込めなかった画像枠だけ勝手に消えてくれるよ！

// 	slider.scrollTo(0, 0);
// 	updateDots('mainSlider', 'mainIndicator', 1);

// 	if (shouldScroll) {
// 		window.scrollTo({
// 			top: document.getElementById('resultArea').offsetTop - 20,
// 			behavior: 'smooth'
// 		});
// 	}
// }




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





/**
 * インジケーターのドットを更新し、クリック可能にする
 * @param {string} sId - スライダーのID
 * @param {string} iId - インジケーターのID
 * @param {number} ratio - 計算用比率
 */
function updateDots(sId, iId, ratio) {
    const container = document.getElementById(sId);
    const indicator = document.getElementById(iId);
    if (!container || !indicator) return;

    const childrenCount = (sId === 'mainSlider') ? assetList.length : container.children.length;
    const itemWidth = container.scrollWidth / childrenCount;
    const idx = Math.round(container.scrollLeft / itemWidth);

    // onclickを復活させ、thisを渡すことで即座に操作できるようにする
    indicator.innerHTML = Array.from({ length: childrenCount }).map((_, i) => `
        <div class="dot ${i === idx ? 'active' : ''}"
             onclick="handleDotClick(this, '${sId}', ${i})"></div>
    `).join('');

    if (sId === 'mainSlider' && assetList[idx]) {
        currentImgUrl = assetList[idx].url;
        document.getElementById('assetMeta').innerText = `${assetList[idx].label} // ${assetList[idx].res}`;
        updateThumbOutputs();
    }
}

/**
 * ドットがクリックされた時の処理
 * @param {HTMLElement} el - クリックされたドット自身
 * @param {string} sId - スライダーのID
 * @param {number} index - 何番目か
 */
function handleDotClick(el, sId, index) {
    // 1. 【即座に反応】クリックされたドットをその場で光らせる
    const parent = el.parentElement;
    parent.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
    el.classList.add('active'); // これで CSS の .active::before が走る！

    // 2. 【移動】スライダーを動かす
    scrollToIndex(sId, index);
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
// 画像系出力タグの生成（ボタン統一版）
function updateThumbOutputs() {
		const container = document.getElementById('thumbOutputs');
		// 新しいファイル名に合わせる
		const iconTag = `<img src="icon-assets.svg" class="btn-icon">`;

		container.innerHTML = `
				<div class="nothing-card p-5 space-y-5">
						<div>
								<label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">HTML Image Tag (IMG)</label>
								<div class="flex gap-2">
										<input type="text" value='<a href="https://www.youtube.com/watch?v=${currentVideoId}" target="_blank"><img src="${currentImgUrl}" alt="Thumbnail"></a>' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
										<button onclick="copyRaw(this)" class="btn-gray-copy">${iconTag}COPY HTML</button>
								</div>
						</div>
						<div>
								<label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Markdown Link</label>
								<div class="flex gap-2">
										<input type="text" value='[![](${currentImgUrl})](https://www.youtube.com/watch?v=${currentVideoId})' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
										<button onclick="copyRaw(this)" class="btn-gray-copy">${iconTag}COPY MD</button>
								</div>
						</div>
						<div>
								<label class="text-[9px] text-gray-400 block mb-1.5 uppercase font-bold tracking-wider">Direct Asset URL</label>
								<div class="flex gap-2">
										<input type="text" value='${currentImgUrl}' readonly class="nothing-input flex-grow p-3 text-[10px] font-mono focus:outline-none">
										<button onclick="copyRaw(this)" class="btn-gray-copy">${iconTag}COPY URL</button>
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



/**
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
				// indicator.innerHTML = assetList.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
				document.getElementById(iId).innerHTML = assetList.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}" onclick="scrollToIndex('${sId}', ${i})"></div>`).join('');

				if (assetList[idx]) {
						currentImgUrl = assetList[idx].url;
						document.getElementById('assetMeta').innerText = `${assetList[idx].label} // ${assetList[idx].res}`;
						updateThumbOutputs();
				}
		} else {
				// 履歴など
				const dotsCount = container.children.length;
				document.getElementById(iId).innerHTML = Array.from({ length: dotsCount }).map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}" onclick="scrollToIndex('${sId}', ${i})"></div>`).join('');
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
