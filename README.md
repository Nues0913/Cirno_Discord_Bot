# Cirno Discord Bot

Cirno Discord Bot 是一個 Discord 機器人，提供偵測語音頻道福音傳播(爛音樂)、本地音樂播放器、音樂資料庫串聯、複製文管理，以及 線上語言模型串聯功能。


## 安裝與啟動

使用 Node.js 22.12 以上版本

```bash
npm ci
npm run build
npm start
```

開發時執行 `npm run dev`；執行自動化測試使用 `npm test`。

`.env` 至少需有 `TOKEN`（Discord Bot token）與 `CLIENT_ID`（應用程式 ID）
```dotenv
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
TESTER_ID=your_discord_user_id
NVIDIA_API_KEY=your_nvidia_api_key
TAVILY_API_KEY=your_tavily_api_key
```


## 音樂播放器（本地與遠端）

將音檔放入 Bot 主機的 `assets/songs/`，加入一般語音頻道後使用 `/music play song:歌曲`。播放器透過 FFmpeg 解碼本地音檔。

| 指令 | 用途 |
| --- | --- |
| `/music play song:歌曲 source:local/remote next:true` | 自動完成選歌；沒有播放時開始，有播放時加入佇列；`next:true` 排在待播首位 |
| `/music library query:關鍵字` | 搜尋／分頁瀏覽曲庫，關鍵字可省略 |
| `/music queue` | 查看待播清單及點歌者 |
| `/music panel` | 取得面板連結；面板被刪除時，由同語音頻道成員重建 |
| `/music pause`、`/music resume` | 暫停／繼續，重複執行不會反向切換 |
| `/music skip`、`/music previous` | 下一首／上一首（本次工作階段保留最近 20 首紀錄） |
| `/music restart` | 目前歌曲從頭播放 |
| `/music seek seconds:90` | 跳到 1 分 30 秒，暫停時跳轉仍保持暫停 |
| `/music volume percent:50` | 指定 0–100% 音量 |
| `/music repeat mode:off/one/all` | 關閉／單曲／佇列循環 |
| `/music shuffle` | 打亂待播歌曲 |
| `/music remove position:2` | 移除第 2 首待播歌曲 |
| `/music move from:3 to:1` | 將第 3 首待播歌曲移到下一首 |
| `/music clear` | 清空待播佇列，保留目前歌曲與循環模式 |
| `/music stop` | 停止、清空佇列並離開 |
| `/music reload` | 手動重新掃描曲庫，所有伺服器成員皆可使用，無需加入語音頻道 |

公開面板提供暫停／繼續、上一首、下一首、從頭播放、循環（關閉／單曲／佇列）、打亂待播、選歌、佇列、音量及結束播放。曲庫與完整佇列只對操作的人顯示；曲庫每頁最多 25 首，佇列每頁 10 首。選單有效 15 分鐘，`!reload` 後請重新開啟個人選單；共用播放工作階段繼續運作。

- 同一語音頻道的成員可共同控制。另一頻道已有手動播放時，Bot 不會被點歌移動。
- 音量預設 70%，每次調整 10%，範圍 0–100%；不影響進場音樂音量。
- 單曲循環：自然播完會從頭重播；「下一首」仍會跳到下一首，沒有待播歌曲則結束。「從頭播放」可用於任何循環模式。
- 佇列循環：自然播完或按「下一首」都依序前進，最後一首回到清單開頭；只有一首時從頭重播。
- 循環關閉：播放或跳過最後一首後結束；「結束播放」在任何循環模式下都會停止並離開。
- 打亂只排列待播歌曲，最多可排入 100 首；支援重複點歌。批次加入會先檢查容量，超過上限時整批拒絕。上一首會將目前歌曲放回待播首位；若需要額外位置但佇列已滿，會提示先移除歌曲。
- 播放進度約每 15 秒更新，可用 `/music seek` 指定秒數；時間須小於總長。總長未知時仍可播放，但只能從頭播放。遠端串流跳轉會重新讀取並解碼到指定位置，因此比本地檔案慢，受原有載入逾時限制；慢速網路可改用 `REMOTE_MUSIC_MODE=download`。
- 播完立即離開；頻道沒有真人持續 60 秒，或暫停達 10 分鐘，也會自動結束。
- Bot 重啟不續播；舊面板會提示失效，使用 `/music play` 重新開始。
- 檔案損壞／移除會略過該曲目；連續三首失敗則結束。播放提示會顯示於面板。

手動工作階段期間（包含暫停與連線中），該伺服器的進場音樂觸發會暫時略過；結束後恢復監聽新的進場事件，不補播。不同伺服器互相獨立，手動點歌不改變進場曲序。

曲庫僅掃描目錄第一層，支援 `.webm`、`.opus`、`.ogg`、`.m4a`、`.mp3`、`.wav`。讀取標題、演出者與時長；缺少標籤時使用檔名。新增、移除或修改音檔後，等檔案複製完成再執行 `/music reload`。更新後重新開啟曲庫選單或輸入點歌搜尋，即可看到最新歌曲。Bot 啟動時會掃描一次，運行中不監聽目錄，也不定期補查；多人同時執行 reload 會共用同一次進行中的掃描。拒絕指向曲庫外的符號連結，不接受使用者輸入任意檔案路徑。

Bot 在語音頻道需要「查看頻道」「連線」「說話」；面板所在文字頻道需要「查看頻道」「傳送訊息」「嵌入連結」，討論串則需傳送討論串訊息權限。初版支援一般語音頻道，不支援 Stage 頻道或私訊播放。


## 個人播放清單

每位 Discord 使用者可擁有 **20 份清單，每份 100 首**，以 Discord 使用者 ID 歸屬，在此 Bot 的所有伺服器共用。每份都可混合本地與遠端歌曲，也可收藏重複歌曲。建立、瀏覽、編輯及刪除只對自己開放，不需要加入語音頻道；播放時仍需加入目前播放器所在的一般語音頻道，並遵守共用佇列的控制規則。

| 指令 | 用途 |
| --- | --- |
| `/playlist create name:通勤` | 建立新清單 |
| `/playlist list` | 查看自己的所有清單 |
| `/playlist show playlist:通勤` | 每頁 10 首，按鈕翻頁 |
| `/playlist rename playlist:通勤 name:下班` | 改名，自己的清單名稱不能重複 |
| `/playlist delete playlist:下班` | 顯示確認／取消按鈕；確認後刪除收藏，不刪音檔 |
| `/playlist add playlist:通勤 source:local/remote song:歌曲` | 從歌曲自動完成選單加入；遠端請先選來源 |
| `/playlist add-current playlist:通勤` | 收藏目前播放的歌曲 |
| `/playlist remove playlist:通勤 entry:歌曲` | 從自動完成選擇要移除的項目，重複歌曲可分別處理 |
| `/playlist move playlist:通勤 entry:歌曲 position:1` | 調整清單中的順序 |
| `/playlist save name:今晚的歌` | 將目前歌曲＋待播佇列另存成新清單（合計不能超過 100 首） |
| `/playlist play playlist:通勤 shuffle:true next:true` | 整份加入播放；隨機排序與插隊為選用，不修改原清單 |

清單指令的回覆僅本人可見，選單／刪除確認 15 分鐘後失效；可在自動完成搜尋自己的清單及項目。刪除確認後若清單已被其他操作更新，必須重新確認。播放清單仍是個人資料，但實際播放及佇列會顯示在伺服器共用面板。

播放前會重新查詢曲庫，無法取得的歌曲會略過並回報數量，不會自動刪除收藏。全部無法取得時不會開始播放。遠端項目會記住所屬 API 網址，避免切換曲庫後誤播同 ID 的其他歌曲；更換遠端網址或移動本地曲庫根目錄後，需重新加入受影響的收藏。

### 使用 Server 保存播放清單

在 Bot `.env` 設定以下兩個變數，所有 `/playlist` 管理操作就會使用 `music_server` 的清單 API，本地與遠端歌曲收藏都可保存在同一個 Server：

```dotenv
PLAYLIST_API_URL=https://your-music-server.example/
PLAYLIST_API_TOKEN=your_dedicated_playlist_bot_token
```

`PLAYLIST_API_TOKEN` 是 Server 的 **`PLAYLIST_BOT_TOKEN`**，至少 32 字元，與音檔讀取用的 `REMOTE_MUSIC_API_TOKEN` 及上傳管理金鑰不同。Server 的 `scripts/setup.sh` 會為缺少設定的安裝產生專用金鑰；請安全地提供給 Bot，不要提交到 Git 或交給 Discord 使用者。Server 需更新至支援清單 API 的版本，執行 `npm run db:generate`、`npm run db:migrate` 並重新啟動，或以 Docker 重新建置啟動並自動遷移。新增資料表不會刪除既有歌曲。

Bot 只會以 Discord interaction 的使用者 ID 呼叫清單 API；Server 驗證專用金鑰後限制清單擁有者。更新帶有版本，遇到其他操作造成衝突會提示重新讀取；寫入不會自動重試。已設定任一清單 API 變數但服務無法連線或設定不完整時，會明確失敗，**不會退回本地寫入**。HTTP 只適用於可信任本機／私人網路，跨主機請使用 HTTPS。

Server 模式的清單保存於 Server 的 SQLite；請備份並持久掛載 Server 的 DB 目錄。本地音檔仍在 Bot 主機，Server 只保存收藏參照，不會將本地音檔上傳。換 Bot 主機或移動本地曲庫後，可能需要重新加入本地收藏。

### 舊資料匯入與獨立本地模式

若先前已使用 `data/playlists.json`，請先停用舊 Bot 的寫入並備份原檔，啟動新版 Server、設定上述變數後，在 Bot 根目錄執行：

```bash
npm run build
node scripts/import-playlists.mjs data/playlists.json
```

匯入保留使用者、清單 ID、歌曲項目 ID、順序及版本；原 JSON 不會被刪除或覆寫。中途失敗可用同一檔案重跑；已匯入項目不會重複建立，也不會覆蓋之後在 Server 上的編輯。原檔若被修改而與既有匯入內容衝突，工具會停止並回報。確認成功後才重新啟動 Bot 供使用者操作。

沒有設定任何 `PLAYLIST_API_*` 變數時，仍支援獨立本地模式，資料保存在 Bot 的 `data/playlists.json`，重新啟動與指令熱重載後仍保留。此模式請備份並持久掛載 `data/`，每份資料目錄只啟動一個 Bot 程序；檔案以序列化、原子替換寫入，損壞資料會拒絕修改。

這次包含播放器核心變更，請執行 `npm run build` 並重新啟動 Bot，啟動時會註冊新增的 `/playlist` 及更新後的 `/music`。全球指令更新可能需要等候 Discord 同步；`!reload` 只更新指令模組，不能替代本次重新啟動。

`npm test` 包含個人清單權限、持久化及競態、指令互動、佇列與播放器控制，以及真實 FFmpeg 的本地／遠端串流／下載跳轉測試。測試使用暫存資料與本機模擬曲庫，不會登入 Discord 或修改正式曲庫。新增遠端清單用戶端測試涵蓋專用驗證、版本傳送、錯誤不重試、資料隔離及匯入保留原檔。

若同時有 `music_server` checkout，先建置 Server 的 `api/` 與 Bot，再於 Bot 根目錄執行 `node scripts/test-playlist-server.mjs ../music_server/api`。它會建立暫存 SQLite、啟動真實 HTTP Server，驗證兩邊的混合清單 CRUD、停用曲目及可重跑匯入，結束後清除暫存資料。

## 偵測語音頻道福音傳播

在 `.env` 的 `VOICE_CHANNEL_IDS` 設定要監聽的語音頻道 ID，以逗號分隔。未設定時不監聽任何頻道。真人成員進入其中任一頻道時，Bot 會加入並從頭播放進場音效；播放期間若又有人進入，Bot 會先離開、重新加入，再從頭播放。音檔播完後 Bot 會自動離開並繼續監聽。

歌曲請放在 `assets/songs/`。程式會依檔名排序並逐首循環播放。支援 `.webm`、`.opus`、`.ogg`、`.m4a`、`.mp3`、`.wav`。

可選設定：
```dotenv
VOICE_CHANNEL_IDS=your_channel_id,your_channel2_id,...
VOICE_AUDIO_DIRECTORY=assets/songs
```

## 遠端音樂曲庫

Bot 可連接獨立的 `music_server` 曲庫 API。在 Bot 的 `.env` 設定：

```dotenv
REMOTE_MUSIC_API_URL=https://your-music-server.example/
REMOTE_MUSIC_API_TOKEN=your_music_server_api_token
REMOTE_MUSIC_MODE=stream
REMOTE_MUSIC_BUFFER_SECONDS=3
```

網址必須指向能傳送音檔的 Nginx 入口；本機 Docker Compose 預設為 `http://127.0.0.1:8080/`，直接連 Fastify 埠只會收到 `X-Accel-Redirect` 標頭。Token 使用 `music_server` 根目錄 `.env` 的 `API_TOKEN`，不用上傳管理用的 `ADMIN_TOKEN`。Bot 搬到另一台主機時，須將網址改成可連通的 HTTPS 或私有 VPN 入口；`127.0.0.1` 只指向 Bot 自己所在的主機。

使用 `/music library source:remote` 瀏覽遠端曲庫；使用 `/music play source:remote song:歌曲` 搜尋並點播。輸入歌曲前先選擇 `source:remote`，自動完成才會顯示遠端結果。未選來源時維持本地曲庫。本地與遠端歌曲可加入同一佇列，共用面板與控制規則；面板的「選歌」按鈕會開啟目前歌曲所屬的曲庫。

`REMOTE_MUSIC_MODE=stream`（預設）會邊接收邊播放，不將整首歌存到 Bot 主機。串流模式預設先緩衝約 3 秒解碼後的音訊再開始播放，可用 `REMOTE_MUSIC_BUFFER_SECONDS` 設為 0–10 秒；設大會增加開始播放的等待時間與每條串流的記憶體用量，對持續低於播放速度的網路無法補救。`download` 會先下載並驗證整首音檔，再從暫存檔播放，結束後刪除。下載模式的暫存目錄預設為 `data/remote-music-cache/`，可用 `REMOTE_MUSIC_CACHE_DIRECTORY` 修改。`/music reload` 只重掃本地曲庫；遠端歌曲在 `music_server` 匯入或停用後由 API 即時反映。


## 複製文管理

複製文儲存在 Bot 主機的 `data/copyessay.json`。使用下列斜線指令查詢或管理。

新增及刪除後，資料會直接寫入 `data/copyessay.json`。

| 指令 | 用途 |
| --- | --- |
| `/copyessay random` | 隨機顯示一則複製文；`silent:true` 可設為僅自己可見 |
| `/copyessay search query:關鍵字` | 搜尋相關複製文，私下顯示最多 10 筆結果及其 ID、相關度 |
| `/copyessay id id:編號` | 依 ID 顯示複製文；`silent:true` 可設為僅自己可見 |
| `/copymanager add` | 開啟表單，輸入標題與內容以新增複製文 |
| `/copymanager delete id:編號` | 刪除指定 ID 的複製文 |
| `/copymanager list` | 私下列出所有複製文 |


## NVIDIA NIM / GPT-OSS 20B + 聯網搜尋

在 `.env` 設定以下環境變數：

```dotenv
NVIDIA_API_KEY=your_nvidia_api_key
TAVILY_API_KEY=your_tavily_api_key
```

啟動 bot 後，在 Discord 訊息中提及 bot 並附上問題，即會透過 NVIDIA NIM 的 GPT-OSS 20B 產生串流回覆。遇到最新資訊、時效性內容或明確要求搜尋時，模型若知道官方來源就直接讀取該 HTTPS 網頁或 API；不知道來源時才呼叫 Tavily 搜尋，答案會附上來源連結。

`TAVILY_API_KEY` 未設定時，一般問答仍可使用，但聯網搜尋會回報未設定，不會假裝已搜尋。可在 [Tavily](https://app.tavily.com/) 申請免費 API key。

可選設定：

```dotenv
# 預設：openai/gpt-oss-20b
NVIDIA_NIM_MODEL=openai/gpt-oss-20b

# 預設：1024
NVIDIA_NIM_MAX_TOKENS=1024

# 串流請求逾時毫秒數，預設：180000
NVIDIA_NIM_TIMEOUT_MS=180000

# 搜尋逾時毫秒數，預設：20000
WEB_SEARCH_TIMEOUT_MS=20000

# 直接讀取官方網頁/API 的逾時與大小限制
DIRECT_FETCH_TIMEOUT_MS=15000
DIRECT_FETCH_MAX_BYTES=1000000

# 搜尋模式：auto、always、off；預設：auto
WEB_SEARCH_MODE=auto

# Tavily 搜尋速度／品質：ultra-fast、fast、basic、advanced；預設：fast
TAVILY_SEARCH_DEPTH=fast

# 每次搜尋結果數，預設：5，最大：10
TAVILY_MAX_RESULTS=5

# 一次回答最多搜尋輪數，預設：2，最大：5
NVIDIA_NIM_MAX_TOOL_ROUNDS=2

# Kimi K3 推理強度：low、high、max；預設：low（最快）
NVIDIA_NIM_REASONING_EFFORT=low

# 自訂 system prompt
NVIDIA_NIM_SYSTEM_PROMPT=You are a helpful Discord assistant.

# 若使用自行部署的 NIM，可覆寫 API URL
NVIDIA_NIM_URL=https://integrate.api.nvidia.com/v1/chat/completions
```
