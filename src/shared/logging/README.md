你的 `logger.js` 目前是一個 **Winston + Proxy 包裝的高階 logger**，具有以下特性與使用方式：

---

## ✅ **支援的 log 層級**

Winston 預設支持以下層級（由高到低）：

| 層級        | 用途                      |
| --------- | ----------------------- |
| `error`   | 重大錯誤、程式崩潰前的錯誤訊息         |
| `warn`    | 警告、非致命錯誤                |
| `info`    | 一般資訊（API 呼叫、服務啟動）       |
| `http`    | HTTP request log（需要自定義） |
| `verbose` | 詳細資訊（debug 前的額外訊息）      |
| `debug`   | 除錯資訊（開發環境常用）            |
| `silly`   | 最低層級，極度詳細的 trace        |

你可以直接調用：

```js
logger.error(new Error('Something went wrong'));
logger.warn('This is a warning');
logger.info('Server started');
logger.debug('Debug info');
```

---

## ✅ **Traceback（錯誤堆疊）如何輸出？**

1. **當你傳 `Error` 物件時**

   ```js
   try {
     throw new Error('DB connection failed');
   } catch (err) {
     logger.error(err);
   }
   ```

   **輸出：**

   ```
   2025-07-28 17:00:00 [error] [yourModule.js] DB connection failed
   Error: DB connection failed
       at ...
       at ...
   ```

2. **當你傳 `(message, Error)`**

   ```js
   logger.error('Database Error', new Error('Timeout'));
   ```

   **輸出：**

   ```
   2025-07-28 17:01:00 [error] [yourModule.js] Database Error: Timeout
   Error: Timeout
       at ...
   ```

3. **當你只傳字串/物件時**（不會有 stack）

   ```js
   logger.warn('User login failed', { userId: 123 });
   ```

   **輸出：**

   ```
   2025-07-28 17:02:00 [warn] [yourModule.js] User login failed
   {
     "userId": 123
   }
   ```

---

## ✅ **Traceback 會在哪裡顯示？**

* **Console**（顏色化，方便開發） → 透過 `consoleFormat`
* **logs/error.log**（僅記錄 `error` 層級）
* **logs/combined.log**（記錄所有層級）

每個 `Error` 物件的 `stack` 都會完整輸出，類似 `console.log(err)` 的效果。

---

## ✅ **如何在專案中使用此 logger？**

在任何檔案中：

```js
import logger from './logger.js';

logger.info('服務啟動中...');
logger.warn('API token 可能已過期');
logger.error('資料庫連線失敗', new Error('ECONNREFUSED'));
```
