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


## 本地音樂播放器

將音檔放入 Bot 主機的 `assets/songs/`，加入一般語音頻道後使用 `/music play song:歌曲`。播放器透過 FFmpeg 解碼本地音檔。

| 指令 | 用途 |
| --- | --- |
| `/music play song:歌曲` | 自動完成選歌；沒有播放時開始，有播放時加入佇列 |
| `/music library query:關鍵字` | 搜尋／分頁瀏覽曲庫，關鍵字可省略 |
| `/music queue` | 查看待播清單及點歌者 |
| `/music panel` | 取得面板連結；面板被刪除時，由同語音頻道成員重建 |
| `/music stop` | 停止、清空佇列並離開 |
| `/music reload` | 手動重新掃描曲庫，所有伺服器成員皆可使用，無需加入語音頻道 |

公開面板提供暫停／繼續、下一首、循環（關閉／單曲／佇列）、打亂待播、選歌、佇列、音量及結束播放。曲庫與完整佇列只對操作的人顯示；曲庫每頁最多 25 首，佇列每頁 10 首。選單有效 15 分鐘，`!reload` 後請重新開啟個人選單；共用播放工作階段繼續運作。

- 同一語音頻道的成員可共同控制。另一頻道已有手動播放時，Bot 不會被點歌移動。
- 音量預設 70%，每次調整 10%，範圍 0–100%；不影響進場音樂音量。
- 單曲循環：自然播完或按「從頭播放」都會從頭重播目前歌曲，保留待播清單。
- 佇列循環：自然播完或按「下一首」都依序前進，最後一首回到清單開頭；只有一首時從頭重播。
- 循環關閉：播放或跳過最後一首後結束；「結束播放」在任何循環模式下都會停止並離開。
- 打亂只排列待播歌曲，最多可排入 100 首；支援重複點歌。
- 播放進度約每 15 秒更新，不支援拖曳；讀不到總長時仍可播放並顯示「總長未知」。
- 播完立即離開；頻道沒有真人持續 60 秒，或暫停達 10 分鐘，也會自動結束。
- Bot 重啟不續播；舊面板會提示失效，使用 `/music play` 重新開始。
- 檔案損壞／移除會略過該曲目；連續三首失敗則結束。播放提示會顯示於面板。

手動工作階段期間（包含暫停與連線中），該伺服器的進場音樂觸發會暫時略過；結束後恢復監聽新的進場事件，不補播。不同伺服器互相獨立，手動點歌不改變進場曲序。

曲庫僅掃描目錄第一層，支援 `.webm`、`.opus`、`.ogg`、`.m4a`、`.mp3`、`.wav`。讀取標題、演出者與時長；缺少標籤時使用檔名。新增、移除或修改音檔後，等檔案複製完成再執行 `/music reload`。更新後重新開啟曲庫選單或輸入點歌搜尋，即可看到最新歌曲。Bot 啟動時會掃描一次，運行中不監聽目錄，也不定期補查；多人同時執行 reload 會共用同一次進行中的掃描。拒絕指向曲庫外的符號連結，不接受使用者輸入任意檔案路徑。

Bot 在語音頻道需要「查看頻道」「連線」「說話」；面板所在文字頻道需要「查看頻道」「傳送訊息」「嵌入連結」，討論串則需傳送討論串訊息權限。初版支援一般語音頻道，不支援 Stage 頻道或私訊播放。


## 偵測語音頻道福音傳播

在 `.env` 的 `VOICE_CHANNEL_IDS` 設定要監聽的語音頻道 ID，以逗號分隔。未設定時不監聽任何頻道。真人成員進入其中任一頻道時，Bot 會加入並從頭播放進場音效；播放期間若又有人進入，Bot 會先離開、重新加入，再從頭播放。音檔播完後 Bot 會自動離開並繼續監聽。

歌曲請放在 `assets/songs/`。程式會依檔名排序並逐首循環播放。支援 `.webm`、`.opus`、`.ogg`、`.m4a`、`.mp3`、`.wav`。

可選設定：
```dotenv
VOICE_CHANNEL_IDS=your_channel_id,your_channel2_id,...
VOICE_AUDIO_DIRECTORY=assets/songs
```

## 音樂資料庫串聯

building...


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

