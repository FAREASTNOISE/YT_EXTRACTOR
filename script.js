/**
 * @fileoverview YouTube Asset Extractor
 * YouTubeのURLから情報を抽出するツール。
 *
 * @author FEN
 * @version 1.1.0
 */


/* ───────────────────────────────────────────
	CORE ENGINE v6.9.2 (Refined)
─────────────────────────────────────────── */

/** @type {any} YouTube Playerのインスタンス（YouTube IFrame API用） */
let player = null;

/** @type {string} 現在表示・処理している動画のID */
let currentVideoId = "";

/** @type {Object[]} 抽出されたアセット（画像URLやサイズ等）を格納する配列 */
let assetList = [];

/** @type {string} 現在プレビュー表示している画像のURL */
let currentImgUrl = "";

/** @type {string} 画像ラベル（例: "Max Res", "Standard", "Scene" 等） */
let currentImgLabel = "Thumbnail"; // 値は空か "Thumbnail"

/** @type {string} 現在表示している動画のタイトル */
let currentVideoTitle = "";

/**
 * 現在表示中の動画がShorts動画であるかどうかを保持するフラグ
 * @type {boolean} - true: Shortsモード, false: 通常動画モード
 * @default false
 */
let isCurrentShorts = false;



/**
 * YouTube サムネイルの取得候補リスト（テンプレート）
 * 各オブジェクトの `path` 内にある "ID" 文字列を、実行時に実際の動画IDと置換して使用する。
 * @type {Array<{label: string, res: string, path: string, isScene: boolean}>}
 */
const THUMBNAIL_TEMPLATES = [
    // メイン画像 (img.youtube.com 系)
    { label: 'Max Res', res: '1280x720', path: 'vi/ID/maxresdefault.jpg', isScene: false },
    { label: 'Ultra HQ', res: '720p', path: 'vi/ID/hq720.jpg', isScene: false },
    { label: 'Standard', res: '640x480', path: 'vi/ID/sddefault.jpg', isScene: false },

    // WebPのアニメーション (i.ytimg.com 系)
    { label: 'Animated 1', res: 'WebP', path: 'vi_webp/ID/1.webp', isScene: true },
    { label: 'Animated 2', res: 'WebP', path: 'vi_webp/ID/2.webp', isScene: true },
    { label: 'Animated 3', res: 'WebP', path: 'vi_webp/ID/3.webp', isScene: true },
    { label: 'Scene WebP', res: 'WebP', path: 'vi_webp/ID/default.webp', isScene: true },

    // 高画質なシーン画像
    { label: 'High Scene 1', res: 'HQ', path: 'vi/ID/hq1.jpg', isScene: true },
    { label: 'High Scene 2', res: 'HQ', path: 'vi/ID/hq2.jpg', isScene: true },
    { label: 'High Scene 3', res: 'HQ', path: 'vi/ID/hq3.jpg', isScene: true },

    // 中画質なシーン画像
    { label: 'Wide Scene 1', res: 'MQ', path: 'vi/ID/mq1.jpg', isScene: true },
    { label: 'Wide Scene 2', res: 'MQ', path: 'vi/ID/mq2.jpg', isScene: true },
    { label: 'Wide Scene 3', res: 'MQ', path: 'vi/ID/mq3.jpg', isScene: true },

    // 予備枠
    { label: 'Alt Thumb', res: '0.jpg', path: 'vi/ID/0.jpg', isScene: true },
    { label: 'Legacy 1', res: '1.jpg', path: 'vi/ID/1.jpg', isScene: true }

	// --- 以下、将来用の予備（コメントアウト） ---
    // { label: 'Scene 1', res: 'Storyboard', path: 'vi/ID/1.jpg', isScene: true },
    // { label: 'Scene 2', res: 'Storyboard', path: 'vi/ID/2.jpg', isScene: true },
    // { label: 'Scene 3', res: 'Storyboard', path: 'vi/ID/3.jpg', isScene: true },

    // { label: 'Start',   res: 'Small',      path: 'vi/ID/1.jpg', isScene: true },
    // { label: 'Middle',  res: 'Small',      path: 'vi/ID/2.jpg', isScene: true },
    // { label: 'End',     res: 'Small',      path: 'vi/ID/3.jpg', isScene: true },
];






/**
 * アプリケーションのグローバル状態（動画情報やアセット情報）を初期化する。
 * 新しい動画を読み込む直前に呼び出し、古いデータの混入を防ぐためのもの。
 * @returns {void}
 */
function resetAppState() {
	console.log("Cleaning up... Previous assetList length:", assetList.length);

	currentVideoId = "";
	assetList = [];
	currentImgUrl = "";
	currentImgLabel = "Thumbnail";
	currentVideoTitle = "";

	// UIの表示もリセット状態に戻す
	const titleEl = document.getElementById('vTitle');
	if (titleEl) titleEl.innerText = "WAITING FOR VIDEO...";

	console.log("Cleaned. Current assetList length:", assetList.length);
}



/**
 * ページ読み込み完了時の初期化処理
 * 履歴の読み込み、最終タブの復元、イベントリスナーの設定を行う
 */
window.onload = () => {
	resetAppState(); // グローバル状態（動画情報やアセット情報）を初期化
	loadHistory();   // localStorageから履歴データの復元・セッティング

	// 💡 localStorage から Loop 設定を復元
    const savedLoop = localStorage.getItem('yt_loop_setting') === 'true';
    const loopCheck = document.getElementById('checkLoop');
    if (loopCheck) {
        loopCheck.checked = savedLoop;
    }


	/** @type {string} 前回使用していたタブの名前（localStorageから取得 default:'thumb'） */
	const lastTab = localStorage.getItem('yt_last_tab') || 'thumb';

	// ASSET EMBED タブの切り替えを復元 UIレンダリングのタイミングを考慮して実行
	requestAnimationFrame(() => {
		if (typeof switchTab === 'function') {
			switchTab(lastTab);
		}
	});


	// スクロール監視（ドットインジケーター連動）
	/** @type {HTMLElement|null} メインのスライダー要素 */
	const mainSlider = document.getElementById('mainSlider');
	if (mainSlider) {
		mainSlider.addEventListener('scroll', () => updateDots('mainSlider', 'mainIndicator', 1));
	}

	// 3. 貼り付けボタンの非同期処理設定
	/** @type {HTMLElement|null} クリップボード貼り付けボタン */
	const pasteBtn = document.getElementById('pasteBtn');
	if (pasteBtn) {
		/**
		 * 貼り付けボタンクリック時のハンドラ
		 * クリップボード権限を確認し、テキストを読み取って解析を開始する
		 * @async
		 * @returns {Promise<void>}
		 */
		pasteBtn.onclick = async () => {
			try {
				// 権限をチェック（任意だけど入れるとより親切）
				const permission = await navigator.permissions.query({ name: "clipboard-read" });
				if (permission.state === "denied") {
					throw new Error("Permission denied");
				}

				// クリップボードのテキストを取得
				const text = await navigator.clipboard.readText();

				// 入力欄にセット
				/** @type {HTMLInputElement|null} URL入力フィールド */
				const urlInput = document.getElementById('videoUrl');
				if (urlInput) {
					urlInput.value = text;
					// 貼り付けた後に自動で解析を実行！
					processInput();
				}
			} catch (e) {
				console.error("貼り付けに失敗しました:", e);
				alert("ブラウザの貼り付け許可を出してください");
			}
		};
	}
};


/**
 * YouTubeのURLを解析し、動画ID、Shorts判定、プレイリストIDを抽出する。
 * @param {string} url - 解析対象のURL
 * @returns {{videoId: string|null, isShorts: boolean, startTime: number, playlistId: string|null}}
 * @description
 * - videoId: 11桁の動画ID
 * - isShorts: /shorts/ 形式かどうかのフラグ
 * - playlistId: list= パラメータのID
 */
function analyzeYouTubeUrl(url) {
	// 解析結果を格納するオブジェクト
	const analysisResult = {
		videoId: null,
		isShorts: false,
		startTime: 0,
		playlistId: null,
	};

	if (!url) return analysisResult;


	try {
		// 1. まずは動画IDを正規表現でサクッと抜く（これは今まで通り）
		const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|u\/\w\/|shorts\/))([^#\&\?]{11})/);
		if (videoMatch) {
			analysisResult.videoId = videoMatch[1];
			if (url.includes('/shorts/')) {
				analysisResult.isShorts = true;
			}
		}

		// 2. プレイリストIDを抜く
		const playlistMatch = url.match(/[?&]list=([^#& ]+)/);
		if (playlistMatch) {
			analysisResult.playlistId = playlistMatch[1];
		}

		// 3. 開始時間を抜く（URLオブジェクトを安全に使う）
		// URLが不完全な場合（https://がない等）に備えて
		let tempUrl = url;
		if (!url.startsWith('http')) {
			tempUrl = 'https://' + url; // 解析用に仮のプロトコルを足す
		}

		const urlObj = new URL(tempUrl);
		const params = urlObj.searchParams;
		const timeParam = params.get('t') || params.get('start');

		if (timeParam) {
			// どんな形式が来ても parseYouTubeTime が秒数に変換してくれる
			analysisResult.startTime = parseYouTubeTime(timeParam);
		}

	} catch (e) {
		// e.message でエラー内容を出力
		console.warn("詳細解析でスキップが発生しました:", e.message);
	}

	return analysisResult;
}


/**
 * YouTubeの時間形式（"1m30s" または "90"）を秒数に変換する
 * @param {string|number} t - 変換対象の時間文字列（例: "1m30s", "90", "2h10m"）
 * @returns {number} 変換後の総秒数（変換不能な場合は0）
 */
function parseYouTubeTime(t) {
	if (!t) return 0;

	// 文字列として扱うために変換（念のため）
	const timeStr = String(t);

	// もし数値だけなら、そのまま整数にして返す
	if (/^\d+$/.test(t)) {
		return parseInt(t, 10);
	}

	// 2. 正規表現で時間、分、秒を抽出
	let totalSeconds = 0;
	const h = timeStr.match(/(\d+)h/);
	const m = timeStr.match(/(\d+)m/);
	const s = timeStr.match(/(\d+)s/);

	if (h) totalSeconds += parseInt(h[1], 10) * 3600;
	if (m) totalSeconds += parseInt(m[1], 10) * 60;
	if (s) totalSeconds += parseInt(s[1], 10);

	return totalSeconds;
}




/**
 * ユーザー入力されたURLから動画IDを解析し、UIの更新処理を実行する。
 * @description
 * - 対応形式: 標準URL, Shorts, 埋め込み, プレイリスト。
 * - 解析後のIDをグローバル変数 `currentVideoId` に格納し、表示を同期。
 * - 解析失敗時は入力欄をリセットし、表示エリアを隠す。
 * @returns {void}
 */
function processInput() {
	const urlInput = document.getElementById('videoUrl');
	if (!urlInput) return;

	// inputが存在する場合のみ値をトリムして取得
	const url = urlInput ? urlInput.value.trim() : "";
	if (!url) return;

	console.log("Input URL:", url);

	// 解析を実行し、結果（オブジェクト）を analysisResult に入れる
	const analysisResult = analyzeYouTubeUrl(url);
	// 解析結果から中身を取り出す（分割代入）
	const { videoId, isShorts, playlistId, startTime } = analysisResult;

	console.log("解析結果 obj :",  analysisResult);

	// プレイリストがあれば出す（独立させる）
	const plSection = document.getElementById('playlistSection');
	if (playlistId) {
		fetchPlaylist(playlistId);
		if (plSection) plSection.classList.remove('hidden');
	} else {
		if (plSection) plSection.classList.add('hidden');
	}

	console.log("PlayList Output is done!");


	// 動画IDがあればメインコンテンツを表示
	if (videoId) {
		console.log("loadVideo呼び出しルーチンに入った");

		currentVideoId = videoId;

		const eStartInput = document.getElementById('eStart');
		if (eStartInput) eStartInput.value = startTime;

		// モード切替（Shorts判定をここに集約）
		handleModeSwitch(isShorts);

		// サイズ切り替え関数を呼び出す
		updateMainLayout(isShorts);

		// 動画・画像読み込み
		loadVideo(videoId, startTime, isShorts, true);

		// サイズ入力欄連動 Shortsなら縦長、通常なら横長のサイズをセット
		isShorts ? setEmbedSize(315, 560) : setEmbedSize(560, 315);

		//結果エリア全体を表示する
		const resArea = document.getElementById('resultArea');
		if (resArea) resArea.classList.remove('hidden');

		// タブの復元と出力更新
		const lastTab = localStorage.getItem('yt_last_tab') || 'thumb';
		updateEmbedOutputs();
		switchTab(lastTab);

	} else {
		console.log("loadVideo呼び出し失敗");

		// 1. 入力をクリアしてヒントを出す
		urlInput.value = "";
		urlInput.placeholder = '正しいURLを入力してください';

		// 2. 前の結果を隠す
		const resArea = document.getElementById('resultArea');
		if (resArea) resArea.classList.add('hidden');

		const plSection = document.getElementById('playlistSection');
		if (plSection) plSection.classList.add('hidden');

		// 3. グローバル変数をリセットする
		currentVideoId = null;
	}
}


/**
 * ショート動画かどうかに応じて、レイアウトのクラスを切り替える
 * @param {boolean} isShorts - ショート動画判定フラグ
 */
function updateMainLayout(isShorts) {
	const wrapper = document.getElementById('main-card-wrapper');
	if (wrapper) wrapper.classList.toggle('is-shorts', !!isShorts);
}


/**
 * 通常動画とShortsでボタンセット（表示/非表示）を切り替える
 * @param {boolean} isShorts - ショート動画判定
 */
function handleModeSwitch(isShorts) {
	const el = {
		normal: document.getElementById('normalControls'),
		shorts: document.getElementById('shortsControls'),
		eWidth: document.getElementById('eWidth'),
        eHeight: document.getElementById('eHeight')
	};

	if (!el.normal || !el.shorts || !el.eWidth || !el.eHeight) return;

	// 1. 表示の切り替え
	el.normal.classList.toggle('hidden', !!isShorts);
	el.shorts.classList.toggle('hidden', !isShorts);

	// 2. モードが変わった場合のみ、サイズを「標準」に上書きする
    if (isShorts) {
        // ショート動画の標準（縦長）
        el.eWidth.value = 315;
        el.eHeight.value = 560;
    } else {
        // 通常動画の標準（横長）
        el.eWidth.value = 560;
        el.eHeight.value = 315;
    }

    // 3. 【重要】サイズを変えたので、タグの出力を更新する
    updateEmbedOutputs();
	updateSizeButtonStyles();
}


/**
 * AssetsタブとEmbedタブの表示切り替え
 * @description
 * タブの表示状態（アクティブクラス）とコンテンツの可視性を切り替えます。
 * ユーザーの体感速度を優先し、重い更新処理と保存は非同期で行います。
 * @param {'thumb' | 'embed'} t - 切り替えるタブの識別子
 */
function switchTab(t) {
	const elThumb  = document.getElementById('tabThumb');
	const elEmbed  = document.getElementById('tabEmbed');
	const conThumb = document.getElementById('contentThumb');
	const conEmbed = document.getElementById('contentEmbed');

	if (!elThumb || !elEmbed || !conThumb || !conEmbed) return;

	// 見た目の変化（クラスの付け替え） UX優先
	elThumb.classList.toggle('tab-active', t === 'thumb');
	elEmbed.classList.toggle('tab-active', t === 'embed');
	conThumb.classList.toggle('hidden', t !== 'thumb');
	conEmbed.classList.toggle('hidden', t !== 'embed');

	// 同じタブの場合、処理を省略
	const lastTab = localStorage.getItem('yt_last_tab');
    if (lastTab === t) {
        console.log("Tab is already active, skipping storage/update.");
        return;
    }

	// 別のタブなら状態を保存
	setTimeout(() => {
		localStorage.setItem('yt_last_tab', t);
		console.log(`Tab switched to: ${t} (No content regeneration needed)`);
	}, 0);
}






// だいぶリファクタりんした。また明日ここから↓↓↓↓↓↓↓↓ 3/９　


/**
 * 指定された動画IDのデータを取得し、UI（スライダーやメタ情報）を更新する
 * @param {string} id - YouTubeの11桁の動画ID
 * @param {boolean} [shouldScroll=false] - 更新後にスライダーを左端へスクロールさせるか
 * @returns {Promise<void>} 非同期処理の完了を待機
 */
async function loadVideo(id, startTime = 0, isShorts = false, shouldScroll = false) {
	console.log("loadVideo 開始! ID:", id, "StartTime:", startTime, "isShorts:", isShorts); // 動いているか確認用


	// --- 1. 既存プレイヤーのクリーンアップ ---
    /** @type {YT.Player|null} 既存のプレイヤーを取得して安全に破棄する */
    const existingPlayer = getSafePlayer();
    if (existingPlayer) {
        try {
            existingPlayer.destroy();
            console.log("既存のプレイヤーを破棄しました");
        } catch (e) {
            console.warn("破棄エラー:", e);
        }
        window.player = null; // 参照をクリア
    }


	// startTime（秒）を画面の入力欄に反映させる
    const startTimeInput = document.getElementById('eStart');
	if (startTimeInput) {
        startTimeInput.value = startTime;
    }

	// どんな経路（検索・履歴・プレイリスト）で動画を読み込んでも、まず掃除する
	resetAppState();
	// メイン再生画面をショート動画のサイズにする
	updateMainLayout(isShorts);
	// モード切替（Shorts判定をここに集約）
	isCurrentShorts = isShorts;
	handleModeSwitch(isShorts);

	// 今のプレイヤーが持っている動画IDを取得（YouTube APIの機能を使う）
	let currentIdInPlayer = "";
	if (window.player && typeof window.player.getVideoData === 'function') {
		currentIdInPlayer = window.player.getVideoData().video_id;
	}

	// 同じIDでも、結果エリアが隠れている（＝まだ表示されていない）なら続行する
	const resArea = document.getElementById('resultArea');
	const isHidden = resArea ? resArea.classList.contains('hidden') : true;

	// 「今表示されているID」と「これから読み込むID」が違うなら、必ず続行する
	if (id === currentIdInPlayer && !isHidden) {
		console.log("今表示中の動画と同じなので、リロードをスキップします");
		return;
	}

	// ここで初めて、グローバル変数を更新する
	currentVideoId = id;
	// 履歴を保存
	saveHistory(id, startTime, isShorts);

	document.getElementById('resultArea').classList.remove('hidden');
	resetPlayer();

	if (typeof updateEmbedOutputs === 'function') {
	    updateEmbedOutputs();
	}


	// --- 動画タイトル取得 ---
	currentVideoTitle = await fetchVideoTitle(id);

	// 画面表示を更新
	const titleEl = document.getElementById('vTitle');
	if (titleEl) titleEl.innerText = currentVideoTitle;

	// // --- 動画タイトル取得 (APIキー不要のoEmbedを使用) ---
	// try {
	// 	const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
	// 	if (!response.ok) throw new Error("メタデータの取得に失敗");

	// 	const data = await response.json();
	// 	currentVideoTitle = data.title; // シェア用に変数へ保存

	// 	// 画面上にタイトル表示要素があれば更新
	// 	const titleEl = document.getElementById('vTitle');
	// 	if (titleEl) titleEl.innerText = currentVideoTitle;

	// } catch (error) {
	// 	const titleEl = document.getElementById('vTitle');
	// 	if (titleEl) {
    //     	titleEl.innerHTML = `<span style="color:orange;">⚠ タイトルを取得できませんでした</span>`;
	// 	}
	// 	currentVideoTitle = "動画読み込みエラー";
	// }

	// 1. まずプレースホルダーにサムネイルをセットして表示する
	const placeholder = document.getElementById('player-placeholder');
	const img = document.getElementById('placeholder-img');
	if (img) img.src = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
	if (placeholder) placeholder.style.opacity = "1";





	// --- プレイヤーの初期化 ---
	// player = new YT.Player('player', {
	window.player = new YT.Player('player', {
		height: '100%',
		width: '100%',
		videoId: id,
		playerVars: {
			'rel': 0,          // 関連動画を自分のチャンネルのみに
			'playsinline': 1,   // モバイルで全画面表示にさせない
			'start': startTime, // 開始時間をセット
			'autoplay': 1,      // 自動再生


			// 'controls': 0,      // コントロール非表示
			// 'modestbranding': 1, // YouTubeロゴを隠す（完全には消えない）
			// 'disablekb': 1,     // キーボード操作を無効化
			// 'fs': 0,            // 全画面ボタンを消す
			// 'iv_load_policy': 3, // 動画内の注釈を消す
			// 'cc_load_policy': 0, // 字幕を表示しない
			// 'origin': window.location.origin, // セキュリティ対策（必要に応じて）
			// 'widget_referrer': window.location.href, // 参照元URLを送る（必要に応じて）
			// 'enablejsapi': 1,   // JavaScript APIを有効にする（これがないとAPIが動かない）
			// 'html5': 1,         // HTML5プレイヤーを強制する（ほとんどのブラウザでこれがデフォルト）
			// 'version': 3,       // プレイヤーのバージョン（通常は3で問題ない）
			// 'origin': 'https://www.example.com', // セキュリティ対策（必要に応じて）
			// 'widget_referrer': 'https://www.example.com', // 参照元URLを送る（必要に応じて）
		},
		events: {
			// 'onReady': () => updateEmbedOutputs()
			// 'onReady': () => {
			//      console.log("Player is ready."); // 中身をログだけにする
			// }
			'onReady': onPlayerReady,
			'onStateChange': onPlayerStateChange
		}
	});


	// --- 画像の存在チェック (リファクタリング版) ---

	// 1. テンプレートからURL付きの候補リストを作成
	const candidates = THUMBNAIL_TEMPLATES.map(t => {
		// webpが含まれるパスは i.ytimg.com、それ以外は img.youtube.com を使う
		const domain = t.path.includes('webp') ? 'i.ytimg.com' : 'img.youtube.com';

		return {
			...t,
			url: `https://${domain}/${t.path.replace('ID', id)}`
		};
	});

	// 2. 全候補を一斉にチェック（爆速並列処理）
	const checkPromises = candidates.map(async (c) => {
		const isValid = await validateYouTubeImage(c.url);
		return isValid ? c : null;
	});

	// 3. 全て完了するのを待って、有効なものだけ抽出
	const results = await Promise.all(checkPromises);
	assetList = results.filter(res => res !== null);

	// --- スライダーの表示更新 ---
    updateThumbnailSliderUI(assetList);


	// --- メインの結果エリアへスクロール ---
	if (shouldScroll) {
		window.scrollTo({
			top: document.getElementById('resultArea').offsetTop - 20,
			behavior: 'smooth'
		});
	}
}


/**
 * 動画のタイトルを非同期で取得する
 * @param {string} id - 動画ID
 * @returns {Promise<string>} 動画タイトル（失敗時は予備のタイトル）
 */
async function fetchVideoTitle(id) {
    try {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
        if (!response.ok) throw new Error("取得失敗");
        const data = await response.json();
        return data.title;
    } catch (error) {
        console.warn("タイトルの取得に失敗:", error);
        return "YouTube Video"; // 失敗した時のバックアップ
    }
}



/**
 * 取得したアセットリストを元にスライダーのUIを更新する
 * @param {Array} assets - 有効な画像のリスト
 */
function updateThumbnailSliderUI(assets) {
    const slider = document.getElementById('mainSlider');
    if (!slider) return;

    // HTMLの組み立て
    slider.innerHTML = assets.map(a => `
        <div class="slide-item-container ${a.isScene ? 'is-scene' : 'is-main'}">
            <img src="${a.url}" class="${a.isScene ? 'slide-item-natural' : 'slide-item-fit'}" loading="lazy">
        </div>
    `).join('');

    // スクロール位置のリセットとドットの更新
    slider.scrollTo(0, 0);
    if (typeof updateDots === 'function') {
        updateDots('mainSlider', 'mainIndicator', 1);
    }
}


/**
 * 現在の YouTube プレイヤーインスタンスが安全に操作可能な状態か確認し、取得する。
 * プレイヤーが初期化されていない、または破棄されている場合は null を返す。
 * * @returns {YT.Player|null} 有効な YouTube プレイヤーインスタンス、または null
 */
function getSafePlayer() {
    // 1. window.player が存在するか
    // 2. 破壊用メソッド (destroy) が関数として存在するか（＝初期化完了しているか）
    const isAvailable = window.player && typeof window.player.destroy === 'function';

    return isAvailable ? window.player : null;
}


/**
 * 指定されたURLの画像が有効（YouTubeの404用画像でない）か判定する
 * @param {string} url - チェックする画像のURL
 * @returns {Promise<boolean>} 有効ならtrue, 無効または失敗ならfalse
 */
function validateYouTubeImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img.width > 120); // 404画像除外
        img.onerror = () => resolve(false);
        img.src = url;
        setTimeout(() => resolve(false), 3000); // 3秒タイムアウト
    });
}



/**
 * loadVideo関数から、プレイヤーの準備が完了した時に呼ばれる
 */
function onPlayerReady(event) {
	console.log("YouTube Player is Ready!");
	// 必要ならここでミュートにしたり再生したりできるよ
}

// loadVideo関数から、プレイヤーの状態が変わった時のイベント（API作成時に登録しておく）
function onPlayerStateChange(event) {
	console.log("Player State:", event.data);

	/** @type {boolean} ループ設定が有効かどうか (要素がない場合はfalse) */
	const isLoop = document.getElementById('checkLoop')?.checked ?? false;

	// 再生終了(0)になったとき、ループ設定がONならプレイヤーの動画を最初から再生する
    if (event.data === YT.PlayerState.ENDED && isLoop) {
        event.target.playVideo();
        // もし「開始時間」に戻したいなら
        // event.target.seekTo(startTime);
    }

	// 1: 再生開始 (PLAYING) または 3: バッファ中 (BUFFERING)
	if (event.data == YT.PlayerState.PLAYING) {
		const placeholder = document.getElementById('player-placeholder');
		if (placeholder) {
			placeholder.style.opacity = "0"; // スッと消す
			setTimeout(() => placeholder.classList.add('hidden'), 500); // 完全に消去
		}
	}
}




/**
 * 指定されたプレイリストIDから動画一覧を取得し、履歴風のカードUIを生成・表示する。
 * 内部で PHP API (get_playlist.php) を呼び出し、結果を #playlistList にレンダリングする。
 * * @async
 * @function fetchPlaylist
 * @param {string} listId - 取得対象のYouTubeプレイリストID。
 * @returns {Promise<void>}
 */
async function fetchPlaylist(listId) {
    const section = document.getElementById('playlistSection');
    const list = document.getElementById('playlistList');
    const indicator = document.getElementById('playlistIndicator');

    if (!section || !list) return;

    // セクションを表示状態にし、ローディング表示を開始
    section.classList.remove('hidden');
    list.innerHTML = `<p class="text-[10px] animate-pulse p-4 font-bold tracking-widest">SYNCHRONIZING...</p>`;

    try {
        // 自前サーバーのPHPエンドポイントへリクエスト
        const url = `api/get_playlist.php?id=${listId}`;
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error("PLAYLIST_NOT_FOUND");
            } else {
                throw new Error(`SERVER_ERROR: ${response.status}`);
            }
        }

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            // 1. 各動画アイテムをカード形式のHTMLに変換
            list.innerHTML = data.items.map(item => {
                const snippet = item.snippet || {};
                const videoId = snippet.resourceId ? snippet.resourceId.videoId : (item.videoId || null);
                const title = snippet.title || 'NO_TITLE';

                // --- 追加：タイトルからShortsかどうかを簡易判定 ---
                const isShorts = title.toLowerCase().includes('#shorts');

                if (!videoId) return '';

                // History（閲覧履歴）と同じデザインのカード構造を生成
                return `
                <div class="item-card rounded md:rounded-xl overflow-hidden
				flex-shrink-0 w-[140px] md:w-[180px] cursor-pointer group/item active:scale-95 transition-transform"
                     onclick="loadVideo('${videoId}', 0, ${isShorts}, true)">

                        <img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg"
							class="w-full aspect-video object-cover rounded md:rounded-md shadow-sm"
                            alt="thumbnail"
                            loading="lazy">
                    <div class="mt-2 px-1">
                        <p class="text-[9px] font-mono text-gray-500 tracking-widest uppercase line-clamp-1 opacity-80">
                            ${title}
                        </p>
                    </div>
                </div>`;
            }).join('');


			// ここでマウスホイールの横スクロール変換を有効にする
			enableHorizontalWheel('playlistList');

            // 2. スクロールに応じたドットインジケーターの更新設定
            list.onscroll = () => updateDots('playlistList', 'playlistIndicator', 1);
            updateDots('playlistList', 'playlistIndicator', 1);

        } else {
            list.innerHTML = `<p class="text-[10px] p-4 text-gray-400 font-bold">EMPTY_PLAYLIST</p>`;
        }
    } catch (e) {
        console.error("Playlist render error:", e);
        list.innerHTML = `<p class="text-[10px] p-4 text-red-500 font-bold">\>_ CONNECTION_FAILED: ${e.message}</p>`;
    }


}



/**
 * 指定された要素に対して、マウスホイールの上下入力を横スクロールに変換する機能を付与する。
 * 末尾の multiplier でスクロール速度を調整可能。
 * @function enableHorizontalWheel
 * @param {string} elementId - 横スクロールを有効にしたいHTML要素のID。
 * @example
 * enableHorizontalWheel('playlistList');
 * enableHorizontalWheel('historyList');
 */
function enableHorizontalWheel(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // addEventListener ではなく onwheel を使うことで、
    // 2回呼んでも「上書き」されるだけになり、重複や爆走を防げます。
    el.onwheel = function(e) {
        if (e.deltaY !== 0) {
            // 縦スクロールをキャンセル
            e.preventDefault();

			// 横スクロールに変換
            // el.scrollLeft += e.deltaY;

			// スピード倍率（1.5 〜 2.5 くらいが快適です）
            const multiplier = 1.5;
            el.scrollLeft += e.deltaY * multiplier;
        }
    };
}



// /**
//  * プレイリストの中身を履歴風のカードで表示する
//  */
// async function fetchPlaylist(listId) {
// 	const section = document.getElementById('playlistSection');
// 	const list = document.getElementById('playlistList');
// 	const indicator = document.getElementById('playlistIndicator');

// 	if (!section || !list) return;

// 	section.classList.remove('hidden');
// 	// 親要素に relative をつけて、ボタンを左右に固定する準備
// 	//section.className = "mt-12 border-t border-black/10 pt-8 relative group";

// 	list.innerHTML = `<p class="text-[10px] animate-pulse p-4 font-bold tracking-widest">SYNCHRONIZING...</p>`;

// 	try {
// 		// const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${listId}&key=${YOUTUBE_API_KEY}`;
// 		const url = `api/get_playlist.php?id=${listId}`;
// 		const response = await fetch(url);

// 		// if (!response.ok) throw new Error(`HTTP_ERROR: ${response.status}`);

// 		if (!response.ok) {
// 			if (response.status === 404) {
// 				throw new Error("PLAYLIST_NOT_FOUND (IDを確認してください)");
// 			} else {
// 				throw new Error(`SERVER_ERROR: ${response.status}`);
// 			}
// 		}

// 		const data = await response.json();

// 		if (data.items) {
// 			// 1. カードの生成
// 			list.innerHTML = data.items.map(item => {
// 				// const videoId = item.snippet.resourceId?.videoId;
// 				// if (!videoId) return '';

// 				const isObj = (typeof item.snippet === 'object' && item.snippet !== null);
// 				const videoId = isObj ? item.snippet.id : item.snippet;
// 				//const startTime = isObj ? (item.start || 0) : 0;
// 				const isShorts = isObj ? (item.snippet.isShorts || false) : false;

// 				// タイトルを安全に取得（もしあれば）
// 				const title = item.snippet.title || 'NO_TITLE';


// 				return `
// 				<div class="item-card rounded md:rounded-xl overflow-hidden" onclick="loadVideo('${videoId}', 0, ${isShorts}, true)">
// 					<img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg"
// 						class="w-full aspect-video object-cover rounded md:rounded-md shadow-sm"
// 						alt="thumbnail">

// 					<div class="flex items-baseline mt-1.5 mb-1.5 pl-2 font-mono text-gray-500">

// 						<span class="inline-block transform translate-y-[1.5px] text-[9px] tracking-widest opacity-80">
// 							${title}
// 						</span>
// 					</div>
// 				</div>`;


// 				// return `
// 				// 	<div class="item-card flex-shrink-0 w-[180px] snap-start cursor-pointer group/item active:scale-95 transition-transform"
// 				// 		onclick="loadVideo('${vId}', undefined, true)">
// 				// 		<div class="relative overflow-hidden rounded-2xl bg-black/[0.03] border border-black/[0.05]">
// 				// 			<img src="https://img.youtube.com/vi/${vId}/mqdefault.jpg"
// 				// 				class="w-full aspect-video object-cover transition-all duration-500 group-hover/item:scale-110"
// 				// 				loading="lazy">
// 				// 			<div class="absolute inset-0 bg-black/0 group-hover/item:bg-black/5 transition-colors"></div>
// 				// 		</div>
// 				// 		<p class="text-[10px] mt-3 font-medium text-black/60 line-clamp-2 uppercase tracking-[0.1em] leading-relaxed">
// 				// 			${title}
// 				// 		</p>
// 				// 	</div>
// 				// `;
// 			}).join('');

// 			// 2. ボタンの生成（Historyと全く同じ構造）
// 			// 二重に作られないように一度消してから追加
//  // 2. ボタンの生成（Historyと完全に一致、矢印の色をblackへ）
// 			// section.querySelectorAll('.nav-btn').forEach(btn => btn.remove());

// 			// const prevBtn = `
// 			// 	<div class="nav-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 transition-opacity"
// 			// 		 style="left:-10px; top:45%; position:absolute; z-index:50;"
// 			// 		 onclick="moveSlide('playlistList', -1)">
// 			// 		<div class="arrow !w-1.5 !h-1.5"
// 			// 			 style="transform:rotate(-135deg); border-top:2px solid black; border-right:2px solid black;"></div>
// 			// 	</div>`;

// 			// const nextBtn = `
// 			// 	<div class="nav-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 transition-opacity"
// 			// 		 style="right:-10px; top:45%; position:absolute; z-index:50;"
// 			// 		 onclick="moveSlide('playlistList', 1)">
// 			// 		<div class="arrow !w-1.5 !h-1.5"
// 			// 			 style="transform:rotate(45deg); border-top:2px solid black; border-right:2px solid black;"></div>
// 			// 	</div>`;

// 			// section.insertAdjacentHTML('beforeend', prevBtn);
// 			// section.insertAdjacentHTML('beforeend', nextBtn);

// 			// 3. ドットの連動
// 			list.onscroll = () => updateDots('playlistList', 'playlistIndicator', 1);
// 			updateDots('playlistList', 'playlistIndicator', 1);
// 		}
// 	} catch (e) {
// 		console.error("Playlist render error:", e);
// 		list.innerHTML = `<p class="text-[10px] p-4 text-red-500 font-bold">\>_ CONNECTION_FAILED: ${e.message}</p>`;
// 	}
// }





/**
 * 実際にカードとドットを描画する共通関数
 */
function renderPlaylistCards(items) {
	const listContainer = document.getElementById('playlistList');
	const indicator = document.getElementById('playlistIndicator');

	listContainer.innerHTML = items.map(item => `
		<div class="item-card flex-shrink-0 w-[160px]" onclick="loadVideo('${item.id}', undefined, ${isShorts}, true)">
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

	console.log("updateThumbOutputs called with URL:", url, "Label:", label);

	// 最新の値を取得（引数がなければ現在の変数を参照）
	const targetUrl = url || currentImgUrl;
	const targetLabel = label || currentImgLabel || "Thumbnail";
	const targetVideoUrl = `https://www.youtube.com/watch?v=${currentVideoId}`;



	container.innerHTML = `
		<div class="nothing-card p-5 space-y-6">
			${createOutputRow(
				'HTML Image Tag (img)',
				`<img src="${targetUrl}" alt="${targetLabel}">`
			)}

			${createOutputRow(
				'HTML Image Tag (a + img)',
				`<a href="${targetVideoUrl}" target="_blank"><img src="${targetUrl}" alt="${targetLabel}"></a>`
			)}

			${createOutputRow(
				'Markdown Link',
				`[![${targetLabel}](${targetUrl})](${targetVideoUrl})`
			)}

			${createOutputRow(
				'Direct Asset URL',
				targetUrl
			)}
		</div>
	`;
}



/**
* Embed タグおよび各種共有用URLの生成・出力
 * 埋め込み設定（動画ID、ループ、サイズ、開始時間）を現在のUI状態から取得
 * プレビュー用バッジの更新、および4種類（Embed/Short/Standard/Short URL）の出力エリアを生成・更新する。
 * * 取得パラメータ:
 * - currentVideoId: 現在選択されているYouTube動画ID
 * - checkLoop: ループ再生の有効/無効
 * - eWidth / eHeight: 埋め込みプレイヤーの縦横サイズ
 * - eStart: 再生開始位置（秒）
 * 以下の出力エリアを動的に生成してUIに反映します。
 * 1. Embed Code (iframeタグ)
 * 2. Shorts URL (Shorts専用形式 - Shortsモード時のみ)
 * 3. Standard URL (watch?v=形式 - パラメータ保持用)
 * 4. Short URL (youtu.be形式 - 短縮共有用)
 * * @returns {void}
 */
function updateEmbedOutputs() {
	// 動画IDが未定義、または空の場合は処理を中断
	if (typeof currentVideoId === 'undefined' || !currentVideoId) {
		return;
	}

	/** @type {string} 現在の動画ID */
	const videoId = currentVideoId; // すでに保持している動画ID変数

	/** @type {boolean} ループ設定が有効かどうか */
	const isLoop = document.getElementById('checkLoop').checked;

	/** @type {string} 埋め込みプレイヤーの幅（デフォルト 560） */
    const w = document.getElementById('eWidth')?.value || "560";
    /** @type {string} 埋め込みプレイヤーの高さ（デフォルト 315） */
    const h = document.getElementById('eHeight')?.value || "315";

    /** @type {string} 開始位置の入力値（文字列） */
    const s = document.getElementById('eStart')?.value || "0";
    /** @type {number} 数値に変換した開始秒数 */
    const startSeconds = parseInt(s, 10) || 0;

	// --- 状態更新 ---

    // 時間表示用バッジ（例: 01:23～）の更新
	updateTimeBadge(startSeconds);

	// プレイヤーが存在し、かつシーク可能なら移動させる
	if (typeof player !== 'undefined' && player && typeof player.seekTo === 'function') {
		// 第2引数を true にすると、シーク先がまだバッファされてなくても強制的に移動する
		// player.seekTo(startSeconds, true);
	}


	// --- 各種URLの構築 ---

	// 1. 埋め込み用URL (iframeのsrc用)
    // start: 開始位置, rel=0: 関連動画を同じチャンネルからのみにする
	let embedUrl = `https://www.youtube.com/embed/${videoId}?start=${startSeconds}&rel=0`;
    if (isLoop) {
		// ループにはloop=1と、同一IDを含むplaylistパラメータの両方が必要
		embedUrl += `&loop=1&playlist=${videoId}`;
    }


	// 2. 標準URL (ブラウザ視聴用: watch?v= 形式または shorts/ 形式にする)
	// ショート動画であっても、ループや時間指定を確実に反映させるために使用
	let standardUrl = `https://www.youtube.com/watch?v=${videoId}`;
	if (startSeconds > 0) {
        standardUrl += `&t=${s}s`;
    }
	if (isLoop) {
        standardUrl += `&loop=1&playlist=${videoId}`;
    }

	/** * 3. 短縮URL (youtu.be形式)
     * SNS等の文字数制限がある場所での共有用。
     */
    let youtuBeUrl = `https://youtu.be/${videoId}`;
    if (startSeconds > 0) {
        // youtu.be形式の場合、パラメータの開始は "?" となる点に注意
        youtuBeUrl += `?t=${s}`;
    }


	/** * 4. Shorts専用URL (youtube.com/shorts/形式)
     * アプリ等での視聴に最適化。パラメータは原則付与しない。
     */
	let shortsUrl = "";
	if (isCurrentShorts) {
		shortsUrl = `https://www.youtube.com/shorts/${videoId}`;
	}



	// 4. iframeタグの組み立て
	const embedCode = `<iframe width="${w}" height="${h}" src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;


	// --- UI（DOM）へのレンダリング ---

	/** @type {HTMLElement|null} 出力エリアのコンテナ */
	const outDisplay = document.getElementById('embedOutputAreas');
	if (outDisplay) {
		// URL行の生成（createOutputRow関数でフォームとボタンを組み込み）
		const standardUrlRow = createOutputRow("Standard URL", standardUrl);
		const youtuBeUrlRow = createOutputRow("Short URL (youtu.be)", youtuBeUrl);
		let shortsUrlRow = "";
		if (isCurrentShorts) {
			shortsUrlRow = createOutputRow("Shorts URL (youtube.com/shorts/)", shortsUrl);
		}

		// 埋め込みコード用のHTML（textareaを含む）
		const embedTagRow = `
			<div class="space-y-1.5">
				<label class="pl-[12px] text-[9px] text-gray-400 block uppercase font-bold tracking-wider">Embed Code (iframe)</label>
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

		// 全ての要素をまとめて出力エリアに反映（shortsUrlRow が空文字なら何も表示しない）
		outDisplay.innerHTML = `
			<div class="space-y-4 mt-4">
				${embedTagRow}
				${standardUrlRow}
				${youtuBeUrlRow}
				${shortsUrlRow ? shortsUrlRow : ""}
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
 * 秒数入力欄をいじった時だけ呼ばれる関数
 */
function handleStartSecondsChange() {
	// 1. まずはテキスト（埋め込みコード）を更新
	updateEmbedOutputs();

	// 2. 秒数を取得して、プレイヤーを動かす（これが「手動」の時だけ発動する）
	const s = document.getElementById('eStart')?.value || "0";
	const startSeconds = parseInt(s) || 0;

	if (typeof player !== 'undefined' && player && typeof player.seekTo === 'function') {
		player.seekTo(startSeconds, true);
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

		// ここで条件分岐を整理するよ
		if (type === 'w' || type === 'h') {
			resizeEmbed(type);
			// resizeEmbedの中で最終的にupdateEmbedOutputsが呼ばれるはずだから、ここではこれだけでOK
		} else if (type === 's') {
			// 秒数の時は、シーク機能付きの関数を呼ぶ！
			handleStartSecondsChange();
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
			//const isMatch = (currentW === btnW && currentH === btnH);
			// 文字列同士の比較なので、確実に一致させるために Number() で数値化して比較するのもアリ
			const isMatch = (Number(currentW) === Number(btnW) && Number(currentH) === Number(btnH));

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
 * チェックを切り替えた時に保存する
 * (HTMLのonchange="updateEmbedOutputs()" の中で呼ぶか、別途追加する)
 */
function saveLoopSetting() {
	/** @type {boolean} ループ設定が有効かどうか (要素がない場合はfalse) */
	const isLoop = document.getElementById('checkLoop')?.checked ?? false;
    localStorage.setItem('yt_loop_setting', isLoop);
}


/**
 * 動画IDと設定（ループ等）に基づいた埋め込みURLを生成する
 *
 * これだけだと動かない
 *
 * @description
 * YouTube埋め込みプレイヤーの仕様上、1動画のみでループさせる場合は
 * loop=1 に加えて playlist パラメータに自身の動画IDを指定する必要があります。
 * @param {string} videoId - YouTubeの動画ID
 * @returns {string} 各種パラメータが付与された埋め込みURL
 */
function getEmbedUrl(videoId) {
    if (!videoId) return '';

	/** @type {boolean} ループ設定が有効かどうか (要素がない場合はfalse) */
	const isLoop = document.getElementById('checkLoop')?.checked ?? false;

    // 基本となるURL（rel=0 は関連動画を自分のチャンネル内に限定する指定）
    let url = `https://www.youtube.com/embed/${videoId}?rel=0`;

    // ループ設定が有効な場合、仕様に合わせたパラメータを追加
    if (isLoop) {
        url += `&loop=1&playlist=${videoId}`;
    }

    return url;
}







function resetPlayer() {
	document.getElementById('player-wrapper').innerHTML = '<div id="player"></div>';
}

function clearInput() {
	document.getElementById('videoUrl').value = "";
	document.getElementById('resultArea').classList.add('hidden'); currentVideoId = "";

	resetAppState();
}

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






/* ───────────────────────────────────────────
	 HISTORY
─────────────────────────────────────────── */

/**
 * localStorageから視聴履歴を読み込み、ヒストリーリスト（スライダー）を生成する。
 * 各アイテムには動画ID、開始時間、Shorts判定が含まれる。
 * モバイルとPCで角丸（rounded）のサイズを切り替えるレスポンシブ対応。
 * @returns {void}
 */
function loadHistory() {
/** @type {Array<{id: string, start: number, isShorts: boolean}>} 履歴データ */
    const h = JSON.parse(localStorage.getItem('yt_history') || '[]');
    const list = document.getElementById('historyList');

	if (!list || h.length === 0) return;

	// 履歴セクションを表示
    const historySection = document.getElementById('historySection');
    if (historySection) {
        historySection.classList.remove('hidden');
    }

	/**
     * 秒数を "0:00" 形式の文字列に変換する
     * @param {number} s 秒数
     * @returns {string} フォーマット済み時間
     */
    const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

	// 履歴アイテムのHTMLを生成
	list.innerHTML = h.map(item => {
		// データの整合性チェック（旧データ形式への対応）
        const isObj = (typeof item === 'object' && item !== null);
        const videoId = isObj ? item.id : item;
        const startTime = isObj ? (item.start || 0) : 0;
        const isShorts = isObj ? (item.isShorts || false) : false;


		return `
            <div class="item-card rounded md:rounded-xl overflow-hidden" onclick="loadVideo('${videoId}', ${startTime}, ${isShorts}, true)">
                <img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg"
                     class="w-full aspect-video object-cover rounded md:rounded-md shadow-sm"
                     alt="thumbnail">

                <div class="flex items-baseline mt-1.5 mb-1.5 pl-2 font-mono text-gray-500">
                    <span class="inline-block transform translate-y-[1.5px] bg-gray-100 text-[8px] px-1.5 py-0.5 mr-0.5 rounded-sm leading-none font-bold tracking-widest text-gray-500">
                        IN
                    </span>
                    <span class="inline-block transform translate-y-[1.5px] text-[9px] tracking-widest opacity-80">
                        ${fmt(startTime)}
                    </span>
                </div>
            </div>`;
    }).join('');


	// --- スクロール・インジケーター設定 ---

    // 重複防止のためにイベントリスナーを再設定
    list.removeEventListener('scroll', historyScrollHandler);
    list.addEventListener('scroll', historyScrollHandler);

    // 初回のドット更新
    updateDots('historyList', 'historyIndicator', 2.6);
}


// 履歴用スクロールイベントのハンドラ
function historyScrollHandler() {
		updateDots('historyList', 'historyIndicator', 2.6);
}


/**
 * HistoryセクションとPlaylistセクションで共通して使う関数
 * 指定した要素を横方向に「画面1枚分」スクロールさせる
 * * @param {string} id - スクロールさせる要素のHTML ID
 * @param {number} d - 移動方向（1: 次へ/右, -1: 前へ/左）
 * * @example
 * // 右に1画面分スクロール
 * moveSlide('history-list', 1);
 * * @example
 * // 左に1画面分スクロール
 * moveSlide('history-list', -1);
 */
// function moveSlide(id, d) {
//     const s = document.getElementById(id);
//     // clientWidth（表示幅）に方向を掛けることで、正確に1ページ分移動する
//     if (s) {
//         s.scrollBy({ left: d * s.clientWidth, behavior: 'smooth' });

//         // --- ここでドットの更新関数を呼ぶ ---
//         // スムーズスクロールが終わるのを少し待ってから判定するのがコツ
//         setTimeout(() => updateDots(s), 500);
//     }
// }
// /**
//  * 現在のインデックスから「d」分だけ移動し、ドットを更新する
//  */
// function moveSlide(id, d) {
//     const s = document.getElementById(id);
//     if (!s) return;

//     // 1. 現在のインデックスを正確に把握する
//     // (scrollWidth / childrenCount) で1枚あたりの理論上の幅を出す
//     const childrenCount = s.children.length;
//     const itemWidth = s.scrollWidth / childrenCount;
//     const currentIdx = Math.round(s.scrollLeft / itemWidth);

//     // 2. 次の目的地（ターゲットインデックス）を決める
//     let targetIdx = currentIdx + d;

//     // 3. 範囲外に行かないようにガード
//     if (targetIdx < 0) targetIdx = 0;
//     if (targetIdx >= childrenCount) targetIdx = childrenCount - 1;

//     // 4. その場所までスクロールさせる（scrollToを使う）
//     // scrollBy({left: d * s.clientWidth}) だとズレることがあるので、
//     // 計算した「targetIdx * itemWidth」へ直接飛ばすのが一番確実！
//     s.scrollTo({
//         left: targetIdx * itemWidth,
//         behavior: 'smooth'
//     });

//     // 5. ドットを即座に（または少し遅れて）更新
//     // ここで sId などを渡して updateDots を呼ぶ
//     // 例: updateDots(id, 'yourIndicatorId', yourRatio);
// }
// 1. moveSlide は元の「大きく動く」形に戻す
// function moveSlide(id, d) {
//     const s = document.getElementById(id);
//     if (s) {
//         s.scrollBy({ left: d * s.clientWidth, behavior: 'smooth' });
//         // スクロールが終わる頃に判定を呼ぶ
//         setTimeout(() => updateDots(id, 'indicatorId', ratio), 500);
//     }
// }

// // 2. updateDots の「idx」計算を「最後」に強くする
// // (updateDots関数の中の idx 計算部分を差し替え)

// // 判定の「遊び（マージン）」を作る
// const isAtEnd = (container.scrollLeft + container.clientWidth) >= (container.scrollWidth - 10); // 右端から10px以内なら「最後」とみなす

// let idx;
// if (isAtEnd) {
//     idx = childrenCount - 1; // 強制的に最後のインデックスにする
// } else {
//     const itemWidth = container.scrollWidth / childrenCount;
//     idx = Math.round(container.scrollLeft / itemWidth);
// }

/**
 * 現在のインデックスから「d」分だけ移動し、ドットを更新する
 */
function moveSlide(sId, d) {
	const container = document.getElementById(sId);
	if (!container) return;

	// 1. 現在のインデックスを計算
	const childrenCount = (sId === 'mainSlider' && typeof assetList !== 'undefined') ? assetList.length : container.children.length;
	const itemWidth = container.scrollWidth / childrenCount;
	const currentIdx = Math.round(container.scrollLeft / itemWidth);

	// 2. 次のターゲットを決める（1枚ずつではなく、画面に見えている分だけ動かしたいなら d * 数 を調整）
	// とりあえず1枚ずつならこれ：
	let targetIdx = currentIdx + d;

	// 3. もし「画面1枚分ガバッと」動かしたいなら、d に「一度に見えている枚数」を掛ける
	// const visibleItems = Math.round(container.clientWidth / itemWidth);
	// let targetIdx = currentIdx + (d * visibleItems);

	// 4. 範囲ガード
	targetIdx = Math.max(0, Math.min(targetIdx, childrenCount - 1));

	// 5. すでにある「scrollToIndex」を呼ぶ！
	scrollToIndex(sId, targetIdx);

	// 6. ドットの更新（indicatorのIDやratioが必要なら引数で調整してね）
	// setTimeout(() => updateDots(sId, 'indicatorのID', 4), 500);

	// スライダー要素を取得して、スクロールを監視する
	// const historyList = document.getElementById('historyList'); // IDは実際のものに

	// if (historyList) {
	// 	historyList.addEventListener('wheel', (e) => {
	// 		// 上下のスクロール（ホイール回転）が発生したら
	// 		if (e.deltaY !== 0) {
	// 			// 標準の「上下移動」をキャンセルして
	// 			e.preventDefault();
	// 			// 横方向にその分だけ動かす
	// 			historyList.scrollLeft += e.deltaY;
	// 		}
	// 	}, { passive: false }); // preventDefaultを使うために必要
	// }
}



/* ───────────────────────────────────────────
	 UPDATED CORE LOGIC
─────────────────────────────────────────── */

function updateDots(sId, iId, ratio = 1) {
	const container = document.getElementById(sId);
	const indicator = document.getElementById(iId);
	if (!container || !indicator) return;

	// 1. インデックスの計算
	const childrenCount = (sId === 'mainSlider' && typeof assetList !== 'undefined') ? assetList.length : container.children.length;

	// ratioを考慮しつつ計算
	// const itemWidth = (sId === 'mainSlider') ? (container.scrollWidth / childrenCount) : (container.clientWidth / ratio);
	// const idx = Math.round(container.scrollLeft / itemWidth);

	// const itemWidth = container.scrollWidth / childrenCount;
	// const idx = Math.round(container.scrollLeft / itemWidth);


	// 1. スクロールの限界値を計算 (全体幅 - 見えている幅)
	const maxScroll = container.scrollWidth - container.clientWidth;
	const isAtEnd = container.scrollLeft >= maxScroll - 5; // 5pxの遊び

	// 2. もし全くスクロールできない状態なら0番目
	let idx;
	if (isAtEnd) {
		idx = childrenCount - 1;
	} else {
		const itemWidth = container.scrollWidth / childrenCount;
		idx = Math.round(container.scrollLeft / itemWidth);
	}
	// if (maxScroll <= 0) {
	//     var idx = 0;
	// } else {
	//     // 3. 「現在の位置 / 最大値」で 0.0 〜 1.0 の割合を出す
	//     const scrollRatio = container.scrollLeft / maxScroll;
	//     // 4. 割合をアイテム数（インデックス）に変換
	//     var idx = Math.round(scrollRatio * (childrenCount - 1));
	// }

	// 念のため範囲内に収める
	idx = Math.max(0, Math.min(idx, childrenCount - 1));



	//console.log(`scrollLeft: ${container.scrollLeft}, calculatedIdx: ${idx}`);

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
 * ドットをクリックしたとき、または移動時に指定の画像までスクロールさせる
 */
function scrollToIndex(sId, index) {
	const container = document.getElementById(sId);
	if (!container) return;

	const childrenCount = (sId === 'mainSlider') ? assetList.length : container.children.length;

	let targetLeft;

	// もし指定されたのが「最後の要素」なら、計算をやめて「物理的な右端」を指定する
	if (index >= childrenCount - 1) {
		targetLeft = container.scrollWidth - container.clientWidth;
	} else {
		// それ以外は通常通りの計算
		targetLeft = (container.scrollWidth / childrenCount) * index;
	}

	container.scrollTo({
		left: targetLeft,
		behavior: 'smooth'
	});
}

/**
 * ドットをクリックしたときに指定の画像までスクロールさせる
 * htmlから呼び出される
 */
// function scrollToIndex(sId, index) {
//     const container = document.getElementById(sId);
//     if (!container) return;

//     const childrenCount = (sId === 'mainSlider') ? assetList.length : container.children.length;
//     const targetLeft = (container.scrollWidth / childrenCount) * index;

//     container.scrollTo({
//         left: targetLeft,
//         behavior: 'smooth'
//     });
// }





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









/* ───────────────────────────────────────────
	   LIGHTBOX PREVIEW FOR EMBED
─────────────────────────────────────────── */

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
			 style="width:${w}px; height:${h}px; min-width:${w}px;"min-height:${h}px; flex-shrink: 0;">
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
	 LOCAL STORAGE
─────────────────────────────────────────── */

/**
 * 動画視聴履歴をLocalStorageに保存する
 * @param {string} id - YouTubeの動画ID
 * @param {number|string} start - 再生開始位置（秒）
 * @param {boolean} isShorts - ショート動画かどうか
*/
function saveHistory(id, start, isShorts = false) {
	/** @type {Array<{id: string, start: number, isShorts: boolean}>} */
	let h = JSON.parse(localStorage.getItem('yt_history') || '[]');

	// すでに同じ動画IDがあれば削除（新しい秒数で上書きして先頭に持ってくるため）
	// 過去のデータが文字列(id)だけの場合も考慮してフィルタリング
	h = h.filter(item => {
		const itemId = (typeof item === 'object') ? item.id : item;
		return itemId !== id;
	});

	// 新しい履歴オブジェクトを作成
	const newEntry = {
		id: id,
		start: parseInt(start, 10) || 0,
		isShorts: isShorts
	};

	// 先頭に追加して最大15件に絞る
	h = [newEntry, ...h].slice(0, 15);

	localStorage.setItem('yt_history', JSON.stringify(h));

	// 画面上の履歴リスト表示を更新する関数を呼ぶ
	loadHistory();
}









/* ───────────────────────────────────────────
	 OTHERS (UTILITIES)
─────────────────────────────────────────── */


// 既存の履歴のURLを全部コピーする機能だけどこれどうするか検討
function copyAllHistory() {
	const h = JSON.parse(localStorage.getItem('yt_history') || '[]');
	navigator.clipboard.writeText(h.map(id => `https://youtu.be/${id}`).join('\n'));
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



// ==========================================
//  実行・初期化処理（スイッチを入れる場所）
// ==========================================

// ページが読み込まれたら最初に実行したいこと
document.addEventListener('DOMContentLoaded', () => {
    // 履歴は最初からHTMLに存在するので、ここでスイッチを入れる
    enableHorizontalWheel('historyList');

    // 他にも「最初から動いていてほしいもの」があればここに書く
});